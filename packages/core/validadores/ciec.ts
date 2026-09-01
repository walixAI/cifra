import type { ResultadoValidacion } from "./tipos";

const LARGO_MINIMO_CIEC = 8;

/**
 * CIEC — sección 5 del README. Opcional: vacía es válida (el paso de onboarding se puede saltar).
 * Puerto fiel de `static validaCiec` en handoff/Cifra v2.dc.html.
 */
export function validarCiec(valorCrudo: string | null | undefined): ResultadoValidacion {
  const v = valorCrudo ?? "";

  if (!v) return { ok: true, mensaje: "" };
  if (v.length < LARGO_MINIMO_CIEC) {
    return { ok: false, mensaje: "La CIEC son al menos 8 caracteres." };
  }

  return { ok: true, mensaje: "" };
}
