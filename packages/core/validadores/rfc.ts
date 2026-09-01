import type { ResultadoValidacion } from "./tipos";

/** Días por mes, permisivo con el 29 de febrero (no distingue años bisiestos). */
const DIAS_POR_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface ResultadoValidacionRfc extends ResultadoValidacion {
  tipo?: "fisica" | "moral";
}

/**
 * RFC — sección 5 del README. Puerto fiel de `static validaRFC` en handoff/Cifra v2.dc.html:
 * mismo orden de reglas, mismos mensajes en español, letra por letra.
 *
 * 13 caracteres → persona física; 12 → persona moral. El orden importa: se devuelve el primer
 * fallo que aplique.
 *
 * Producción debería además verificar el dígito verificador y la lista de palabras
 * inconvenientes del SAT — el prototipo no lo hace, y esta versión tampoco (fielmente).
 */
export function validarRfc(valorCrudo: string | null | undefined): ResultadoValidacionRfc {
  const v = (valorCrudo ?? "").trim().toUpperCase();

  if (!v) return { ok: false, mensaje: "Escribe tu RFC." };
  if (/[^A-ZÑ&0-9]/.test(v)) {
    return { ok: false, mensaje: "El RFC solo lleva letras y números, sin espacios ni guiones." };
  }
  if (!/^[A-ZÑ&]{3}/.test(v)) {
    return {
      ok: false,
      mensaje: "Empieza con las letras de tu nombre: 4 si eres persona física, 3 si es empresa.",
    };
  }
  if (v.length < 12) {
    return { ok: false, mensaje: `Faltan caracteres: llevas ${v.length} y un RFC son 12 o 13.` };
  }
  if (v.length > 13) {
    return { ok: false, mensaje: `Sobran caracteres: llevas ${v.length} y un RFC son 12 o 13.` };
  }

  const esPersonaFisica = v.length === 13;
  const fecha = v.slice(esPersonaFisica ? 4 : 3, esPersonaFisica ? 10 : 9);
  if (!/^\d{6}$/.test(fecha)) {
    return { ok: false, mensaje: "Después de las letras va la fecha en AAMMDD, seis dígitos." };
  }

  const mm = Number(fecha.slice(2, 4));
  const dd = Number(fecha.slice(4, 6));
  if (mm < 1 || mm > 12) {
    return { ok: false, mensaje: `El mes «${fecha.slice(2, 4)}» no existe.` };
  }
  const diasEnElMes = DIAS_POR_MES[mm - 1]!;
  if (dd < 1 || dd > diasEnElMes) {
    return { ok: false, mensaje: `El día «${fecha.slice(4, 6)}» no existe en ese mes.` };
  }

  const homoclave = v.slice(esPersonaFisica ? 10 : 9);
  if (!/^[A-Z0-9]{2}[A-Z0-9]$/.test(homoclave)) {
    return { ok: false, mensaje: "La homoclave son 3 caracteres alfanuméricos." };
  }

  return { ok: true, mensaje: "", tipo: esPersonaFisica ? "fisica" : "moral" };
}
