import { describe, expect, it } from "vitest";
import { validarCodigoMfa } from "../validadores/codigo";

// Una prueba por fila de la tabla de Código MFA, sección 5 del README, más los dos casos del
// mensaje "Faltan N dígito(s)" (singular y plural, porque el mensaje cambia con N).
describe("validarCodigoMfa — sección 5 del README", () => {
  it("vacío → 'Escribe el código que te mandó el banco.'", () => {
    expect(validarCodigoMfa("")).toEqual({
      ok: false,
      mensaje: "Escribe el código que te mandó el banco.",
    });
  });

  it("no son puros números → 'El código son puros números.'", () => {
    expect(validarCodigoMfa("12a45")).toEqual({ ok: false, mensaje: "El código son puros números." });
  });

  it("corto, falta 1 → 'Faltan 1 dígito.' (singular)", () => {
    expect(validarCodigoMfa("12345")).toEqual({ ok: false, mensaje: "Faltan 1 dígito." });
  });

  it("corto, faltan 5 → 'Faltan 5 dígitos.' (plural)", () => {
    expect(validarCodigoMfa("1")).toEqual({ ok: false, mensaje: "Faltan 5 dígitos." });
  });

  it("código de 6 dígitos → ok", () => {
    expect(validarCodigoMfa("123456")).toEqual({ ok: true, mensaje: "" });
  });

  it("el código rechazado del escenario de prueba (000000) es formalmente válido — el rechazo lo da el banco, no el validador", () => {
    // handoff/datos/seed.json → escenariosDePrueba.codigoMfaRechazado
    expect(validarCodigoMfa("000000")).toEqual({ ok: true, mensaje: "" });
  });
});
