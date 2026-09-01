import { describe, expect, it } from "vitest";
import { calcularIva, type CfdiParaIva, type Periodo } from "../impuestos/iva";

const AGOSTO_2026: Periodo = { desde: new Date("2026-08-01"), hasta: new Date("2026-08-31") };

describe("calcularIva — sección 3.1 del README (flujo de efectivo)", () => {
  it("agosto 2026: 24,500 − 11,885 − 4,195 = 8,420 (fixture exacto del README)", () => {
    const cfdis: CfdiParaIva[] = [
      {
        direccion: "emitido",
        liquidado: true,
        fechaLiquidacion: new Date("2026-08-10"),
        impuestosIva: [
          { clasificacion: "trasladado", importeCentavos: 2_450_000n },
          { clasificacion: "retenido", importeCentavos: 419_500n },
        ],
      },
      {
        direccion: "recibido",
        liquidado: true,
        fechaLiquidacion: new Date("2026-08-20"),
        impuestosIva: [{ clasificacion: "trasladado", importeCentavos: 1_188_500n }],
      },
    ];

    const resultado = calcularIva(cfdis, AGOSTO_2026);

    expect(resultado).toEqual({
      trasladadoCentavos: 2_450_000n,
      acreditableCentavos: 1_188_500n,
      retenidoCentavos: 419_500n,
      porPagarCentavos: 842_000n, // $8,420.00
    });
  });

  it("una factura emitida SIN cobrar no cuenta como trasladado (flujo de efectivo, no devengado)", () => {
    const cfdis: CfdiParaIva[] = [
      {
        direccion: "emitido",
        liquidado: false,
        fechaLiquidacion: null,
        impuestosIva: [{ clasificacion: "trasladado", importeCentavos: 580_700n }],
      },
    ];

    expect(calcularIva(cfdis, AGOSTO_2026).trasladadoCentavos).toBe(0n);
  });

  it("un gasto SIN pagar no acredita IVA todavía", () => {
    const cfdis: CfdiParaIva[] = [
      {
        direccion: "recibido",
        liquidado: false,
        fechaLiquidacion: new Date("2026-09-02"),
        impuestosIva: [{ clasificacion: "trasladado", importeCentavos: 112_000n }],
      },
    ];

    expect(calcularIva(cfdis, AGOSTO_2026).acreditableCentavos).toBe(0n);
  });

  it("liquidado fuera del periodo no cuenta, aunque esté marcado liquidado=true", () => {
    const cfdis: CfdiParaIva[] = [
      {
        direccion: "recibido",
        liquidado: true,
        fechaLiquidacion: new Date("2026-09-02"), // liquidado en septiembre, no agosto
        impuestosIva: [{ clasificacion: "trasladado", importeCentavos: 112_000n }],
      },
    ];

    expect(calcularIva(cfdis, AGOSTO_2026).acreditableCentavos).toBe(0n);
  });

  it("las fronteras del periodo son inclusivas", () => {
    const cfdis: CfdiParaIva[] = [
      {
        direccion: "emitido",
        liquidado: true,
        fechaLiquidacion: new Date("2026-08-01"),
        impuestosIva: [{ clasificacion: "trasladado", importeCentavos: 100n }],
      },
      {
        direccion: "emitido",
        liquidado: true,
        fechaLiquidacion: new Date("2026-08-31"),
        impuestosIva: [{ clasificacion: "trasladado", importeCentavos: 200n }],
      },
    ];

    expect(calcularIva(cfdis, AGOSTO_2026).trasladadoCentavos).toBe(300n);
  });

  it("sin CFDI en el periodo, todo en cero", () => {
    expect(calcularIva([], AGOSTO_2026)).toEqual({
      trasladadoCentavos: 0n,
      acreditableCentavos: 0n,
      retenidoCentavos: 0n,
      porPagarCentavos: 0n,
    });
  });
});
