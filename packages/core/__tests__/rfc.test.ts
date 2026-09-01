import { describe, expect, it } from "vitest";
import { validarRfc } from "../validadores/rfc";

// Una prueba por fila de la tabla de RFC, sección 5 del README. El orden de los `it` sigue el
// orden de la tabla (y de los `if` en validarRfc): se prueba que cada regla dispara antes que
// las siguientes, no solo que el mensaje exista.
describe("validarRfc — sección 5 del README", () => {
  it("vacío → 'Escribe tu RFC.'", () => {
    expect(validarRfc("")).toEqual({ ok: false, mensaje: "Escribe tu RFC." });
  });

  it("caracteres fuera de A-ZÑ&0-9 → 'El RFC solo lleva letras y números, sin espacios ni guiones.'", () => {
    expect(validarRfc("TODA-760625-8I7")).toEqual({
      ok: false,
      mensaje: "El RFC solo lleva letras y números, sin espacios ni guiones.",
    });
  });

  it("no empieza con 3 letras → 'Empieza con las letras de tu nombre: 4 si eres persona física, 3 si es empresa.'", () => {
    expect(validarRfc("1ODA7606258I7")).toEqual({
      ok: false,
      mensaje: "Empieza con las letras de tu nombre: 4 si eres persona física, 3 si es empresa.",
    });
  });

  it("menos de 12 caracteres → 'Faltan caracteres: llevas {n} y un RFC son 12 o 13.'", () => {
    expect(validarRfc("TODA76062")).toEqual({
      ok: false,
      mensaje: "Faltan caracteres: llevas 9 y un RFC son 12 o 13.",
    });
  });

  it("más de 13 caracteres → 'Sobran caracteres: llevas {n} y un RFC son 12 o 13.'", () => {
    expect(validarRfc("TODA7606258I7XX")).toEqual({
      ok: false,
      mensaje: "Sobran caracteres: llevas 15 y un RFC son 12 o 13.",
    });
  });

  it("la fecha no son 6 dígitos → 'Después de las letras va la fecha en AAMMDD, seis dígitos.'", () => {
    expect(validarRfc("TODAABCDEF8I7")).toEqual({
      ok: false,
      mensaje: "Después de las letras va la fecha en AAMMDD, seis dígitos.",
    });
  });

  it("el mes no existe → 'El mes «{mm}» no existe.'", () => {
    expect(validarRfc("TODA2613158I7")).toEqual({
      ok: false,
      mensaje: "El mes «13» no existe.",
    });
  });

  it("el día no existe en ese mes → 'El día «{dd}» no existe en ese mes.'", () => {
    // Febrero permisivo hasta el 29 (regla explícita del README): el 30 ya no existe.
    expect(validarRfc("TODA2602308I7")).toEqual({
      ok: false,
      mensaje: "El día «30» no existe en ese mes.",
    });
  });

  it("la homoclave no son 3 alfanuméricos → 'La homoclave son 3 caracteres alfanuméricos.'", () => {
    // Ñ pasa el primer filtro (A-ZÑ&0-9) pero no el de la homoclave (A-Z0-9).
    expect(validarRfc("TODA760625IÑ7")).toEqual({
      ok: false,
      mensaje: "La homoclave son 3 caracteres alfanuméricos.",
    });
  });

  it("RFC válido de persona física (13) → ok, tipo fisica", () => {
    // El mismo RFC del contribuyente del seed (handoff/datos/seed.json).
    expect(validarRfc("TODA7606258I7")).toEqual({ ok: true, mensaje: "", tipo: "fisica" });
  });

  it("RFC válido de persona moral (12) → ok, tipo moral", () => {
    // El mismo RFC que usa el ejemplo de ARQUITECTURA-COMANDOS.md §2 (Grupo Médico Anáhuac).
    expect(validarRfc("GMA010315AB2")).toEqual({ ok: true, mensaje: "", tipo: "moral" });
  });

  it("recorta espacios y sube a mayúsculas antes de validar", () => {
    expect(validarRfc("  toda7606258i7  ")).toEqual({ ok: true, mensaje: "", tipo: "fisica" });
  });
});
