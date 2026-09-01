import { describe, expect, it } from "vitest";
import {
  generarPolizaDesdeCfdi,
  generarPolizaDesdeMovimiento,
  PolizaDescuadradaError,
  validarPartidaDoble,
  type CfdiParaPoliza,
  type CuentasParaPolizaCfdi,
} from "../contabilidad/poliza";

// Las cinco pólizas reales de handoff/datos/seed.json (§3.6 del README): cada prueba reconstruye
// el CFDI o movimiento de origen y confirma que el generador produce EXACTAMENTE los mismos
// asientos que trae el fixture — no una cifra parecida.

describe("generarPolizaDesdeCfdi — gastos (CFDI recibido)", () => {
  it("D-0147: renta de oficina · Inmuebles Escobedo 193", () => {
    const cfdi: CfdiParaPoliza = {
      direccion: "recibido",
      emisorNombre: "Inmuebles Escobedo 193",
      receptorNombre: "José A. Torres",
      subtotalCentavos: 1_551_700n,
      totalCentavos: 1_800_000n,
      impuestosIva: [{ clasificacion: "trasladado", importeCentavos: 248_300n }],
    };
    const cuentas: CuentasParaPolizaCfdi = {
      cuentaGastoOIngresoId: "6100-01",
      cuentaIvaAcreditableId: "1180-01",
      cuentaContrapartidaId: "1120-01", // banco: ya se pagó
    };

    const poliza = generarPolizaDesdeCfdi(cfdi, cuentas);

    expect(poliza.tipo).toBe("diario");
    expect(poliza.asientos).toEqual([
      { cuentaContableId: "6100-01", debeCentavos: 1_551_700n, haberCentavos: 0n },
      { cuentaContableId: "1180-01", debeCentavos: 248_300n, haberCentavos: 0n },
      { cuentaContableId: "1120-01", debeCentavos: 0n, haberCentavos: 1_800_000n },
    ]);
  });

  it("D-0146: publicidad digital · Publicidad Meridiano (contrapartida proveedores, no banco: sigue sin pagarse)", () => {
    const cfdi: CfdiParaPoliza = {
      direccion: "recibido",
      emisorNombre: "Publicidad Meridiano",
      receptorNombre: "José A. Torres",
      subtotalCentavos: 700_000n,
      totalCentavos: 812_000n,
      impuestosIva: [{ clasificacion: "trasladado", importeCentavos: 112_000n }],
    };
    const cuentas: CuentasParaPolizaCfdi = {
      cuentaGastoOIngresoId: "6100-07",
      cuentaIvaAcreditableId: "1180-01",
      cuentaContrapartidaId: "2110-01", // proveedores: SPEI todavía programado
    };

    const poliza = generarPolizaDesdeCfdi(cfdi, cuentas);

    expect(poliza.asientos).toEqual([
      { cuentaContableId: "6100-07", debeCentavos: 700_000n, haberCentavos: 0n },
      { cuentaContableId: "1180-01", debeCentavos: 112_000n, haberCentavos: 0n },
      { cuentaContableId: "2110-01", debeCentavos: 0n, haberCentavos: 812_000n },
    ]);
  });

  it("D-0142: papelería · Suministros Anáhuac I (el CFDI que después se cancela, §3.4)", () => {
    const cfdi: CfdiParaPoliza = {
      direccion: "recibido",
      emisorNombre: "Suministros Anáhuac I",
      receptorNombre: "José A. Torres",
      subtotalCentavos: 187_900n,
      totalCentavos: 218_000n,
      impuestosIva: [{ clasificacion: "trasladado", importeCentavos: 30_100n }],
    };
    const cuentas: CuentasParaPolizaCfdi = {
      cuentaGastoOIngresoId: "6100-09",
      cuentaIvaAcreditableId: "1180-01",
      cuentaContrapartidaId: "1120-01",
    };

    const poliza = generarPolizaDesdeCfdi(cfdi, cuentas);

    expect(poliza.asientos).toEqual([
      { cuentaContableId: "6100-09", debeCentavos: 187_900n, haberCentavos: 0n },
      { cuentaContableId: "1180-01", debeCentavos: 30_100n, haberCentavos: 0n }, // los $301 de §3.4
      { cuentaContableId: "1120-01", debeCentavos: 0n, haberCentavos: 218_000n },
    ]);
  });
});

