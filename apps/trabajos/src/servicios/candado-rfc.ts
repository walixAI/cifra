// El candado global de sincronización con el SAT — por RFC, no por contribuyente ni por
// organización (§3 del documento de inquilinos). Dos organizaciones que comparten un RFC no
// pueden bajarlo en paralelo: el SAT las bloquea a las dos.
//
// Se implementa como un arrendamiento (lease) en la fila `SincronizacionRfc`, adquirido con un
// UPDATE condicional atómico. Es la red que sobrevive a un reinicio de la app de Inngest; la
// clave de concurrencia de Inngest (`event.data.rfc`, límite 1) es la primera línea.

import type { PrismaClient } from "@cifra/db";

/** El arrendamiento dura esto; si el worker muere, otro puede tomarlo pasado este tiempo. */
const DURACION_ARRENDAMIENTO_MS = 15 * 60 * 1000;

export class CandadoRfcOcupado extends Error {
  constructor(
    public readonly rfc: string,
    public readonly workerActual: string | null,
  ) {
    super(`Ya hay una sincronización del RFC ${rfc} en curso${workerActual ? ` (worker ${workerActual})` : ""}.`);
    this.name = "CandadoRfcOcupado";
  }
}

export interface OpcionesCandado {
  ahora?: () => Date;
}

/**
 * Corre `fn` con el candado del RFC tomado. Si otro worker lo tiene, lanza CandadoRfcOcupado
 * sin llamar a `fn`. Suelta el candado al terminar (aunque `fn` falle).
 */
export async function conCandadoRfc<T>(
  prisma: PrismaClient,
  rfc: string,
  workerId: string,
  fn: () => Promise<T>,
  opciones: OpcionesCandado = {},
): Promise<T> {
  const ahora = opciones.ahora ? opciones.ahora() : new Date();
  const arrendamientoHasta = new Date(ahora.getTime() + DURACION_ARRENDAMIENTO_MS);

  await prisma.$executeRaw`
    INSERT INTO sincronizacion_rfc (rfc, ultimo_intento)
    VALUES (${rfc}, ${ahora})
    ON CONFLICT (rfc) DO NOTHING`;

  // Adquiere solo si el arrendamiento anterior venció (o nunca hubo). Atómico: si dos workers
  // corren esto a la vez, uno actualiza la fila y el otro ve 0 filas afectadas.
  const filas = await prisma.$executeRaw`
    UPDATE sincronizacion_rfc
    SET arrendamiento_hasta = ${arrendamientoHasta},
        worker_id = ${workerId},
        ultimo_intento = ${ahora}
    WHERE rfc = ${rfc}
      AND (arrendamiento_hasta IS NULL OR arrendamiento_hasta < ${ahora})`;

  if (filas === 0) {
    const actual = await prisma.sincronizacionRfc.findUnique({ where: { rfc } });
    throw new CandadoRfcOcupado(rfc, actual?.worker_id ?? null);
  }

  try {
    return await fn();
  } finally {
    // Suelta solo si el arrendamiento sigue siendo nuestro (no pisar a un worker que ya lo tomó
    // porque el nuestro venció).
    await prisma.$executeRaw`
      UPDATE sincronizacion_rfc
      SET arrendamiento_hasta = NULL, worker_id = NULL
      WHERE rfc = ${rfc} AND worker_id = ${workerId}`;
  }
}

/** Registra el resultado de un intento en la fila del RFC (cursor al avanzar, error al fallar). */
export async function registrarIntentoRfc(
  prisma: PrismaClient,
  rfc: string,
  resultado: { cursor?: Date; error?: string; proximoIntentoEn?: Date },
): Promise<void> {
  await prisma.sincronizacionRfc.update({
    where: { rfc },
    data: {
      cursor: resultado.cursor,
      ultimo_error: resultado.error ?? null,
      proximo_intento_en: resultado.proximoIntentoEn ?? null,
    },
  });
}
