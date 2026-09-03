// El candado global de sincronización con el SAT — por RFC, no por contribuyente ni por
// organización (§3 del documento de inquilinos). Dos organizaciones que comparten un RFC no
// pueden bajarlo en paralelo: el SAT las bloquea a las dos.
//
// Se implementa como un arrendamiento (lease) en la fila `SincronizacionRfc`, adquirido con un
// UPDATE condicional atómico. Es la red que sobrevive a un reinicio de la app de Inngest; la
// clave de concurrencia de Inngest (`event.data.rfc`, límite 1) es la primera línea.
//
// El arrendamiento dura poco (15 min) *y se renueva en cada paso durable de la sincronización*.
// Así un TTL corto detecta rápido a un worker muerto —deja de renovar y el arrendamiento
// vence— sin que un worker vivo pero lento lo pierda mientras sigue trabajando.

import type { PrismaClient } from "@cifra/db";

/** El arrendamiento dura esto desde la última renovación; si el worker deja de renovar (murió),
 *  otro puede tomarlo pasado este tiempo. NO se alarga: se renueva. */
export const DURACION_ARRENDAMIENTO_MS = 15 * 60 * 1000;

/** Identidad de quien toma el candado. `id` es único por intento; `corrida` es estable entre
 *  reintentos de la misma corrida de Inngest — es lo que deja reconocer un arrendamiento
 *  huérfano de un intento anterior. Formato de `id`: `${corrida}#${intento}`. */
export interface WorkerRfc {
  id: string;
  corrida: string;
}

export class CandadoRfcOcupado extends Error {
  constructor(
    public readonly rfc: string,
    public readonly workerActual: string | null,
  ) {
    super(`Ya hay una sincronización del RFC ${rfc} en curso${workerActual ? ` (worker ${workerActual})` : ""}.`);
    this.name = "CandadoRfcOcupado";
  }
}

/** El arrendamiento dejó de ser nuestro a media corrida: otro worker lo recuperó tras el TTL.
 *  Un worker zombi que despierta y ve esto tiene que abortar, no seguir escribiendo. */
export class ArrendamientoPerdido extends Error {
  constructor(
    public readonly rfc: string,
    public readonly workerId: string,
    public readonly workerActual: string | null,
  ) {
    super(
      `El arrendamiento del RFC ${rfc} ya no es del worker ${workerId}` +
        `${workerActual ? ` (ahora lo tiene ${workerActual})` : " (fue liberado)"}.`,
    );
    this.name = "ArrendamientoPerdido";
  }
}

/** Handle que `fn` usa para renovar el arrendamiento en cada paso durable. */
export interface CandadoRfc {
  /** Extiende el arrendamiento otros DURACION_ARRENDAMIENTO_MS desde ahora. Lanza
   *  ArrendamientoPerdido si el candado ya no es de este worker. */
  renovar(): Promise<void>;
  /** Cuántas veces se renovó (para métricas y pruebas). */
  readonly renovaciones: number;
}

export interface OpcionesCandado {
  ahora?: () => Date;
  /** Se invoca cuando un reintento choca con el arrendamiento huérfano de un intento anterior
   *  de su propia corrida (un incidente: el intento anterior cayó sin soltarlo). */
  alRecuperarHuerfano?: (info: { rfc: string; huerfano: string; corrida: string }) => void;
}

/**
 * Corre `fn` con el candado del RFC tomado. Si otro worker legítimo lo tiene, lanza
 * CandadoRfcOcupado sin llamar a `fn`. Suelta el candado al terminar (aunque `fn` falle).
 *
 * `fn` recibe un `CandadoRfc` y debe llamar `renovar()` en cada paso durable: mientras renueve,
 * el arrendamiento no vence aunque la bajada tarde horas.
 */
