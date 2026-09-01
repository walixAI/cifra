import { describe, expect, it } from "vitest";
import { validarCiec } from "../validadores/ciec";

// La CIEC es opcional (sección 5 del README): vacía es válida, corta no.
describe("validarCiec — sección 5 del README", () => {
  it("vacía → ok (es opcional, se puede saltar el paso)", () => {
    expect(validarCiec("")).toEqual({ ok: true, mensaje: "" });
  });

  it("menos de 8 caracteres → 'La CIEC son al menos 8 caracteres.'", () => {
    expect(validarCiec("abc1234")).toEqual({ ok: false, mensaje: "La CIEC son al menos 8 caracteres." });
  });

  it("8 caracteres o más → ok", () => {
    expect(validarCiec("abc12345")).toEqual({ ok: true, mensaje: "" });
  });
});