describe("generarPolizaDesdeCfdi — ingresos (CFDI emitido)", () => {
  it("D-0148: factura A-1042 · Grupo Médico Anáhuac (sin cobrar: contrapartida clientes)", () => {
    const cfdi: CfdiParaPoliza = {
      direccion: "emitido",
      emisorNombre: "José A. Torres",
      receptorNombre: "Grupo Médico Anáhuac",
      subtotalCentavos: 3_629_300n,
      totalCentavos: 4_210_000n,
      impuestosIva: [{ clasificacion: "trasladado", importeCentavos: 580_700n }],
    };
    const cuentas: CuentasParaPolizaCfdi = {
      cuentaGastoOIngresoId: "4100-01",
      cuentaIvaTrasladadoId: "2140-01",
      cuentaContrapartidaId: "1130-02", // clientes: todavía no se cobra
    };

    const poliza = generarPolizaDesdeCfdi(cfdi, cuentas);

    expect(poliza.asientos).toEqual([
      { cuentaContableId: "1130-02", debeCentavos: 4_210_000n, haberCentavos: 0n },
      { cuentaContableId: "4100-01", debeCentavos: 0n, haberCentavos: 3_629_300n },
      { cuentaContableId: "2140-01", debeCentavos: 0n, haberCentavos: 580_700n },
    ]);
  });

  it("lanza si trae IVA trasladado y no se dio la cuenta correspondiente", () => {
    const cfdi: CfdiParaPoliza = {
      direccion: "emitido",
      emisorNombre: "José A. Torres",
      receptorNombre: "Cliente",
      subtotalCentavos: 100n,
      totalCentavos: 116n,
      impuestosIva: [{ clasificacion: "trasladado", importeCentavos: 16n }],
    };
    expect(() =>
      generarPolizaDesdeCfdi(cfdi, { cuentaGastoOIngresoId: "4100-01", cuentaContrapartidaId: "1130-02" }),
    ).toThrow("cuentaIvaTrasladadoId");
  });
});

describe("generarPolizaDesdeMovimiento — bancos", () => {
  it("E-0091: cobro de la factura A-1040 · Tecnologías Ruvalcaba (abono → ingresos)", () => {
    const poliza = generarPolizaDesdeMovimiento(
      { montoCentavos: 3_180_000n, descripcionBanco: "SPEI recibido · Tecnologías Ruvalcaba" },
      { cuentaBancoId: "1120-01", cuentaContrapartidaId: "1130-02" },
    );

    expect(poliza.tipo).toBe("ingresos");
    expect(poliza.origenTipo).toBe("banco");
    expect(poliza.asientos).toEqual([
      { cuentaContableId: "1120-01", debeCentavos: 3_180_000n, haberCentavos: 0n },
      { cuentaContableId: "1130-02", debeCentavos: 0n, haberCentavos: 3_180_000n },
    ]);
  });

  it("un cargo (dinero que sale) genera tipo egresos, banco al haber", () => {
    const poliza = generarPolizaDesdeMovimiento(
      { montoCentavos: -68_000n, descripcionBanco: "COMISION BANCARIA" },
      { cuentaBancoId: "1120-01", cuentaContrapartidaId: "6100-99" },
    );

    expect(poliza.tipo).toBe("egresos");
    expect(poliza.asientos).toEqual([
      { cuentaContableId: "6100-99", debeCentavos: 68_000n, haberCentavos: 0n },
      { cuentaContableId: "1120-01", debeCentavos: 0n, haberCentavos: 68_000n },
    ]);
  });

  it("un movimiento en cero no genera póliza", () => {
    expect(() =>
      generarPolizaDesdeMovimiento(
        { montoCentavos: 0n, descripcionBanco: "x" },
        { cuentaBancoId: "a", cuentaContrapartidaId: "b" },
      ),
    ).toThrow();
  });
});

describe("validarPartidaDoble — regla 3 de CLAUDE.md", () => {
  it("no lanza cuando debe = haber", () => {
    expect(() =>
      validarPartidaDoble([
        { cuentaContableId: "a", debeCentavos: 100n, haberCentavos: 0n },
        { cuentaContableId: "b", debeCentavos: 0n, haberCentavos: 100n },
      ]),
    ).not.toThrow();
  });

  it("lanza PolizaDescuadradaError con las dos sumas cuando no cuadra", () => {
    expect(() =>
      validarPartidaDoble([
        { cuentaContableId: "a", debeCentavos: 100n, haberCentavos: 0n },
        { cuentaContableId: "b", debeCentavos: 0n, haberCentavos: 99n },
      ]),
    ).toThrow(PolizaDescuadradaError);

    try {
      validarPartidaDoble([{ cuentaContableId: "a", debeCentavos: 5n, haberCentavos: 0n }]);
    } catch (error) {
      expect(error).toBeInstanceOf(PolizaDescuadradaError);
      const descuadre = error as PolizaDescuadradaError;
      expect(descuadre.debeCentavos).toBe(5n);
      expect(descuadre.haberCentavos).toBe(0n);
    }
  });
});