export async function conCandadoRfc<T>(
  prisma: PrismaClient,
  rfc: string,
  worker: WorkerRfc,
  fn: (candado: CandadoRfc) => Promise<T>,
  opciones: OpcionesCandado = {},
): Promise<T> {
  const reloj = opciones.ahora ?? (() => new Date());
  const prefijoCorrida = `${worker.corrida}#`;

  const ahora = reloj();
  const hasta = new Date(ahora.getTime() + DURACION_ARRENDAMIENTO_MS);

  await prisma.$executeRaw`
    INSERT INTO sincronizacion_rfc (rfc, ultimo_intento)
    VALUES (${rfc}, ${ahora})
    ON CONFLICT (rfc) DO NOTHING`;

  // Adquisición normal: nadie lo tiene, o el arrendamiento anterior venció. Atómico: si dos
  // workers corren esto a la vez, uno actualiza la fila y el otro ve 0 filas afectadas.
  let filas = await prisma.$executeRaw`
    UPDATE sincronizacion_rfc
    SET arrendamiento_hasta = ${hasta}, worker_id = ${worker.id}, ultimo_intento = ${ahora}
    WHERE rfc = ${rfc}
      AND (arrendamiento_hasta IS NULL OR arrendamiento_hasta < ${ahora})`;

  if (filas === 0) {
    const fila = await prisma.sincronizacionRfc.findUnique({ where: { rfc } });
    const suyo = fila?.worker_id ?? null;

    // ¿Lo tiene un intento anterior de MI propia corrida? Entonces es un huérfano: ese intento
    // cayó sin soltar el candado y su TTL todavía no vence. No es la operación normal ("otro
    // worker lo tiene") — es un incidente, y este intento sí puede retomarlo.
    if (suyo !== null && suyo.startsWith(prefijoCorrida)) {
      opciones.alRecuperarHuerfano?.({ rfc, huerfano: suyo, corrida: worker.corrida });
      console.error(
        `[candado-rfc] incidente: la corrida ${worker.corrida} chocó con su propio arrendamiento ` +
          `huérfano (${suyo}) del RFC ${rfc} — un intento anterior cayó sin soltarlo. Se recupera.`,
      );
      filas = await prisma.$executeRaw`
        UPDATE sincronizacion_rfc
        SET arrendamiento_hasta = ${hasta}, worker_id = ${worker.id}, ultimo_intento = ${ahora}
        WHERE rfc = ${rfc} AND worker_id = ${suyo}`;
    }

    if (filas === 0) {
      throw new CandadoRfcOcupado(rfc, suyo);
    }
  }

  let renovaciones = 0;
  const candado: CandadoRfc = {
    get renovaciones() {
      return renovaciones;
    },
    async renovar() {
      const t = reloj();
      const nuevoHasta = new Date(t.getTime() + DURACION_ARRENDAMIENTO_MS);
      // Condicional a que el worker_id siga siendo el nuestro: si otro worker ya recuperó el
      // arrendamiento (nuestro TTL venció y no renovamos a tiempo), esto afecta 0 filas y
      // abortamos en vez de pisarle el candado.
      const n = await prisma.$executeRaw`
        UPDATE sincronizacion_rfc
        SET arrendamiento_hasta = ${nuevoHasta}, ultimo_intento = ${t}
        WHERE rfc = ${rfc} AND worker_id = ${worker.id}`;
      if (n === 0) {
        const fila = await prisma.sincronizacionRfc.findUnique({ where: { rfc } });
        throw new ArrendamientoPerdido(rfc, worker.id, fila?.worker_id ?? null);
      }
      renovaciones += 1;
    },
  };

  try {
    return await fn(candado);
  } finally {
    // Suelta solo si el arrendamiento sigue siendo nuestro (no pisar a un worker que ya lo tomó
    // porque el nuestro venció).
    await prisma.$executeRaw`
      UPDATE sincronizacion_rfc
      SET arrendamiento_hasta = NULL, worker_id = NULL
      WHERE rfc = ${rfc} AND worker_id = ${worker.id}`;
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
