import { describe, expect, it } from "vitest";
import { validarEmail } from "../validadores/email";

// Una prueba por fila de la tabla de Correo, sección 5 del README.
describe("validarEmail — sección 5 del README", () => {
  it("vacío → 'Escribe el correo de la persona.'", () => {
    expect(validarEmail("")).toEqual({ ok: false, mensaje: "Escribe el correo de la persona." });
  });

  it("con espacios → 'El correo no lleva espacios.'", () => {
    expect(validarEmail("ana @despacho.mx")).toEqual({
      ok: false,
      mensaje: "El correo no lleva espacios.",
    });
  });

  it("sin arroba → 'Falta la arroba.'", () => {
    expect(validarEmail("anadespacho.mx")).toEqual({ ok: false, mensaje: "Falta la arroba." });
  });

  it("más de una arroba → 'El correo lleva una sola arroba.'", () => {
    expect(validarEmail("ana@des@pacho.mx")).toEqual({
      ok: false,
      mensaje: "El correo lleva una sola arroba.",
    });
  });

  it("nada antes de la arroba → 'Falta el nombre antes de la arroba.'", () => {
    expect(validarEmail("@despacho.mx")).toEqual({
      ok: false,
      mensaje: "Falta el nombre antes de la arroba.",
    });
  });

  it("nada después de la arroba → 'Falta el dominio después de la arroba.'", () => {
    expect(validarEmail("ana@")).toEqual({
      ok: false,
      mensaje: "Falta el dominio después de la arroba.",
    });
  });

  it("el dominio no tiene punto → 'El dominio necesita un punto, como despacho.mx.'", () => {
    expect(validarEmail("ana@despachomx")).toEqual({
      ok: false,
      mensaje: "El dominio necesita un punto, como despacho.mx.",
    });
  });

  it("la terminación no son ≥2 letras → 'La terminación del dominio no se ve bien.'", () => {
    expect(validarEmail("ana@despacho.c")).toEqual({
      ok: false,
      mensaje: "La terminación del dominio no se ve bien.",
    });
  });

  it("correo válido → ok", () => {
    expect(validarEmail("ana@despacho.mx")).toEqual({ ok: true, mensaje: "" });
  });
});
