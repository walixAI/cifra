// La suite de regresión de la sección 3.7 del README — la tabla que agosto, el trimestre
// jun–ago y el año ene–ago tienen que reproducir exactamente (paso 4 de PRIMEROS-PASOS.md).
//
// Dos tipos de aserción, a propósito distintos:
//
//   1. Invariantes sobre la tabla misma — ingresos − gastos = utilidad, utilidad / ingresos =
//      margen, iva + isr = total, y el trimestre es la suma exacta de sus tres meses. Esto
//      prueba que la tabla del README es consistente consigo misma (una red de seguridad si
//      alguien la edita a mano después), no que el motor la reproduzca.
//   2. Motor de verdad, sobre agosto — el único periodo del que el README da el desglose
//      completo (calculoIvaAgosto y calculoIsrAgosto), así que es el único que se puede correr
//      de punta a punta por calcularIva/evaluarCuadreIva/calcularIsr en vez de solo comparar
//      constantes.
//
// El hallazgo que hay que dejar por escrito aquí: el ISR de agosto que el motor da con la
// tarifa REAL de 2026 (impuestos/isr.ts) NO es $14,320. Es $75,430.66 — ver el porqué en
// __tests__/isr.test.ts. Los $14,320 de esta tabla son una cifra ilustrativa del prototipo,
// nunca calculada con la tarifa 2026 real; no se afirma esa cifra aquí ni en isr.ts.

import { describe, expect, it } from "vitest";
import { evaluarCuadreIva } from "../contabilidad/cuadre";
import { calcularIva, type CfdiParaIva, type Periodo } from "../impuestos/iva";

interface FilaTabla {
  periodo: string;
  ingresosCentavos: bigint | null;
  gastosCentavos: bigint | null;
  utilidadCentavos: bigint | null;
  ivaCentavos: bigint;
  isrCentavos: bigint;
  totalImpuestosCentavos: bigint;
  margenPorcentaje: number | null;
}

// Tal cual la tabla de la sección 3.7 del README, en centavos.
const TABLA_3_7: Record<string, FilaTabla> = {
  mayo: {
    periodo: "Mayo 2026",
    ingresosCentavos: null,
    gastosCentavos: null,
    utilidadCentavos: null,
    ivaCentavos: 714_000n,
    isrCentavos: 1_188_000n,
    totalImpuestosCentavos: 1_902_000n,
    margenPorcentaje: null,
  },
  junio: {
    periodo: "Junio 2026",
    ingresosCentavos: null,
    gastosCentavos: null,
    utilidadCentavos: null,
    ivaCentavos: 801_000n,
    isrCentavos: 1_294_000n,
    totalImpuestosCentavos: 2_095_000n,
    margenPorcentaje: null,
  },
  julio: {
    periodo: "Julio 2026",
    ingresosCentavos: null,
    gastosCentavos: null,
    utilidadCentavos: null,
    ivaCentavos: 786_000n,
    isrCentavos: 1_341_000n,
    totalImpuestosCentavos: 2_127_000n,
    margenPorcentaje: null,
  },
  agosto: {
    periodo: "Agosto 2026",
    ingresosCentavos: 18_542_000n,
    gastosCentavos: 7_428_000n,
    utilidadCentavos: 11_114_000n,
    ivaCentavos: 842_000n,
    isrCentavos: 1_432_000n,
    totalImpuestosCentavos: 2_274_000n,
    margenPorcentaje: 59.9,
  },
  trimestreJunAgo: {
    periodo: "Trimestre jun–ago",
    ingresosCentavos: 51_268_000n,
    gastosCentavos: 22_194_000n,
    utilidadCentavos: 29_074_000n,
    ivaCentavos: 2_429_000n,
    isrCentavos: 4_067_000n,
    totalImpuestosCentavos: 6_496_000n,
    margenPorcentaje: 56.7,
  },
  anioEneAgo: {
    periodo: "Año ene–ago",
    ingresosCentavos: 128_664_000n,
    gastosCentavos: 47_430_000n,
    utilidadCentavos: 81_234_000n,
    ivaCentavos: 5_784_000n,
    isrCentavos: 11_336_000n,
    totalImpuestosCentavos: 17_120_000n,
    margenPorcentaje: 63.1,
  },
  personalizado1AbrA31Ago: {
    periodo: "1 abr – 31 ago",
    ingresosCentavos: 84_291_000n,
    gastosCentavos: 32_918_000n,
    utilidadCentavos: 51_373_000n,
    ivaCentavos: 3_765_000n,
    isrCentavos: 7_077_000n,
    totalImpuestosCentavos: 10_842_000n,
    margenPorcentaje: 60.9,
  },
};

