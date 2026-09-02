// Suite de regresión de la sección 3.7 del README — la tabla que agosto, el trimestre jun–ago
// y el año ene–ago tienen que reproducir exactamente (paso 4 de PRIMEROS-PASOS.md).
//
// Historia de esta tabla: los números de ISR del fixture original ($11,880 / $12,940 / $13,410
// / $14,320) eran ficticios — nunca salieron de aplicar la tarifa real a la base. Se
// recalcularon con la tarifa real de 2026 (Anexo 8) y con la fórmula completa del artículo 106,
// que incluye restar el ISR retenido por personas morales (§3.2, corregido). Los números de IVA
// no se tocaron: esos sí cuadraban.
//
// Reconstrucción de los meses: el fixture da los agregados (utilidad de agosto, de jun–ago, de
// ene–ago, de abr–ago) pero NO la utilidad mes a mes de abril, mayo, junio y julio. Donde falta
// el dato, se parte la utilidad del par por igual (abr=may, jun=jul). Ese supuesto solo mueve
// el valor de las filas individuales de esos meses; los invariantes se cumplen igual, porque el
// pago de cada mes es CumPago(m) − CumPago(m−1) y la suma telescópica no depende del reparto
// interno.

import { describe, expect, it } from "vitest";
import { calcularIsr, aplicarTarifaIsr } from "../impuestos/isr";
import { evaluarCuadreIva } from "../contabilidad/cuadre";
import { calcularIva, type CfdiParaIva, type Periodo } from "../impuestos/iva";

const EJERCICIO = 2026;
const RETENCION_PM_ACUMULADA_AGOSTO = 427_500n; // $4,275.00 — 10% ISR sobre servicios profesionales

/** Redondeo mitad hacia arriba en centavos enteros — mismo criterio que impuestos/isr.ts. */
function repartirRetencion(mes: number): bigint {
  return (RETENCION_PM_ACUMULADA_AGOSTO * BigInt(mes) + 4n) / 8n;
}

// Bases acumuladas a fin de mes (ingresos acumulados − deducciones acumuladas), en centavos.
// Derivadas de los agregados del fixture (§3.7) + el reparto por igual de los pares sin dato.
const BASE_MARZO = 29_861_000n; // = base_ago − utilidad(abr–ago) = 81,234,000 − 51,373,000
const UTILIDAD_ABR_MAY = 52_160_000n - BASE_MARZO; // base_may − base_mar
const BASE_ABRIL = BASE_MARZO + UTILIDAD_ABR_MAY / 2n; // supuesto: abril = mayo
const BASE_MAYO = 52_160_000n; // = base_ago − utilidad(jun–ago) = 81,234,000 − 29,074,000
const UTILIDAD_JUN_JUL = 70_120_000n - BASE_MAYO; // base_jul − base_may
const BASE_JUNIO = BASE_MAYO + UTILIDAD_JUN_JUL / 2n; // supuesto: junio = julio
const BASE_JULIO = 70_120_000n; // = base_ago − utilidad(agosto) = 81,234,000 − 11,114,000
const BASE_AGOSTO = 81_234_000n; // = ingresos ene–ago − deducciones ene–ago

/** ISR pagado acumulado hasta fin de mes m = tarifa(base_m, m) − retención acumulada_m. */
function cumPago(baseCentavos: bigint, mes: number): bigint {
  return aplicarTarifaIsr(baseCentavos, mes, EJERCICIO) - repartirRetencion(mes);
}

