// Generación automática de pólizas — desde CFDI y desde movimiento bancario (paso 4 de
// PRIMEROS-PASOS.md). Invariante que se hace valer aquí, no después: SUM(debe) = SUM(haber)
// (regla 3 de CLAUDE.md, y la fila "Póliza" de la sección 5 del README). Una póliza que no
// cuadra nunca sale de esta función: se lanza PolizaDescuadradaError.
//
// packages/core no conoce el catálogo de cuentas de nadie: las cuentas contables a usar llegan
// como parámetro (`cuentas`), resueltas por quien llama (el servicio de dominio, con el
// catálogo real del contribuyente). Este módulo solo sabe partida doble.

export type TipoPoliza = "diario" | "ingresos" | "egresos";
export type OrigenPoliza = "cfdi" | "banco" | "manual";

export interface LineaAsiento {
  cuentaContableId: string;
  debeCentavos: bigint;
  haberCentavos: bigint;
}

export interface PolizaGenerada {
  tipo: TipoPoliza;
  concepto: string;
  origenTipo: OrigenPoliza;
  origenTexto: string;
  asientos: readonly LineaAsiento[];
}

export class PolizaDescuadradaError extends Error {
  constructor(
    public readonly debeCentavos: bigint,
    public readonly haberCentavos: bigint,
  ) {
    super(`La póliza no cuadra: debe ${debeCentavos} ≠ haber ${haberCentavos}.`);
    this.name = "PolizaDescuadradaError";
  }
}

/** SUM(debe) = SUM(haber), o se rechaza — regla 3 de CLAUDE.md. */
export function validarPartidaDoble(asientos: readonly LineaAsiento[]): void {
  const debeCentavos = asientos.reduce((suma, a) => suma + a.debeCentavos, 0n);
  const haberCentavos = asientos.reduce((suma, a) => suma + a.haberCentavos, 0n);
  if (debeCentavos !== haberCentavos) {
    throw new PolizaDescuadradaError(debeCentavos, haberCentavos);
  }
}

// ── Desde CFDI ──────────────────────────────────────────────────────────────────

export interface LineaImpuestoParaPoliza {
  clasificacion: "trasladado" | "retenido";
  importeCentavos: bigint;
}

export interface CfdiParaPoliza {
  direccion: "emitido" | "recibido";
  emisorNombre: string;
  receptorNombre: string;
  subtotalCentavos: bigint;
  totalCentavos: bigint;
  impuestosIva: readonly LineaImpuestoParaPoliza[];
}

export interface CuentasParaPolizaCfdi {
  /** La cuenta de gasto (recibido) o de ingreso (emitido) — la que ya trae el CFDI. */
  cuentaGastoOIngresoId: string;
  /** Requerida si el CFDI recibido trae IVA trasladado (= acreditable para quien lo recibe). */
  cuentaIvaAcreditableId?: string;
  /** Requerida si el CFDI emitido trae IVA trasladado. */
  cuentaIvaTrasladadoId?: string;
  /** Banco, si ya se cobró/pagó; clientes o proveedores, si sigue pendiente. */
  cuentaContrapartidaId: string;
}

function sumaPorClasificacion(
  impuestos: readonly LineaImpuestoParaPoliza[],
  clasificacion: LineaImpuestoParaPoliza["clasificacion"],
): bigint {
  return impuestos
    .filter((l) => l.clasificacion === clasificacion)
    .reduce((suma, l) => suma + l.importeCentavos, 0n);
}

/**
 * Póliza de diario desde un CFDI (§3.6 del README, ejemplos de handoff/datos/seed.json). Un
 * CFDI recibido (gasto): debe la cuenta de gasto, debe el IVA acreditable, haber la
 * contrapartida. Un CFDI emitido (ingreso): debe la contrapartida, haber el ingreso, haber el
 * IVA trasladado.
 */
