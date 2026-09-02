// Vertical de Impuestos (paso 5 de PRIMEROS-PASOS.md) — la lógica de datos, compartida entre
// GET /api/[contribuyente]/impuestos y la pantalla /(app)/[contribuyente]/impuestos. Un solo
// lugar que arma la respuesta; la ruta la sirve como JSON, la pantalla la usa directo.
//
// Usa SIEMPRE el cliente con alcance que devuelve contexto() — nunca el cliente global de
// @cifra/db. El desglose de IVA/ISR se lee de ResumenContribuyente (lo que un trabajo real
// escribiría tras procesar el ledger completo — la muestra de 11 CFDI del seed no son los 246
// del periodo, igual que la cartera del despacho nunca recalcula, ARQUITECTURA-MULTIINQUILINO
// §6). Lo que SÍ se recalcula en vivo, desde el ledger real, es la detección de CFDI cancelados
// que siguen acreditando (§3.4) — la regla más valiosa del producto — y el ISR, con la tarifa
// real de 2026 (ver packages/core/README.md: no reproduce el ISR de la maqueta a propósito).

import type { ClienteConAlcance } from "@cifra/db";
import { evaluarCuadreIva, calcularIsr, type CfdiCanceladoAcreditando } from "@cifra/core";
import { formatearPesos } from "./dinero";

export interface DesgloseIva {
  trasladadoCentavos: bigint;
  acreditableCentavos: bigint;
  retenidoCentavos: bigint;
  porPagarCentavos: bigint;
}

export interface DesgloseIsr {
  ingresosAcumuladosCentavos: bigint;
  deduccionesAcumuladasCentavos: bigint;
  baseCentavos: bigint;
  /** tarifa_art_96(base, meses) — antes de restar nada. */
  isrAcumuladoCentavos: bigint;
  pagosProvisionalesAnterioresCentavos: bigint;
  retencionesPersonasMoralesCentavos: bigint;
  isrDelPeriodoCentavos: bigint;
}

export interface ResultadoCuadreImpuestos {
  estado: "ok" | "warning" | "error";
  porPagarCalculadoCentavos: bigint;
  porPagarCorregidoCentavos: bigint;
  diferenciaCentavos: bigint;
  cfdisCanceladosAcreditando: readonly CfdiCanceladoAcreditando[];
  mensaje: string;
}

export interface ObligacionImpuestos {
  clave: string;
  descripcion: string;
  periodicidad: string;
  fechaLimite: Date;
  accionable: boolean; // DIOT: trae botón de "preparar ahora"
  detalle: string;
}

export interface Retenciones {
  /**
   * Ya aplicadas a los pagos de ESTE periodo — no son saldo pendiente. La del ISR reduce el
   * pago provisional (Art. 106); la del IVA reduce el IVA definitivo (§3.1). Mostrarlas como
   * "a favor" sería contarlas dos veces.
   */
  aplicadasEstePeriodo: {
    isrPersonasMoralesCentavos: bigint;
    ivaPersonasMoralesCentavos: bigint;
  };
  /**
   * Genuinamente a favor: la retención del patrón (sueldos y salarios) no toca los pagos de
   * actividad empresarial — es crédito para la declaración anual.
   */
  aFavorParaLaAnual: {
    isrPatronCentavos: bigint;
  };
}

export interface FilaHistorico {
  periodo: string;
  etiqueta: string;
  ivaCentavos: bigint;
  isrCentavos: bigint;
  totalCentavos: bigint;
  deltaPorcentaje: number | null;
  estado: string; // presentada | estimada | preparada | pagada
  esPeriodoActual: boolean;
}

export interface EstadoSat {
  stale: boolean;
  corte: Date | null;
  ultimoIntento: Date | null;
  error: string | null;
  proximoIntentoEnSegundos: number | null;
}

export type ImpuestosResultado =
  | { tipo: "vacio" }
  | {
      tipo: "datos";
      periodo: string;
      etiqueta: string;
      fechaLimite: Date | null;
      totalImpuestosCentavos: bigint;
      iva: DesgloseIva;
      isr: DesgloseIsr;
      cuadre: ResultadoCuadreImpuestos;
      explicacionIva: string;
      explicacionIsr: string;
      fuentes: string;
      obligaciones: ObligacionImpuestos[];
      retenciones: Retenciones;
      historico: FilaHistorico[];
      sat: EstadoSat;
    };

