import type { ResultadoValidacion } from "./tipos";

/**
 * Correo — sección 5 del README. Puerto fiel de `static validaEmail` en handoff/Cifra v2.dc.html.
 */
export function validarEmail(valorCrudo: string | null | undefined): ResultadoValidacion {
  const v = (valorCrudo ?? "").trim();

  if (!v) return { ok: false, mensaje: "Escribe el correo de la persona." };
  if (/\s/.test(v)) return { ok: false, mensaje: "El correo no lleva espacios." };

  const partes = v.split("@");
  if (partes.length === 1) return { ok: false, mensaje: "Falta la arroba." };
  if (partes.length > 2) return { ok: false, mensaje: "El correo lleva una sola arroba." };
  if (!partes[0]) return { ok: false, mensaje: "Falta el nombre antes de la arroba." };
  if (!partes[1]) return { ok: false, mensaje: "Falta el dominio después de la arroba." };
  if (!partes[1].includes(".")) {
    return { ok: false, mensaje: "El dominio necesita un punto, como despacho.mx." };
  }
  const tld = partes[1].split(".").pop() ?? "";
  if (!/^[a-z]{2,}$/i.test(tld)) {
    return { ok: false, mensaje: "La terminación del dominio no se ve bien." };
  }

  return { ok: true, mensaje: "" };
}