describe("sección 3.7 — reconstrucción del ISR con la tarifa real de 2026", () => {
  const cumMarzo = cumPago(BASE_MARZO, 3);
  const cumAbril = cumPago(BASE_ABRIL, 4);
  const cumMayo = cumPago(BASE_MAYO, 5);
  const cumJunio = cumPago(BASE_JUNIO, 6);
  const cumJulio = cumPago(BASE_JULIO, 7);
  const cumAgosto = cumPago(BASE_AGOSTO, 8);

  const isrMayo = cumMayo - cumAbril;
  const isrJunio = cumJunio - cumMayo;
  const isrJulio = cumJulio - cumJunio;
  const isrAgosto = cumAgosto - cumJulio;

  it("pago provisional de cada mes (para el histórico de la pantalla de Impuestos)", () => {
    expect(isrMayo).toBe(2_665_021n); // $26,650.21
    expect(isrJunio).toBe(2_014_171n); // $20,141.71
    expect(isrJulio).toBe(2_014_170n); // $20,141.70
    expect(isrAgosto).toBe(2_654_371n); // $26,543.71
  });

  it("trimestre jun–ago = suma exacta de sus tres meses (invariante de CLAUDE.md)", () => {
    const trimestre = isrJunio + isrJulio + isrAgosto;
    expect(trimestre).toBe(6_682_712n); // $66,827.12
    expect(trimestre).toBe(cumAgosto - cumMayo); // se cumple por construcción telescópica
  });

  it("acumulado ene–ago = todo el ISR provisional del ejercicio hasta agosto", () => {
    expect(cumAgosto).toBe(18_931_566n); // $189,315.66
  });

  it("1 abr – 31 ago", () => {
    expect(cumAgosto - cumMarzo).toBe(12_012_754n); // $120,127.54
  });

  it("agosto de punta a punta por calcularIsr(): base, tarifa acumulada, y el pago del mes", () => {
    const r = calcularIsr({
      ingresosAcumuladosCentavos: 128_664_000n, // $1,286,640.00
      deduccionesAcumuladasCentavos: 47_430_000n, // $474,300.00
      pagosProvisionalesAnterioresCentavos: cumJulio, // $162,771.95 — CumPago real a julio, no el ficticio
      retencionesPersonasMoralesCentavos: RETENCION_PM_ACUMULADA_AGOSTO,
      mesDelEjercicio: 8,
      ejercicio: EJERCICIO,
    });

    expect(r.baseCentavos).toBe(81_234_000n); // $812,340.00 — coincide con el README
    expect(r.isrAcumuladoCentavos).toBe(19_359_066n); // $193,590.66 — tarifa Anexo 8 ×8 meses
    expect(r.isrDelPeriodoCentavos).toBe(2_654_371n); // $26,543.71 = tarifa − pagos previos − retención
  });
});

const TABLA_3_7 = {
  mayo: { ivaCentavos: 714_000n, isrCentavos: 2_665_021n, totalCentavos: 3_379_021n },
  junio: { ivaCentavos: 801_000n, isrCentavos: 2_014_171n, totalCentavos: 2_815_171n },
  julio: { ivaCentavos: 786_000n, isrCentavos: 2_014_170n, totalCentavos: 2_800_170n },
  agosto: { ivaCentavos: 842_000n, isrCentavos: 2_654_371n, totalCentavos: 3_496_371n },
  trimestreJunAgo: { ivaCentavos: 2_429_000n, isrCentavos: 6_682_712n, totalCentavos: 9_111_712n },
  anioEneAgo: { ivaCentavos: 5_784_000n, isrCentavos: 18_931_566n, totalCentavos: 24_715_566n },
  personalizado1AbrA31Ago: { ivaCentavos: 3_765_000n, isrCentavos: 12_012_754n, totalCentavos: 15_777_754n },
} as const;

describe("sección 3.7 — invariantes de la tabla corregida", () => {
  it.each(Object.entries(TABLA_3_7))("%s: iva + isr = total", (_clave, fila) => {
    expect(fila.ivaCentavos + fila.isrCentavos).toBe(fila.totalCentavos);
  });

  it("el trimestre jun–ago es la suma exacta de junio + julio + agosto (IVA, ISR y total)", () => {
    const suma = (campo: "ivaCentavos" | "isrCentavos" | "totalCentavos") =>
      TABLA_3_7.junio[campo] + TABLA_3_7.julio[campo] + TABLA_3_7.agosto[campo];
    expect(suma("ivaCentavos")).toBe(TABLA_3_7.trimestreJunAgo.ivaCentavos);
    expect(suma("isrCentavos")).toBe(TABLA_3_7.trimestreJunAgo.isrCentavos);
    expect(suma("totalCentavos")).toBe(TABLA_3_7.trimestreJunAgo.totalCentavos);
  });

  it("los números de IVA no se tocaron — siguen siendo los del fixture original", () => {
    expect(TABLA_3_7.mayo.ivaCentavos).toBe(714_000n);
    expect(TABLA_3_7.junio.ivaCentavos).toBe(801_000n);
    expect(TABLA_3_7.julio.ivaCentavos).toBe(786_000n);
    expect(TABLA_3_7.agosto.ivaCentavos).toBe(842_000n);
  });
});

describe("sección 3.7 — agosto, IVA y cuadre de punta a punta por el motor", () => {
  const AGOSTO_2026: Periodo = { desde: new Date("2026-08-01"), hasta: new Date("2026-08-31") };

  it("calcularIva reproduce el IVA de agosto exacto: $8,420.00", () => {
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
    expect(calcularIva(cfdis, AGOSTO_2026).porPagarCentavos).toBe(842_000n);
  });

  it("evaluarCuadreIva avisa del CFDI cancelado con la cifra corregida de $8,721.00", () => {
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
    expect(resultado.porPagarCalculadoCentavos).toBe(842_000n);
    expect(resultado.porPagarCorregidoCentavos).toBe(872_100n);
  });
});
