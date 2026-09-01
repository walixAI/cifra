import type { ResultadoValidacion } from "./tipos";

const LARGO_CODIGO_MFA = 6;

/**
 * Código MFA del banco — sección 5 del README. Puerto fiel de `static validaCodigo` en
 * handoff/Cifra v2.dc.html.
 */
export function validarCodigoMfa(valorCrudo: string | null | undefined): ResultadoValidacion {
  const v = (valorCrudo ?? "").trim();

  if (!v) return { ok: false, mensaje: "Escribe el código que te mandó el banco." };
  if (/\D/.test(v)) return { ok: false, mensaje: "El código son puros números." };
  if (v.length < LARGO_CODIGO_MFA) {
    const faltan = LARGO_CODIGO_MFA - v.length;
    return { ok: false, mensaje: `Faltan ${faltan} ${faltan === 1 ? "dígito." : "dígitos."}` };
  }

  return { ok: true, mensaje: "" };
}