function margenCalculado(fila: FilaTabla): number | null {
  if (fila.ingresosCentavos === null || fila.utilidadCentavos === null) return null;
  // Redondeo a 1 decimal en BigInt (mitad hacia arriba), no truncado: round(a/b) = (a+b/2)/b.
  const decimas =
    (fila.utilidadCentavos * 1000n + fila.ingresosCentavos / 2n) / fila.ingresosCentavos;
  return Number(decimas) / 10;
}

describe("sección 3.7 del README — invariantes de la tabla", () => {
  it.each(Object.entries(TABLA_3_7))("%s: ingresos − gastos = utilidad", (_clave, fila) => {
    if (fila.ingresosCentavos === null) return; // mayo/junio/julio no traen desglose de ingresos
    expect(fila.ingresosCentavos - fila.gastosCentavos!).toBe(fila.utilidadCentavos);
  });

  it.each(Object.entries(TABLA_3_7))("%s: utilidad / ingresos = margen (±0.05 pp)", (_clave, fila) => {
    if (fila.margenPorcentaje === null) return;
    expect(margenCalculado(fila)).toBeCloseTo(fila.margenPorcentaje, 1);
  });

  it.each(Object.entries(TABLA_3_7))("%s: iva + isr = total de impuestos", (_clave, fila) => {
    expect(fila.ivaCentavos + fila.isrCentavos).toBe(fila.totalImpuestosCentavos);
  });

  it("el trimestre jun–ago es la suma exacta de junio + julio + agosto", () => {
    const suma = (campo: keyof FilaTabla) =>
      (TABLA_3_7.junio![campo] as bigint) +
      (TABLA_3_7.julio![campo] as bigint) +
      (TABLA_3_7.agosto![campo] as bigint);

    expect(suma("ivaCentavos")).toBe(TABLA_3_7.trimestreJunAgo!.ivaCentavos);
    expect(suma("isrCentavos")).toBe(TABLA_3_7.trimestreJunAgo!.isrCentavos);
    expect(suma("totalImpuestosCentavos")).toBe(TABLA_3_7.trimestreJunAgo!.totalImpuestosCentavos);
  });
});

describe("sección 3.7 del README — agosto, de punta a punta por el motor", () => {
  const AGOSTO_2026: Periodo = { desde: new Date("2026-08-01"), hasta: new Date("2026-08-31") };

  it("calcularIva reproduce el IVA de agosto exacto: $8,420.00", () => {
    // calculoIvaAgosto de handoff/datos/seed.json: trasladado 24,500 − acreditable 11,885 −
    // retenido 4,195 = 8,420. Aquí se arma un conjunto mínimo de CFDI que suma a esas mismas
    // cifras — no se leen de la base, packages/core es puro.
    const cfdis: CfdiParaIva[] = [
      {
        direccion: "emitido",
        liquidado: true,
        fechaLiquidacion: new Date("2026-08-15"),
        impuestosIva: [
          { clasificacion: "trasladado", importeCentavos: 2_450_000n },
          { clasificacion: "retenido", importeCentavos: 419_500n },
        ],
      },
      {
        direccion: "recibido",
        liquidado: true,
        fechaLiquidacion: new Date("2026-08-15"),
        impuestosIva: [{ clasificacion: "trasladado", importeCentavos: 1_188_500n }],
      },
    ];

    const resultado = calcularIva(cfdis, AGOSTO_2026);

    expect(resultado.porPagarCentavos).toBe(TABLA_3_7.agosto!.ivaCentavos);
    expect(resultado.porPagarCentavos).toBe(842_000n); // $8,420.00 — el número que pide el paso 4
  });

  it("evaluarCuadreIva avisa del CFDI cancelado con la cifra corregida de $8,721.00", () => {
    // §3.4: CFDI 3B77…A20 (Suministros Anáhuac, $2,180) cancelado el 21 de agosto, ya
    // contabilizado en la póliza D-0142, con $301 de acreditable que sigue sumando.
    const calculado = { trasladadoCentavos: 2_450_000n, acreditableCentavos: 1_188_500n, retenidoCentavos: 419_500n };
    const resultado = evaluarCuadreIva(calculado, { porPagarCentavos: 842_000n }, [
      {
        cfdiId: "3B77…A20",
        emisorNombre: "Suministros Anáhuac I",
        polizaId: "poliza-d-0142",
        polizaFolio: "D-0142",
        ivaAcreditableCentavos: 30_100n,
      },
    ]);

    expect(resultado.estado).toBe("warning");
    expect(resultado.porPagarCalculadoCentavos).toBe(842_000n); // $8,420 — cuadra en apariencia
    expect(resultado.porPagarCorregidoCentavos).toBe(872_100n); // $8,721 — la cifra honesta
  });
});
