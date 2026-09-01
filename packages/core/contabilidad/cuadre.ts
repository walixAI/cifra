// Cuadre de IVA — panel de validación (§3.5 del README). Tres salidas, en orden de prioridad:
//
//   1. trasladado − acreditable − retenido ≠ por pagar declarado → error, diferencia sin explicar.
//   2. La aritmética cuadra, pero parte del acreditable viene de un CFDI ya cancelado en el SAT
//      → warning, con la cifra corregida y la póliza a revisar (regla 2 de CLAUDE.md — la más
//      valiosa del producto).
//   3. Si no, ok.

import type { ResultadoIva } from "../impuestos/iva";

export type EstadoCuadre = "error" | "warning" | "ok";

/** Un CFDI cancelado en el SAT cuyo IVA acreditable sigue sumando en el cálculo — §3.4. */
export interface CfdiCanceladoAcreditando {
  cfdiId: string;
  emisorNombre: string;
  polizaId: string | null;
  polizaFolio: string | null;
  ivaAcreditableCentavos: bigint;
}

export interface DeclaracionIva {
  porPagarCentavos: bigint;
}

export interface ResultadoCuadre {
  estado: EstadoCuadre;
  /** trasladado − acreditable − retenido, tal como está el libro mayor hoy. */
  porPagarCalculadoCentavos: bigint;
  /** Lo mismo, pero sin el acreditable de los CFDI ya cancelados — la cifra honesta. */
  porPagarCorregidoCentavos: bigint;
  /** calculado − declarado. Distinto de cero solo en estado "error". */
  diferenciaCentavos: bigint;
  cfdisCanceladosAcreditando: readonly CfdiCanceladoAcreditando[];
  mensaje: string;
}

function conSeparadoresDeMiles(digitos: string): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Únicamente para el texto de `mensaje` (copy de UI). Las cifras que de verdad importan viajan
// como BigInt en centavos en el resto del resultado — regla "se formatea en la orilla".
function pesos(centavos: bigint): string {
  const negativo = centavos < 0n;
  const abs = negativo ? -centavos : centavos;
  const enteros = conSeparadoresDeMiles((abs / 100n).toString());
  const decimales = (abs % 100n).toString().padStart(2, "0");
  return `${negativo ? "-" : ""}$${enteros}.${decimales}`;
}

/**
 * Evalúa el cuadre de IVA de un periodo. `calculado` es la salida de impuestos/iva.ts;
 * `declarado` es lo que se presentó (o se piensa presentar); `cfdisCanceladosAcreditando` los
 * detecta el barrido de validez (apps/trabajos/sat-validez, fuera de este paquete) — aquí solo
 * se evalúa lo que ya se encontró.
 */
export function evaluarCuadreIva(
  calculado: Pick<ResultadoIva, "trasladadoCentavos" | "acreditableCentavos" | "retenidoCentavos">,
  declarado: DeclaracionIva,
  cfdisCanceladosAcreditando: readonly CfdiCanceladoAcreditando[] = [],
): ResultadoCuadre {
  const porPagarCalculadoCentavos =
    calculado.trasladadoCentavos - calculado.acreditableCentavos - calculado.retenidoCentavos;
  const diferenciaCentavos = porPagarCalculadoCentavos - declarado.porPagarCentavos;

  const ivaDeCanceladosCentavos = cfdisCanceladosAcreditando.reduce(
    (suma, c) => suma + c.ivaAcreditableCentavos,
    0n,
  );
  // Sin el acreditable de los cancelados, el acreditable real es menor → el por pagar sube.
  const porPagarCorregidoCentavos = porPagarCalculadoCentavos + ivaDeCanceladosCentavos;

  if (diferenciaCentavos !== 0n) {
    return {
      estado: "error",
      porPagarCalculadoCentavos,
      porPagarCorregidoCentavos,
      diferenciaCentavos,
      cfdisCanceladosAcreditando,
      mensaje:
        `La aritmética no cuadra: trasladado − acreditable − retenido da ${pesos(porPagarCalculadoCentavos)}, ` +
        `pero lo declarado es ${pesos(declarado.porPagarCentavos)} ` +
        `(diferencia de ${pesos(diferenciaCentavos)}).`,
    };
  }

  if (cfdisCanceladosAcreditando.length > 0) {
    const folios = cfdisCanceladosAcreditando
      .map((c) => c.polizaFolio ?? c.cfdiId)
      .join(", ");
    return {
      estado: "warning",
      porPagarCalculadoCentavos,
      porPagarCorregidoCentavos,
      diferenciaCentavos: 0n,
      cfdisCanceladosAcreditando,
      mensaje:
        `Cuadra en apariencia, pero ${cfdisCanceladosAcreditando.length} CFDI cancelado(s) en el SAT ` +
        `(${folios}) siguen acreditando ${pesos(ivaDeCanceladosCentavos)}. ` +
        `La cifra corregida es ${pesos(porPagarCorregidoCentavos)}.`,
    };
  }

  return {
    estado: "ok",
    porPagarCalculadoCentavos,
    porPagarCorregidoCentavos: porPagarCalculadoCentavos,
    diferenciaCentavos: 0n,
    cfdisCanceladosAcreditando: [],
    mensaje: "El cuadre de IVA está en orden.",
  };
}
