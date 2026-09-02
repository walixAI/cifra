// sat-validez — el barrido de UUID. La regla más valiosa del producto (§3.4 del README).
//
// Un CFDI que YA está en una póliza y que el SAT ahora reporta como cancelado:
//   (a) se detecta en este barrido,
//   (b) se levanta una notificación `neg`,
//   (c) la pantalla de Impuestos muestra la cifra corregida del cuadre (lo hace sola: recalcula
//       buscando CFDI cancelados con póliza — obtenerImpuestos en apps/web),
//   (d) se ofrece revertir la póliza con un clic — la póliza NO se revierte aquí; es acción del
//       usuario. Solo se le marca la alerta.
//
// Este servicio no toca el motor fiscal ni recalcula impuestos: solo cambia estado, avisa, y
// deja el resumen en `warning` para que la cartera del despacho lo vea.

import { prisma, prismaPara } from "@cifra/db";
import type { ClienteSat } from "@cifra/sat";
import { usarCiec } from "../credenciales";

export interface EntradaBarrerValidez {
  contribuyenteId: string;
  ahora?: () => Date;
}

export interface DeteccionCancelado {
  cfdiId: string;
  uuid: string;
  emisorNombre: string;
  polizaId: string;
  polizaFolio: string;
  ivaAcreditableCentavos: bigint;
  canceladoEn: Date | null;
}

export interface ResultadoBarrerValidez {
  uuidsRevisados: number;
  detecciones: DeteccionCancelado[];
}

function pesos(centavos: bigint): string {
  const entero = centavos / 100n;
  const dec = (centavos % 100n).toString().padStart(2, "0");
  return `$${entero.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec}`;
}

/**
 * Revalida contra el SAT los CFDI del contribuyente que ya están contabilizados. Por cada uno
 * que se canceló después de entrar a una póliza, hace (a)–(d) de §3.4.
 */
export async function barrerValidez(
  sat: ClienteSat,
  entrada: EntradaBarrerValidez,
): Promise<ResultadoBarrerValidez> {
  const ahora = entrada.ahora ?? (() => new Date());
  const contribuyente = await prisma.contribuyente.findUniqueOrThrow({
    where: { id: entrada.contribuyenteId },
  });
  const db = prismaPara(entrada.contribuyenteId);

  const registro = await db.sincronizacionSat.create({
    data: { contribuyente_id: entrada.contribuyenteId, tipo: "validez", estado: "corriendo" },
  });

  try {
    // CFDI que están en la base como vigentes Y aparecen en al menos una póliza.
    const contabilizados = await db.cfdi.findMany({
      where: { estado_sat: "vigente", polizas: { some: {} } },
      select: {
        id: true,
        uuid: true,
        emisor_nombre: true,
        polizas: { select: { id: true, folio: true }, take: 1 },
        impuestos: {
          where: { impuesto: "IVA", clasificacion: "trasladado" },
          select: { importe_centavos: true },
        },
      },
    });

    const estados =
      contabilizados.length === 0
        ? []
        : await usarCiec(
            db,
            {
              contribuyenteId: entrada.contribuyenteId,
              organizacionId: contribuyente.organizacion_id,
              usuarioId: null,
              alcance: "lectura_sat",
              operacion: "barrido_validez",
            },
            (ciec) =>
              sat.validarUuids(
                { rfc: contribuyente.rfc, ciec },
                contabilizados.map((c) => c.uuid),
              ),
          );

    const detecciones: DeteccionCancelado[] = [];

    for (const estado of estados) {
      if (estado.estado !== "cancelado") continue;
      const cfdi = contabilizados.find((c) => c.uuid === estado.uuid);
      const poliza = cfdi?.polizas[0];
      if (!cfdi || !poliza) continue;

      const ivaAcreditable = cfdi.impuestos.reduce((s, i) => s + i.importe_centavos, 0n);

      // (a) + estado
      await db.cfdi.update({
        where: { id: cfdi.id },
        data: { estado_sat: "cancelado", cancelado_en: estado.canceladoEn ?? ahora() },
      });

      // (d) alerta en la póliza — no se revierte, es acción del usuario
      await db.poliza.update({
        where: { id: poliza.id },
        data: {
          alerta:
            `El CFDI que originó esta póliza está cancelado en el SAT y su IVA de ${pesos(ivaAcreditable)} ` +
            `sigue sumando a tu acreditable. Hay que revertir el registro antes del cierre.`,
        },
      });

      // (b) notificación neg
      await db.notificacion.create({
        data: {
          contribuyente_id: entrada.contribuyenteId,
          tipo: "cfdi_cancelado_contabilizado",
          severidad: "neg",
          texto:
            `El CFDI de ${cfdi.emisor_nombre} fue cancelado en el SAT y su póliza ${poliza.folio} ` +
            `sigue acreditando ${pesos(ivaAcreditable)} de IVA.`,
          pantalla_destino: "contabilidad",
          entidad_tipo: "poliza",
          entidad_id: poliza.id,
        },
      });

      detecciones.push({
        cfdiId: cfdi.id,
        uuid: cfdi.uuid,
        emisorNombre: cfdi.emisor_nombre,
        polizaId: poliza.id,
        polizaFolio: poliza.folio,
        ivaAcreditableCentavos: ivaAcreditable,
        canceladoEn: estado.canceladoEn,
      });
    }

    // (c) el resumen queda en warning; la cifra corregida la calcula la pantalla de Impuestos
    // sola (obtenerImpuestos busca CFDI cancelados con póliza y aplica evaluarCuadreIva).
    if (detecciones.length > 0) {
      await db.resumenContribuyente.updateMany({
        where: { contribuyente_id: entrada.contribuyenteId },
        data: { cuadre_estado: "warning" },
      });
    }

    await db.sincronizacionSat.update({
      where: { id: registro.id },
      data: { estado: "ok", terminada_en: ahora(), corte: ahora() },
    });

    return { uuidsRevisados: contabilizados.length, detecciones };
  } catch (error) {
    await db.sincronizacionSat.update({
      where: { id: registro.id },
      data: { estado: "error", terminada_en: ahora(), mensaje_error: (error as Error).message },
    });
    throw error;
  }
}
