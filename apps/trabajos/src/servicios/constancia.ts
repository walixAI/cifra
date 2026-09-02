// sat-constancia — lee la constancia de situación fiscal, guarda el snapshot y reconcilia las
// obligaciones vigentes. El régimen y las obligaciones definen qué impuestos calcula Cifra y
// cuándo avisa (Calendario fiscal, Mis obligaciones).

import { prisma, prismaPara } from "@cifra/db";
import type { ClienteSat, ObligacionLeida } from "@cifra/sat";
import { usarCiec } from "../credenciales";

export interface EntradaConstancia {
  contribuyenteId: string;
  ahora?: () => Date;
}

export interface ResultadoConstancia {
  regimenes: string[];
  obligacionesAltas: number;
  obligacionesBajas: number;
}

function periodicidad(o: ObligacionLeida): "mensual" | "bimestral" | "anual" {
  return o.periodicidad;
}

export async function sincronizarConstancia(
  sat: ClienteSat,
  entrada: EntradaConstancia,
): Promise<ResultadoConstancia> {
  const ahora = entrada.ahora ?? (() => new Date());
  const contribuyente = await prisma.contribuyente.findUniqueOrThrow({
    where: { id: entrada.contribuyenteId },
  });
  const db = prismaPara(entrada.contribuyenteId);

  const registro = await db.sincronizacionSat.create({
    data: { contribuyente_id: entrada.contribuyenteId, tipo: "constancia", estado: "corriendo" },
  });

  try {
    const constancia = await usarCiec(
      db,
      {
        contribuyenteId: entrada.contribuyenteId,
        organizacionId: contribuyente.organizacion_id,
        usuarioId: null,
        alcance: "lectura_sat",
        operacion: "leer_constancia",
      },
      (ciec) => sat.leerConstancia({ rfc: contribuyente.rfc, ciec }),
    );

    // Snapshot: una fila por lectura.
    await db.constancia.create({
      data: {
        contribuyente_id: entrada.contribuyenteId,
        leida_en: constancia.leidaEn,
        regimenes: constancia.regimenes,
        domicilio: constancia.domicilio ?? undefined,
      },
    });

    // El régimen del contribuyente se actualiza al de la constancia.
    await db.contribuyente.update({
      where: { id: entrada.contribuyenteId },
      data: { regimenes: constancia.regimenes },
    });

    // Reconciliar obligaciones: las que ya no aparecen se marcan vencidas (vigente_hasta), las
    // nuevas se dan de alta. No se borran — el histórico importa.
    const existentes = await db.obligacion.findMany({
      where: { contribuyente_id: entrada.contribuyenteId, vigente_hasta: null },
    });
    const clavesConstancia = new Set(constancia.obligaciones.map((o) => o.clave));
    const clavesExistentes = new Set(existentes.map((o) => o.clave));

    let altas = 0;
    for (const o of constancia.obligaciones) {
      if (clavesExistentes.has(o.clave)) continue;
      await db.obligacion.create({
        data: {
          contribuyente_id: entrada.contribuyenteId,
          clave: o.clave,
          descripcion: o.descripcion,
          periodicidad: periodicidad(o),
          dia_limite: o.diaLimite,
          vigente_desde: o.vigenteDesde,
        },
      });
      altas += 1;
    }

    let bajas = 0;
    for (const o of existentes) {
      if (clavesConstancia.has(o.clave)) continue;
      await db.obligacion.update({ where: { id: o.id }, data: { vigente_hasta: ahora() } });
      bajas += 1;
    }

    await db.sincronizacionSat.update({
      where: { id: registro.id },
      data: { estado: "ok", terminada_en: ahora(), corte: constancia.leidaEn },
    });

    return { regimenes: constancia.regimenes, obligacionesAltas: altas, obligacionesBajas: bajas };
  } catch (error) {
    await db.sincronizacionSat.update({
      where: { id: registro.id },
      data: { estado: "error", terminada_en: ahora(), mensaje_error: (error as Error).message },
    });
    throw error;
  }
}
