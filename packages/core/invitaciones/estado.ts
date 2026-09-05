// Invitaciones — la máquina de estados de la sección 4.1 del README y la copy exacta que la
// acompaña. Puro: sin red, sin base de datos. apps/web hace las consultas y las escrituras;
// aquí solo se decide QUÉ estado es y CON QUÉ palabras se dice.
//
// Dos momentos:
//   1. Crear la invitación (el formulario de §4.1): idle → sending → { conflict | error | sent }.
//      MENSAJES_INVITAR tiene los tres textos, verbatim del prototipo (handoff/Cifra v2.dc.html).
//   2. Aceptarla (abrir el enlace): evaluarInvitacion() decide entre vencida, ya usada, correo
//      que no coincide, o lista. Son cuatro situaciones con cuatro salidas distintas — el
//      README no da copy para esto (el prototipo no tiene la pantalla), así que la de aquí es
//      nueva, pero cada caso dice algo claramente distinto y con su propia forma de arreglarlo.

export type EstadoAlAceptar = "lista" | "vencida" | "ya_usada" | "correo_no_coincide";

export interface EntradaEvaluarInvitacion {
  /** Cuándo deja de valer la invitación (Acceso.expira_en / Invitacion.expira_en). */
  expiraEn: Date;
  /** Acceso con usuario_id ya puesto, o Invitacion con aceptada_en ya puesto. */
  yaUsada: boolean;
  /** El correo al que se le mandó la invitación. */
  correoInvitado: string;
  /** El correo de la sesión activa, o null si nadie ha iniciado sesión todavía. */
  correoSesion: string | null;
  ahora: Date;
}

/**
 * Orden deliberado: primero lo que hace la invitación inservible (vencida, ya usada), luego lo
 * que solo hay que corregir (el correo). Una invitación vencida abierta desde otro correo es,
 * ante todo, una invitación vencida — mandar a alguien a cambiar de sesión para toparse con que
 * de todos modos no sirve sería cruel.
 */
export function evaluarInvitacion(e: EntradaEvaluarInvitacion): EstadoAlAceptar {
  if (e.ahora.getTime() >= e.expiraEn.getTime()) return "vencida";
  if (e.yaUsada) return "ya_usada";
  if (
    e.correoSesion !== null &&
    e.correoSesion.trim().toLowerCase() !== e.correoInvitado.trim().toLowerCase()
  ) {
    return "correo_no_coincide";
  }
  return "lista";
}

/** Copy de cada estado al aceptar. `fechaVencimiento` y los correos se formatean afuera. */
export const MENSAJES_AL_ACEPTAR = {
  vencida: (fechaVencimiento: string) =>
    `Esta invitación venció el ${fechaVencimiento}. Pídele a quien te invitó que te mande una nueva.`,
  ya_usada: "Esta invitación ya se usó. Si fuiste tú, entra directo con tu correo.",
  correo_no_coincide: (correoInvitado: string, correoSesion: string) =>
    `Esta invitación es para ${correoInvitado}. Entraste como ${correoSesion} — sal y vuelve a ` +
    `entrar con ese correo para aceptarla.`,
} as const;

/**
 * Los tres mensajes de la máquina de §4.1 al CREAR una invitación. `enviada` y `conflicto` son
 * verbatim del prototipo (Cifra v2.dc.html, sendInvite y invMsg); `errorEnvio` también. La
 * variante de organización de `conflicto` es un paralelo deliberado — el prototipo solo tiene la
 * de contribuyente ("a tu contabilidad").
 */
export const MENSAJES_INVITAR = {
  enviada: (correo: string, rol: string) => `Invitación enviada a ${correo} con el rol de ${rol}.`,
  conflictoContribuyente: (desde: string, rol: string) =>
    `Esa persona ya tiene acceso a tu contabilidad desde el ${desde}, con rol de ${rol}.`,
  conflictoOrganizacion: (desde: string, rol: string) =>
    `Esa persona ya está en tu equipo desde el ${desde}, con rol de ${rol}.`,
  errorEnvio: "No se pudo enviar: el servidor de correo rechazó ese dominio. La invitación no se guardó.",
} as const;
