// sat-sincronizar — baja los CFDI del contribuyente y los guarda. Primera vez: hasta 3 años
// atrás. Después: desde el cursor de la última bajada.
//
// Corre bajo el candado global por RFC (candado-rfc.ts). Idempotente: upsert por
// (contribuyente_id, uuid); un reintento no duplica nada.

import { prisma, prismaPara } from "@cifra/db";
import type { CfdiDescargado, ClienteSat } from "@cifra/sat";
import { RfcNoReconocido, SatNoResponde } from "@cifra/sat";
import { AÑOS_PRIMERA_BAJADA } from "../entorno";
import { usarCiec } from "../credenciales";
import { conCandadoRfc, registrarIntentoRfc } from "./candado-rfc";

/** Cada cuántos CFDI guardados se renueva el arrendamiento del candado dentro del lote. */
const RENOVAR_CADA = 25;

export interface EntradaSincronizar {
  contribuyenteId: string;
  /** Identificador de la corrida de Inngest, estable entre reintentos (el `runId`). */
  corrida: string;
  /** Número de intento de esa corrida (Inngest `attempt`; 0 el primero). */
  intento: number;
  /** Reloj inyectable para pruebas. */
  ahora?: () => Date;
  /** Se invoca si un reintento recupera el arrendamiento huérfano de un intento anterior. */
  alRecuperarHuerfano?: (info: { rfc: string; huerfano: string; corrida: string }) => void;
}

export interface ResultadoSincronizar {
  cfdiNuevos: number;
  cfdiActualizados: number;
  corte: Date;
}

function tipoInterno(c: CfdiDescargado): "ingreso" | "egreso" | "nomina" | "pago" | "traslado" {
  return c.tipo;
}

async function guardarCfdi(
  db: ReturnType<typeof prismaPara>,
  contribuyenteId: string,
  c: CfdiDescargado,
): Promise<"nuevo" | "actualizado"> {
  const existente = await db.cfdi.findUnique({
    where: { contribuyente_id_uuid: { contribuyente_id: contribuyenteId, uuid: c.uuid } },
    select: { id: true, estado_sat: true },
  });

  // La cancelación es monótona: si en la base ya está cancelado, no se revierte por una bajada.
  const estadoSat: "vigente" | "cancelado" =
    existente?.estado_sat === "cancelado" || c.estadoSat === "cancelado" ? "cancelado" : "vigente";

  const datosSat = {
    tipo: tipoInterno(c),
    direccion: c.direccion,
    origen: "sat" as const,
    serie: c.serie,
    folio: c.folio,
    emisor_rfc: c.emisorRfc,
    emisor_nombre: c.emisorNombre,
    receptor_rfc: c.receptorRfc,
    receptor_nombre: c.receptorNombre,
    fecha_emision: c.fechaEmision,
    fecha_timbrado: c.fechaTimbrado,
    subtotal: c.subtotalCentavos,
    descuento: c.descuentoCentavos,
    total: c.totalCentavos,
    uso_cfdi: c.usoCfdi,
    metodo_pago: c.metodoPago,
    forma_pago: c.formaPago,
    conceptos: c.conceptos,
    estado_sat: estadoSat,
    cancelado_en: estadoSat === "cancelado" ? c.canceladoEn : null,
  };

  const cfdi = await db.cfdi.upsert({
    where: { contribuyente_id_uuid: { contribuyente_id: contribuyenteId, uuid: c.uuid } },
    create: { contribuyente_id: contribuyenteId, uuid: c.uuid, ...datosSat },
    // En update NO se tocan liquidado / fecha_liquidacion / estado_interno / cuenta_contable_id:
    // esos los llevan la conciliación bancaria y la clasificación, no el SAT.
    update: datosSat,
  });

  // Los impuestos son propiedad del comprobante: se reemplazan enteros.
  await db.cfdiImpuesto.deleteMany({ where: { cfdi_id: cfdi.id } });
  if (c.impuestos.length > 0) {
    await db.cfdiImpuesto.createMany({
      data: c.impuestos.map((i) => ({
        contribuyente_id: contribuyenteId,
        cfdi_id: cfdi.id,
        impuesto: i.impuesto,
        clasificacion: i.clasificacion,
        tasa: i.tasa,
        importe_centavos: i.importeCentavos,
      })),
    });
  }

  return existente ? "actualizado" : "nuevo";
}

