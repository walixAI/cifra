import { describe, expect, it } from "vitest";
import { evaluarCuadreIva } from "../contabilidad/cuadre";

// El fixture completo de agosto 2026 (§3.1, §3.4 y §3.5 del README):
// trasladado 24,500 − acreditable 11,885 − retenido 4,195 = 8,420 declarado y calculado.
// Pero $301 del acreditable vienen del CFDI 3B77…A20 (Suministros Anáhuac), cancelado el 21 de
// agosto DESPUÉS de contabilizarse en la póliza D-0142. La cifra honesta es $8,721.
const CALCULADO_AGOSTO = {
  trasladadoCentavos: 2_450_000n,
  acreditableCentavos: 1_188_500n,
  retenidoCentavos: 419_500n,
};
const DECLARADO_AGOSTO = { porPagarCentavos: 842_000n }; // $8,420.00
const CFDI_CANCELADO_AGOSTO = {
  cfdiId: "3B77…A20",
  emisorNombre: "Suministros Anáhuac I",
  polizaId: "poliza-d-0142",
  polizaFolio: "D-0142",
  ivaAcreditableCentavos: 30_100n, // $301.00
};

describe("evaluarCuadreIva — sección 3.5 del README", () => {
  it("agosto 2026: cuadra en $8,420 pero avisa del CFDI cancelado, cifra corregida $8,721", () => {
    const resultado = evaluarCuadreIva(CALCULADO_AGOSTO, DECLARADO_AGOSTO, [CFDI_CANCELADO_AGOSTO]);

    expect(resultado.estado).toBe("warning");
    expect(resultado.porPagarCalculadoCentavos).toBe(842_000n); // $8,420.00
    expect(resultado.porPagarCorregidoCentavos).toBe(872_100n); // $8,721.00 — el del README
    expect(resultado.diferenciaCentavos).toBe(0n);
    expect(resultado.cfdisCanceladosAcreditando).toEqual([CFDI_CANCELADO_AGOSTO]);
    expect(resultado.mensaje).toContain("D-0142");
    expect(resultado.mensaje).toContain("$301.00");
    expect(resultado.mensaje).toContain("$8,721.00");
  });

  it("salida 1 — la aritmética no cuadra con lo declarado → error, con la diferencia", () => {
    const resultado = evaluarCuadreIva(CALCULADO_AGOSTO, { porPagarCentavos: 900_000n });

    expect(resultado.estado).toBe("error");
    expect(resultado.porPagarCalculadoCentavos).toBe(842_000n);
    expect(resultado.diferenciaCentavos).toBe(-58_000n);
    expect(resultado.mensaje).toContain("no cuadra");
  });

  it("salida 3 — cuadra y no hay CFDI cancelados de por medio → ok", () => {
    const resultado = evaluarCuadreIva(CALCULADO_AGOSTO, DECLARADO_AGOSTO, []);

    expect(resultado.estado).toBe("ok");
    expect(resultado.porPagarCorregidoCentavos).toBe(resultado.porPagarCalculadoCentavos);
    expect(resultado.cfdisCanceladosAcreditando).toEqual([]);
  });

  it("el error de aritmética tiene prioridad sobre el aviso de CFDI cancelado", () => {
    // Si ninguna de las dos cifras cuadra, no tiene caso hablar de la corrección: primero hay
    // que explicar la diferencia con lo declarado.
    const resultado = evaluarCuadreIva(CALCULADO_AGOSTO, { porPagarCentavos: 0n }, [
      CFDI_CANCELADO_AGOSTO,
    ]);

    expect(resultado.estado).toBe("error");
  });

  it("varios CFDI cancelados suman su acreditable en la corrección", () => {
    const otroConcelado = { ...CFDI_CANCELADO_AGOSTO, cfdiId: "otro-uuid", polizaFolio: "D-0099", ivaAcreditableCentavos: 5_000n };
    const resultado = evaluarCuadreIva(CALCULADO_AGOSTO, DECLARADO_AGOSTO, [
      CFDI_CANCELADO_AGOSTO,
      otroConcelado,
    ]);

    expect(resultado.porPagarCorregidoCentavos).toBe(842_000n + 30_100n + 5_000n);
  });
});