export function generarPolizaDesdeCfdi(
  cfdi: CfdiParaPoliza,
  cuentas: CuentasParaPolizaCfdi,
): PolizaGenerada {
  const ivaTrasladadoCentavos = sumaPorClasificacion(cfdi.impuestosIva, "trasladado");
  const asientos: LineaAsiento[] = [];

  if (cfdi.direccion === "recibido") {
    asientos.push({
      cuentaContableId: cuentas.cuentaGastoOIngresoId,
      debeCentavos: cfdi.subtotalCentavos,
      haberCentavos: 0n,
    });
    if (ivaTrasladadoCentavos > 0n) {
      if (!cuentas.cuentaIvaAcreditableId) {
        throw new Error("El CFDI trae IVA pero no se dio cuentaIvaAcreditableId.");
      }
      asientos.push({
        cuentaContableId: cuentas.cuentaIvaAcreditableId,
        debeCentavos: ivaTrasladadoCentavos,
        haberCentavos: 0n,
      });
    }
    asientos.push({
      cuentaContableId: cuentas.cuentaContrapartidaId,
      debeCentavos: 0n,
      haberCentavos: cfdi.totalCentavos,
    });
  } else {
    asientos.push({
      cuentaContableId: cuentas.cuentaContrapartidaId,
      debeCentavos: cfdi.totalCentavos,
      haberCentavos: 0n,
    });
    asientos.push({
      cuentaContableId: cuentas.cuentaGastoOIngresoId,
      debeCentavos: 0n,
      haberCentavos: cfdi.subtotalCentavos,
    });
    if (ivaTrasladadoCentavos > 0n) {
      if (!cuentas.cuentaIvaTrasladadoId) {
        throw new Error("El CFDI trae IVA pero no se dio cuentaIvaTrasladadoId.");
      }
      asientos.push({
        cuentaContableId: cuentas.cuentaIvaTrasladadoId,
        debeCentavos: 0n,
        haberCentavos: ivaTrasladadoCentavos,
      });
    }
  }

  validarPartidaDoble(asientos);

  const contraparte = cfdi.direccion === "recibido" ? cfdi.emisorNombre : cfdi.receptorNombre;
  return {
    tipo: "diario",
    concepto: `CFDI ${cfdi.direccion === "recibido" ? "de" : "para"} ${contraparte}`,
    origenTipo: "cfdi",
    origenTexto: `Generada automáticamente desde el CFDI ${cfdi.direccion === "recibido" ? "de" : "para"} ${contraparte}.`,
    asientos,
  };
}

// ── Desde movimiento bancario ────────────────────────────────────────────────────

export interface MovimientoParaPoliza {
  /** Firmado: positivo es abono (entra dinero), negativo es cargo — mismo signo que el README. */
  montoCentavos: bigint;
  descripcionBanco: string;
}

export interface CuentasParaPolizaMovimiento {
  cuentaBancoId: string;
  /** Clientes (se cobró una cuenta por cobrar), proveedores, gasto directo, etc. */
  cuentaContrapartidaId: string;
}

/**
 * Póliza desde un movimiento bancario conciliado. Un abono (dinero que entra) es un cobro:
 * tipo "ingresos", debe banco, haber la contrapartida. Un cargo (dinero que sale) es un pago:
 * tipo "egresos", debe la contrapartida, haber banco.
 */
export function generarPolizaDesdeMovimiento(
  movimiento: MovimientoParaPoliza,
  cuentas: CuentasParaPolizaMovimiento,
): PolizaGenerada {
  if (movimiento.montoCentavos === 0n) {
    throw new Error("Un movimiento en cero no genera póliza.");
  }
  const esAbono = movimiento.montoCentavos > 0n;
  const montoCentavos = esAbono ? movimiento.montoCentavos : -movimiento.montoCentavos;

  const asientos: LineaAsiento[] = esAbono
    ? [
        { cuentaContableId: cuentas.cuentaBancoId, debeCentavos: montoCentavos, haberCentavos: 0n },
        { cuentaContableId: cuentas.cuentaContrapartidaId, debeCentavos: 0n, haberCentavos: montoCentavos },
      ]
    : [
        { cuentaContableId: cuentas.cuentaContrapartidaId, debeCentavos: montoCentavos, haberCentavos: 0n },
        { cuentaContableId: cuentas.cuentaBancoId, debeCentavos: 0n, haberCentavos: montoCentavos },
      ];

  validarPartidaDoble(asientos);

  return {
    tipo: esAbono ? "ingresos" : "egresos",
    concepto: movimiento.descripcionBanco,
    origenTipo: "banco",
    origenTexto: `Generada automáticamente desde el movimiento bancario: ${movimiento.descripcionBanco}.`,
    asientos,
  };
}
