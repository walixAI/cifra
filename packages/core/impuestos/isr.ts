// ISR — pago provisional acumulado desde enero (§3.2 del README; artículo 106 de la LISR,
// tarifa del artículo 96).
//
//   Base = ingresos acumulados del ejercicio − deducciones autorizadas acumuladas
//   ISR del periodo = tarifa_art_96(Base, meses transcurridos) − pagos provisionales anteriores
//
// La tarifa es dato versionado por ejercicio (regla 4 de CLAUDE.md) — nunca una constante en
// código: tarifas/2026.json trae la tabla MENSUAL (Anexo 8, RMF 2026). Para el acumulado, cada
// límite y la cuota fija de esa tabla se multiplican por los meses transcurridos, como manda el
// artículo 106 — no se versionan 12 tablas ya escaladas.

import tarifa2026 from "./tarifas/2026.json";

export interface TramoTarifa {
  limiteInferiorCentavos: number;
  limiteSuperiorCentavos: number | null;
  cuotaFijaCentavos: number;
  /** Porcentaje sobre el excedente, ×10 000 — evita floats en el cálculo (23.52 % → 2352). */
  porcentajeX10000: number;
}

export interface TablaTarifaIsr {
  ejercicio: number;
  fuente: string;
  tramosMensuales: TramoTarifa[];
}

const TABLAS_POR_EJERCICIO: Record<number, TablaTarifaIsr> = {
  2026: tarifa2026 as TablaTarifaIsr,
};

export class TarifaNoDisponibleError extends Error {
  constructor(public readonly ejercicio: number) {
    super(`No hay tarifa de ISR versionada para el ejercicio ${ejercicio}.`);
    this.name = "TarifaNoDisponibleError";
  }
}

/** Redondeo estándar (mitad hacia arriba) en aritmética entera, sin pasar por float. */
function dividirRedondeando(numerador: bigint, denominador: bigint): bigint {
  const signo = numerador < 0n ? -1n : 1n;
  const n = numerador < 0n ? -numerador : numerador;
  return signo * ((n + denominador / 2n) / denominador);
}

function escalarTramos(tramos: readonly TramoTarifa[], mesesTranscurridos: number): TramoTarifa[] {
  return tramos.map((t) => ({
    limiteInferiorCentavos: t.limiteInferiorCentavos * mesesTranscurridos,
    limiteSuperiorCentavos:
      t.limiteSuperiorCentavos === null ? null : t.limiteSuperiorCentavos * mesesTranscurridos,
    cuotaFijaCentavos: t.cuotaFijaCentavos * mesesTranscurridos,
    porcentajeX10000: t.porcentajeX10000,
  }));
}

/**
 * Aplica la tarifa acumulada del artículo 96 a una base, para los meses transcurridos del
 * ejercicio (enero = 1). Pura: dado el mismo ejercicio, base y meses, siempre da lo mismo.
 */
export function aplicarTarifaIsr(
  baseCentavos: bigint,
  mesesTranscurridos: number,
  ejercicio: number,
): bigint {
  if (mesesTranscurridos < 1 || mesesTranscurridos > 12) {
    throw new RangeError(`mesesTranscurridos debe estar entre 1 y 12, llegó ${mesesTranscurridos}.`);
  }
  const tabla = TABLAS_POR_EJERCICIO[ejercicio];
  if (!tabla) throw new TarifaNoDisponibleError(ejercicio);
  if (baseCentavos <= 0n) return 0n;

  const tramos = escalarTramos(tabla.tramosMensuales, mesesTranscurridos);
  const tramo = tramos.find(
    (t) =>
      baseCentavos >= BigInt(t.limiteInferiorCentavos) &&
      (t.limiteSuperiorCentavos === null || baseCentavos <= BigInt(t.limiteSuperiorCentavos)),
  );
  if (!tramo) {
    throw new Error(`No se encontró un tramo de la tarifa ${ejercicio} para la base ${baseCentavos}.`);
  }

  const excedenteCentavos = baseCentavos - BigInt(tramo.limiteInferiorCentavos);
  const sobreExcedenteCentavos = dividirRedondeando(
    excedenteCentavos * BigInt(tramo.porcentajeX10000),
    10_000n,
  );
  return BigInt(tramo.cuotaFijaCentavos) + sobreExcedenteCentavos;
}

export interface DatosIsrProvisional {
  ingresosAcumuladosCentavos: bigint;
  deduccionesAcumuladasCentavos: bigint;
  pagosProvisionalesAnterioresCentavos: bigint;
  /** Enero = 1 … diciembre = 12. La base es acumulada desde enero hasta este mes. */
  mesDelEjercicio: number;
  ejercicio: number;
}

export interface ResultadoIsr {
  baseCentavos: bigint;
  isrAcumuladoCentavos: bigint;
  isrDelPeriodoCentavos: bigint;
}

/**
 * ISR del periodo — pago provisional acumulado (§3.2 del README). Cumulativo desde enero, no
 * mes a mes de forma independiente: por eso pide ingresos y deducciones ACUMULADOS, y resta los
 * pagos provisionales ya hechos en el ejercicio.
 */
export function calcularIsr(datos: DatosIsrProvisional): ResultadoIsr {
  const baseCentavos = datos.ingresosAcumuladosCentavos - datos.deduccionesAcumuladasCentavos;
  const baseParaTarifa = baseCentavos > 0n ? baseCentavos : 0n;

  const isrAcumuladoCentavos = aplicarTarifaIsr(
    baseParaTarifa,
    datos.mesDelEjercicio,
    datos.ejercicio,
  );
  const isrDelPeriodoCentavos = isrAcumuladoCentavos - datos.pagosProvisionalesAnterioresCentavos;

  return { baseCentavos, isrAcumuladoCentavos, isrDelPeriodoCentavos };
}
