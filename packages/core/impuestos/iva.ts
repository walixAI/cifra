// IVA — pago definitivo mensual, por FLUJO DE EFECTIVO (§3.1 del README; regla 1 de CLAUDE.md).
//
//   IVA por pagar = IVA trasladado (cobrado)
//                 − IVA acreditable (pagado)
//                 − IVA retenido por clientes personas morales
//
// El trasladado solo cuenta cuando la factura se COBRA; el acreditable, cuando el gasto se
// PAGA — nunca por lo devengado. Por eso el filtro es la fecha de liquidación dentro del
// periodo, nunca la fecha de emisión. Una factura PPD necesita su complemento de pago antes de
// que su IVA se mueva — aquí eso se traduce en `liquidado`.

export type ClasificacionImpuesto = "trasladado" | "retenido";

export interface LineaImpuestoIva {
  clasificacion: ClasificacionImpuesto;
  importeCentavos: bigint;
}

export interface CfdiParaIva {
  direccion: "emitido" | "recibido";
  /** Cobrado (emitido) o pagado (recibido) — la condición que activa el flujo de efectivo. */
  liquidado: boolean;
  fechaLiquidacion: Date | null;
  /** Solo las líneas de impuesto = 'IVA' de este CFDI. */
  impuestosIva: LineaImpuestoIva[];
}

export interface Periodo {
  desde: Date;
  /** Inclusivo. */
  hasta: Date;
}

export interface ResultadoIva {
  trasladadoCentavos: bigint;
  acreditableCentavos: bigint;
  retenidoCentavos: bigint;
  porPagarCentavos: bigint;
}

function enPeriodo(fecha: Date, periodo: Periodo): boolean {
  return fecha >= periodo.desde && fecha <= periodo.hasta;
}

function sumaLineas(
  cfdis: readonly CfdiParaIva[],
  periodo: Periodo,
  direccion: CfdiParaIva["direccion"],
  clasificacion: ClasificacionImpuesto,
): bigint {
  let total = 0n;
  for (const cfdi of cfdis) {
    if (cfdi.direccion !== direccion) continue;
    if (!cfdi.liquidado || cfdi.fechaLiquidacion === null) continue;
    if (!enPeriodo(cfdi.fechaLiquidacion, periodo)) continue;
    for (const linea of cfdi.impuestosIva) {
      if (linea.clasificacion === clasificacion) total += linea.importeCentavos;
    }
  }
  return total;
}

/**
 * Calcula el IVA del periodo sobre un conjunto de CFDI ya liquidados. No sabe nada de
 * cancelaciones ni de lo declarado — eso es trabajo de contabilidad/cuadre.ts (§3.5).
 */
export function calcularIva(cfdis: readonly CfdiParaIva[], periodo: Periodo): ResultadoIva {
  const trasladadoCentavos = sumaLineas(cfdis, periodo, "emitido", "trasladado");
  const acreditableCentavos = sumaLineas(cfdis, periodo, "recibido", "trasladado");
  const retenidoCentavos = sumaLineas(cfdis, periodo, "emitido", "retenido");

  return {
    trasladadoCentavos,
    acreditableCentavos,
    retenidoCentavos,
    porPagarCentavos: trasladadoCentavos - acreditableCentavos - retenidoCentavos,
  };
}