const NOMBRES_MES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

function etiquetaPeriodo(periodo: string): string {
  const [anioStr, mesStr] = periodo.split("-");
  const mes = NOMBRES_MES[Number(mesStr) - 1] ?? mesStr;
  const capitalizado = mes.charAt(0).toUpperCase() + mes.slice(1);
  return `${capitalizado} ${anioStr}`;
}

// Fechas de calendario, no instantes: medianoche UTC del día que representan. Ver la nota en
// page.tsx — si se formatean en hora del centro, la medianoche UTC cae en el día anterior.
function ultimoDiaDelMes(anio: number, mes1Indexado: number): Date {
  return new Date(Date.UTC(anio, mes1Indexado, 0));
}

/** (diff / base) × 1000, redondeado a entero (mitad hacia arriba) — décimas de punto porcentual. */
function porcentajeADecima(diffCentavos: bigint, baseCentavos: bigint): bigint {
  const signo = diffCentavos < 0n ? -1n : 1n;
  const n = (diffCentavos < 0n ? -diffCentavos : diffCentavos) * 1000n;
  return signo * ((n + baseCentavos / 2n) / baseCentavos);
}

/** Vence el mes siguiente al periodo: día `diaLimite`, o el último día si no hay uno. */
function fechaLimiteMensual(periodo: string, diaLimite: number | null): Date {
  const [anio, mes] = periodo.split("-").map(Number) as [number, number];
  const mesSiguiente = mes === 12 ? 1 : mes + 1;
  const anioSiguiente = mes === 12 ? anio + 1 : anio;
  if (diaLimite === null) return ultimoDiaDelMes(anioSiguiente, mesSiguiente);
  return new Date(Date.UTC(anioSiguiente, mesSiguiente - 1, diaLimite));
}

function fechaLimiteObligacion(
  obligacion: { periodicidad: string; dia_limite: number | null },
  periodo: string,
): Date {
  if (obligacion.periodicidad === "anual") {
    const [anio] = periodo.split("-").map(Number) as [number];
    return new Date(Date.UTC(anio + 1, 3, 30)); // 30 de abril del año siguiente
  }
  return fechaLimiteMensual(periodo, obligacion.dia_limite);
}

function periodoAnterior(periodo: string): string {
  const [anio, mes] = periodo.split("-").map(Number) as [number, number];
  return mes === 1 ? `${anio - 1}-12` : `${anio}-${String(mes - 1).padStart(2, "0")}`;
}

/**
 * Arma la respuesta completa de la vertical de Impuestos para un contribuyente y un periodo.
 * `db` tiene que ser el cliente con alcance de contexto() — nunca el global — y `contribuyenteId`
 * el que devuelve ese mismo contexto().
 *
 * Se filtra por `contribuyente_id` explícitamente en cada consulta. RLS es la red de seguridad
 * debajo del ORM (§4 de ARQUITECTURA-MULTIINQUILINO), no el filtro primario: el código sigue
 * poniendo su `where`. Además, en local se conecta como `postgres` (superusuario, que ignora
 * RLS) salvo que se apunte a `cifra_app` — una razón más para no depender solo de la política.
 */