/**
 * Sincroniza un contribuyente. Toma el candado del RFC; si otro worker lo tiene, lanza
 * CandadoRfcOcupado sin bajar nada.
 */
export async function sincronizarContribuyente(
  sat: ClienteSat,
  entrada: EntradaSincronizar,
): Promise<ResultadoSincronizar> {
  const ahora = entrada.ahora ?? (() => new Date());
  const contribuyente = await prisma.contribuyente.findUniqueOrThrow({
    where: { id: entrada.contribuyenteId },
  });

  // `prisma` sin alcance: SincronizacionRfc (sin contribuyente_id) y el candado. `db` con
  // alcance: todo lo que lleva contribuyente_id no nulo y está bajo RLS.
  const db = prismaPara(entrada.contribuyenteId);

  return conCandadoRfc(
    prisma,
    contribuyente.rfc,
    { id: `${entrada.corrida}#${entrada.intento}`, corrida: entrada.corrida },
    async (candado) => {
      const rfcSync = await prisma.sincronizacionRfc.findUnique({ where: { rfc: contribuyente.rfc } });
      const corte = ahora();
      const desde =
        rfcSync?.cursor ??
        new Date(Date.UTC(corte.getUTCFullYear() - AÑOS_PRIMERA_BAJADA, corte.getUTCMonth(), corte.getUTCDate()));

      const registro = await db.sincronizacionSat.create({
        data: { contribuyente_id: entrada.contribuyenteId, tipo: "cfdi", estado: "corriendo" },
      });

      try {
        const descargados = await usarCiec(
          db,
          {
            contribuyenteId: entrada.contribuyenteId,
            organizacionId: contribuyente.organizacion_id,
            usuarioId: null,
            alcance: "lectura_sat",
            operacion: "descarga_cfdi",
          },
          (ciec) => sat.descargarCfdi({ rfc: contribuyente.rfc, ciec }, { desde, hasta: corte }),
        );

        // Paso durable: terminó la descarga (lo más lento y lo que más tarda si el SAT va
        // lento). Renueva antes de entrar al lote de escritura.
        await candado.renovar();

        let nuevos = 0;
        let actualizados = 0;
        let procesados = 0;
        for (const c of descargados) {
          const r = await guardarCfdi(db, entrada.contribuyenteId, c);
          if (r === "nuevo") nuevos += 1;
          else actualizados += 1;
          // Paso durable dentro del lote: la primera bajada puede traer años de CFDI.
          if (++procesados % RENOVAR_CADA === 0) await candado.renovar();
        }

        await candado.renovar();
        await registrarIntentoRfc(prisma, contribuyente.rfc, { cursor: corte });
        await db.sincronizacionSat.update({
          where: { id: registro.id },
          data: { estado: "ok", terminada_en: ahora(), corte, cfdi_nuevos: nuevos },
        });

        return { cfdiNuevos: nuevos, cfdiActualizados: actualizados, corte };
      } catch (error) {
        const codigo =
          error instanceof SatNoResponde ? String(error.codigo) : error instanceof RfcNoReconocido ? "rfc_no_reconocido" : "error";
        const proximo =
          error instanceof SatNoResponde
            ? new Date(ahora().getTime() + error.proximoIntentoEnSegundos * 1000)
            : undefined;
        await registrarIntentoRfc(prisma, contribuyente.rfc, {
          error: (error as Error).message,
          proximoIntentoEn: proximo,
        });
        await db.sincronizacionSat.update({
          where: { id: registro.id },
          data: {
            estado: "error",
            terminada_en: ahora(),
            codigo_error: codigo,
            mensaje_error: (error as Error).message,
          },
        });
        throw error;
      }
    },
    { ahora, alRecuperarHuerfano: entrada.alRecuperarHuerfano },
  );
}
