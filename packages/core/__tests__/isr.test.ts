import { describe, expect, it } from "vitest";
import { aplicarTarifaIsr, calcularIsr, TarifaNoDisponibleError } from "../impuestos/isr";

describe("aplicarTarifaIsr — tarifa acumulada del artículo 96, tarifas/2026.json", () => {
  it("un mes, primer tramo: cuota fija 0 + 1.92% sobre el excedente", () => {
    // Base $500.00 (50000 centavos), tramo 1: 1–84459, cuota 0, 1.92%.
    // excedente = 49999; 49999×192/10000 = 959.9808 → redondea a 960.
    expect(aplicarTarifaIsr(50_000n, 1, 2026)).toBe(960n);
  });

  it("justo en el límite inferior de un tramo, el ISR es exactamente su cuota fija", () => {
    // Un mes: límite inferior del tramo 2 = 84460 centavos, cuota fija = 1622.
    expect(aplicarTarifaIsr(84_460n, 1, 2026)).toBe(1_622n);
  });

  it("los límites y la cuota fija escalan con los meses transcurridos, el porcentaje no", () => {
    // Mismo tramo 2, pero a 3 meses: límites y cuota ×3, porcentaje igual (6.40%).
    // límite inferior ×3 = 253380; ahí el excedente es 0 → ISR = cuota fija ×3 = 4866.
    expect(aplicarTarifaIsr(253_380n, 3, 2026)).toBe(4_866n);
  });

  it("base en o por debajo de cero da ISR cero", () => {
    expect(aplicarTarifaIsr(0n, 8, 2026)).toBe(0n);
    expect(aplicarTarifaIsr(-500n, 8, 2026)).toBe(0n);
  });

  it("meses transcurridos fuera de 1–12 lanza", () => {
    expect(() => aplicarTarifaIsr(1000n, 0, 2026)).toThrow(RangeError);
    expect(() => aplicarTarifaIsr(1000n, 13, 2026)).toThrow(RangeError);
  });

  it("un ejercicio sin tarifa versionada lanza TarifaNoDisponibleError, no calcula con la de otro año", () => {
    expect(() => aplicarTarifaIsr(1000n, 8, 2027)).toThrow(TarifaNoDisponibleError);
  });
});

describe("calcularIsr — sección 3.2 del README (con la resta de retenciones)", () => {
  it("agosto 2026, insumos reales: tarifa − pagos previos reales − retención del 10%", () => {
    // Base = 1,286,640.00 − 474,300.00 = 812,340.00 (§3.7 del README).
    // pagos previos = CumPago real a julio ($162,771.95), NO el $118,160 ficticio del fixture
    // original — ese número se recalculó junto con la tabla de §3.7. Ver
    // __tests__/regresion-3-7.test.ts para la reconstrucción completa.
    const resultado = calcularIsr({
      ingresosAcumuladosCentavos: 128_664_000n,
      deduccionesAcumuladasCentavos: 47_430_000n,
      pagosProvisionalesAnterioresCentavos: 16_277_195n, // $162,771.95
      retencionesPersonasMoralesCentavos: 427_500n, // $4,275.00 (10% ISR, acumulado a agosto)
      mesDelEjercicio: 8,
      ejercicio: 2026,
    });

    expect(resultado.baseCentavos).toBe(81_234_000n); // $812,340.00
    expect(resultado.isrAcumuladoCentavos).toBe(19_359_066n); // $193,590.66 — tarifa real ×8 meses
    expect(resultado.isrDelPeriodoCentavos).toBe(2_654_371n); // $26,543.71 — el pago del mes
  });

  it("la retención es opcional: sin ella, ISR del periodo = tarifa − pagos previos", () => {
    const base = {
      ingresosAcumuladosCentavos: 128_664_000n,
      deduccionesAcumuladasCentavos: 47_430_000n,
      pagosProvisionalesAnterioresCentavos: 16_277_195n,
      mesDelEjercicio: 8,
      ejercicio: 2026,
    };
    const sinRetencion = calcularIsr(base);
    const conRetencion = calcularIsr({ ...base, retencionesPersonasMoralesCentavos: 427_500n });
    expect(sinRetencion.isrDelPeriodoCentavos - conRetencion.isrDelPeriodoCentavos).toBe(427_500n);
  });

  it("nunca devuelve un pago negativo: si retenciones + pagos previos superan la tarifa, es 0", () => {
    const resultado = calcularIsr({
      ingresosAcumuladosCentavos: 128_664_000n,
      deduccionesAcumuladasCentavos: 47_430_000n,
      pagosProvisionalesAnterioresCentavos: 19_000_000n,
      retencionesPersonasMoralesCentavos: 5_000_000n, // 19M + 5M > tarifa 19.36M
      mesDelEjercicio: 8,
      ejercicio: 2026,
    });
    expect(resultado.isrAcumuladoCentavos).toBe(19_359_066n);
    expect(resultado.isrDelPeriodoCentavos).toBe(0n);
  });

  it("deducciones mayores a los ingresos dan base y ISR en cero, no negativos", () => {
    const resultado = calcularIsr({
      ingresosAcumuladosCentavos: 100_000n,
      deduccionesAcumuladasCentavos: 500_000n,
      pagosProvisionalesAnterioresCentavos: 0n,
      mesDelEjercicio: 3,
      ejercicio: 2026,
    });

    expect(resultado.baseCentavos).toBe(-400_000n); // se reporta la base real, aunque sea negativa
    expect(resultado.isrAcumuladoCentavos).toBe(0n); // pero la tarifa nunca se aplica a una base negativa
    expect(resultado.isrDelPeriodoCentavos).toBe(0n);
  });

  it("es determinista: mismos insumos, mismo resultado", () => {
    const datos = {
      ingresosAcumuladosCentavos: 500_000n,
      deduccionesAcumuladasCentavos: 200_000n,
      pagosProvisionalesAnterioresCentavos: 1_000n,
      retencionesPersonasMoralesCentavos: 500n,
      mesDelEjercicio: 5,
      ejercicio: 2026,
    };
    expect(calcularIsr(datos)).toEqual(calcularIsr({ ...datos }));
  });
});