export async function obtenerImpuestos(
  db: ClienteConAlcance,
  contribuyenteId: string,
  periodoSolicitado?: string,
): Promise<ImpuestosResultado> {
  const [resumenMasReciente, hayDeclaraciones] = await Promise.all([
    db.resumenContribuyente.findFirst({
      where: { contribuyente_id: contribuyenteId },
      orderBy: { periodo: "desc" },
    }),
    db.declaracion.count({ where: { contribuyente_id: contribuyenteId } }),
  ]);

  // Primer uso: nada configurado todavía, ni un resumen ni una declaración.
  if (!resumenMasReciente && hayDeclaraciones === 0) {
    return { tipo: "vacio" };
  }

  const periodo = periodoSolicitado ?? resumenMasReciente?.periodo ?? null;
  if (!periodo) return { tipo: "vacio" };

  const [resumen, obligacionesDb, sincronizaciones, todasLasDeclaraciones] = await Promise.all([
    db.resumenContribuyente.findUnique({
      where: { contribuyente_id_periodo: { contribuyente_id: contribuyenteId, periodo } },
    }),
    db.obligacion.findMany({
      where: { contribuyente_id: contribuyenteId },
      orderBy: { dia_limite: "asc" },
    }),
    db.sincronizacionSat.findMany({
      where: { contribuyente_id: contribuyenteId },
      orderBy: { iniciada_en: "desc" },
      take: 5,
    }),
    db.declaracion.findMany({
      where: { contribuyente_id: contribuyenteId },
      orderBy: [{ periodo: "asc" }, { tipo: "asc" }],
    }),
  ]);

  // ── Estado de la sincronización con el SAT (§7 del README) ────────────────
  const ultimaSincronizacion = sincronizaciones[0] ?? null;
  const ultimaExitosa = sincronizaciones.find((s) => s.estado === "ok") ?? null;
  const sat: EstadoSat = {
    stale: ultimaSincronizacion?.estado === "error",
    corte: ultimaExitosa?.corte ?? null,
    ultimoIntento: ultimaSincronizacion?.iniciada_en ?? null,
    error: ultimaSincronizacion?.estado === "error" ? ultimaSincronizacion.codigo_error : null,
    proximoIntentoEnSegundos: ultimaSincronizacion?.estado === "error" ? 900 : null,
  };

  // ── Histórico mes por mes, con deltas vs. el mes previo ────────────────────
  const porPeriodo = new Map<string, { iva: bigint; isr: bigint; estado: string }>();
  for (const d of todasLasDeclaraciones) {
    const centavos = extraerNetoDeclaracion(d);
    const previo = porPeriodo.get(d.periodo) ?? { iva: 0n, isr: 0n, estado: d.estado };
    if (d.tipo === "iva_definitivo") previo.iva = centavos;
    if (d.tipo === "isr_provisional") previo.isr = centavos;
    previo.estado = d.estado; // toma el último leído; en la práctica ambas coinciden en estado
    porPeriodo.set(d.periodo, previo);
  }
  const periodosOrdenados = [...porPeriodo.keys()].sort();
  const historico: FilaHistorico[] = periodosOrdenados.map((p, indice) => {
    const fila = porPeriodo.get(p)!;
    const total = fila.iva + fila.isr;
    const anterior = indice > 0 ? porPeriodo.get(periodosOrdenados[indice - 1]!) : undefined;
    const totalAnterior = anterior ? anterior.iva + anterior.isr : null;
    const deltaPorcentaje =
      totalAnterior && totalAnterior !== 0n
        ? Number(porcentajeADecima(total - totalAnterior, totalAnterior)) / 10
        : null;
    return {
      periodo: p,
      etiqueta: etiquetaPeriodo(p),
      ivaCentavos: fila.iva,
      isrCentavos: fila.isr,
      totalCentavos: total,
      deltaPorcentaje,
      estado: fila.estado,
      esPeriodoActual: p === periodo,
    };
  });

  // Si el periodo pedido no tiene resumen "vivo" (es un mes ya cerrado), se responde con lo
  // declarado: sin desglose de trasladado/acreditable ni cuadre — eso solo existe para el
  // periodo abierto, que es el único con el ledger detallado detrás.
  const filaHistorico = porPeriodo.get(periodo);
  if (!resumen) {
    if (!filaHistorico) return { tipo: "vacio" };
    const cfdiTotal = await db.cfdi.count({ where: { contribuyente_id: contribuyenteId } });
    const movTotal = await db.movimientoBancario.count({ where: { contribuyente_id: contribuyenteId } });
    return {
      tipo: "datos",
      periodo,
      etiqueta: etiquetaPeriodo(periodo),
      fechaLimite: null,
      totalImpuestosCentavos: filaHistorico.iva + filaHistorico.isr,
      iva: {
        trasladadoCentavos: 0n,
        acreditableCentavos: 0n,
        retenidoCentavos: 0n,
        porPagarCentavos: filaHistorico.iva,
      },
      isr: {
        ingresosAcumuladosCentavos: 0n,
        deduccionesAcumuladasCentavos: 0n,
        baseCentavos: 0n,
        isrAcumuladoCentavos: 0n,
        pagosProvisionalesAnterioresCentavos: 0n,
        retencionesPersonasMoralesCentavos: 0n,
        isrDelPeriodoCentavos: filaHistorico.isr,
      },
      cuadre: {
        estado: "ok",
        porPagarCalculadoCentavos: filaHistorico.iva,
        porPagarCorregidoCentavos: filaHistorico.iva,
        diferenciaCentavos: 0n,
        cfdisCanceladosAcreditando: [],
        mensaje: `${etiquetaPeriodo(periodo)} ya se presentó. No hay cuadre en vivo para un periodo cerrado.`,
      },
      explicacionIva: `${etiquetaPeriodo(periodo)} ya se presentó: el IVA por pagar quedó en ${formatearPesos(filaHistorico.iva)}.`,
      explicacionIsr: `El ISR provisional de ese mes quedó en ${formatearPesos(filaHistorico.isr)}.`,
      fuentes: `${cfdiTotal} CFDI · ${movTotal} movimientos bancarios · declaración ${filaHistorico.estado}`,
      obligaciones: obligacionesDb
        .filter((o) => o.vigente_hasta === null || o.vigente_hasta >= new Date())
        .map((o) => obligacionParaRespuesta(o, periodo)),
      retenciones: {
        aplicadasEstePeriodo: { isrPersonasMoralesCentavos: 0n, ivaPersonasMoralesCentavos: 0n },
        aFavorParaLaAnual: { isrPatronCentavos: 0n },
      },
      historico,
      sat,
    };
  }

  // ── Periodo abierto: cuadre en vivo sobre el ledger real ───────────────────
  const cancelados = await db.cfdi.findMany({
    where: { contribuyente_id: contribuyenteId, estado_sat: "cancelado", polizas: { some: {} } },
    include: {
      polizas: { select: { id: true, folio: true } },
      impuestos: { where: { impuesto: "IVA", clasificacion: "trasladado" } },
    },
  });
  const cfdisCanceladosAcreditando: CfdiCanceladoAcreditando[] = cancelados.map((c) => ({
    cfdiId: c.uuid,
    emisorNombre: c.emisor_nombre,
    polizaId: c.polizas[0]?.id ?? null,
    polizaFolio: c.polizas[0]?.folio ?? null,
    ivaAcreditableCentavos: c.impuestos.reduce((suma, linea) => suma + linea.importe_centavos, 0n),
  }));

  const desgloseIva: DesgloseIva = {
    trasladadoCentavos: resumen.iva_trasladado_centavos,
    acreditableCentavos: resumen.iva_acreditable_centavos,
    retenidoCentavos: resumen.iva_retenido_centavos,
    porPagarCentavos: resumen.iva_centavos,
  };

  const cuadre = evaluarCuadreIva(
    desgloseIva,
    { porPagarCentavos: resumen.iva_centavos },
    cfdisCanceladosAcreditando,
  );

  const [anioStr, mesStr] = periodo.split("-");
  const resultadoIsr = calcularIsr({
    ingresosAcumuladosCentavos: resumen.ingresos_acumulados_centavos,
    deduccionesAcumuladasCentavos: resumen.deducciones_acumuladas_centavos,
    pagosProvisionalesAnterioresCentavos: resumen.isr_pagado_acumulado_centavos,
    retencionesPersonasMoralesCentavos: resumen.isr_retenido_pm_centavos,
    mesDelEjercicio: Number(mesStr),
    ejercicio: Number(anioStr),
  });
  const isr: DesgloseIsr = {
    ingresosAcumuladosCentavos: resumen.ingresos_acumulados_centavos,
    deduccionesAcumuladasCentavos: resumen.deducciones_acumuladas_centavos,
    baseCentavos: resultadoIsr.baseCentavos,
    isrAcumuladoCentavos: resultadoIsr.isrAcumuladoCentavos,
    pagosProvisionalesAnterioresCentavos: resumen.isr_pagado_acumulado_centavos,
    retencionesPersonasMoralesCentavos: resumen.isr_retenido_pm_centavos,
    isrDelPeriodoCentavos: resultadoIsr.isrDelPeriodoCentavos,
  };

  const cfdiTotal = await db.cfdi.count({ where: { contribuyente_id: contribuyenteId } });
  const movTotal = await db.movimientoBancario.count({ where: { contribuyente_id: contribuyenteId } });

  const explicacionIva =
    `Tomé los ${cfdiTotal} CFDI del periodo. De los emitidos y efectivamente cobrados salió el ` +
    `IVA trasladado de ${formatearPesos(desgloseIva.trasladadoCentavos)}; de los recibidos y ` +
    `pagados, el acreditable de ${formatearPesos(desgloseIva.acreditableCentavos)}. Tus clientes ` +
    `personas morales retuvieron ${formatearPesos(desgloseIva.retenidoCentavos)}, así que tu IVA ` +
    `a cargo queda en ${formatearPesos(desgloseIva.porPagarCentavos)}.`;

  const explicacionIsr =
    `Para el ISR acumulé ingresos de enero a ${etiquetaPeriodo(periodo).toLowerCase()} ` +
    `(${formatearPesos(isr.ingresosAcumuladosCentavos)}) menos deducciones autorizadas ` +
    `(${formatearPesos(isr.deduccionesAcumuladasCentavos)}), apliqué la tarifa del artículo 96 ` +
    `de 2026: ${formatearPesos(isr.isrAcumuladoCentavos)}. De ahí resté lo que ya pagaste en ` +
    `provisionales anteriores (${formatearPesos(isr.pagosProvisionalesAnterioresCentavos)}) y ` +
    `el 10% que te retuvieron tus clientes personas morales ` +
    `(${formatearPesos(isr.retencionesPersonasMoralesCentavos)}): tu pago de este mes queda en ` +
    `${formatearPesos(isr.isrDelPeriodoCentavos)}.`;

  return {
    tipo: "datos",
    periodo,
    etiqueta: etiquetaPeriodo(periodo),
    fechaLimite: resumen.proxima_obligacion,
    totalImpuestosCentavos: cuadre.porPagarCalculadoCentavos + isr.isrDelPeriodoCentavos,
    iva: desgloseIva,
    isr,
    cuadre,
    explicacionIva,
    explicacionIsr,
    fuentes: `${cfdiTotal} CFDI · ${movTotal} movimientos bancarios · corte ${sat.corte ? sat.corte.toISOString() : "sin sincronizar"}`,
    obligaciones: obligacionesDb
      .filter((o) => o.vigente_hasta === null || o.vigente_hasta >= new Date())
      .map((o) => obligacionParaRespuesta(o, periodo)),
    retenciones: {
      aplicadasEstePeriodo: {
        isrPersonasMoralesCentavos: resumen.isr_retenido_pm_centavos,
        ivaPersonasMoralesCentavos: resumen.iva_retenido_centavos,
      },
      aFavorParaLaAnual: {
        isrPatronCentavos: resumen.isr_retenido_patron_centavos,
      },
    },
    historico,
    sat,
  };
}

function extraerNetoDeclaracion(d: { tipo: string; calculo: unknown }): bigint {
  const calculo = d.calculo as Record<string, unknown>;
  const clave = d.tipo === "iva_definitivo" ? "por_pagar_centavos" : "del_periodo_centavos";
  const valor = calculo[clave];
  return typeof valor === "string" ? BigInt(valor) : 0n;
}

function obligacionParaRespuesta(
  o: { clave: string; descripcion: string; periodicidad: string; dia_limite: number | null },
  periodo: string,
): ObligacionImpuestos {
  const esDiot = o.clave === "diot";
  return {
    clave: o.clave,
    descripcion: o.descripcion,
    periodicidad: o.periodicidad,
    fechaLimite: fechaLimiteObligacion(o, periodo),
    accionable: esDiot,
    detalle:
      o.periodicidad === "anual"
        ? "Incluye tus ingresos por sueldos y salarios"
        : `${o.periodicidad === "mensual" ? "Mensual" : "Bimestral"}${
            o.dia_limite ? ` · día ${o.dia_limite} del mes siguiente` : " · último día del mes siguiente"
          }`,
  };
}

export { periodoAnterior };
