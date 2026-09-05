import { describe, expect, it } from "vitest";
import {
  evaluarInvitacion,
  MENSAJES_AL_ACEPTAR,
  MENSAJES_INVITAR,
} from "../invitaciones/estado";

const AHORA = new Date("2026-09-05T12:00:00Z");
const base = {
  expiraEn: new Date("2026-09-10T12:00:00Z"),
  yaUsada: false,
  correoInvitado: "ana@despacho.mx",
  correoSesion: "ana@despacho.mx" as string | null,
  ahora: AHORA,
};

describe("evaluarInvitacion — los cuatro caminos al aceptar (§4.1)", () => {
  it("todo en orden → lista", () => {
    expect(evaluarInvitacion(base)).toBe("lista");
  });

  it("sin sesión todavía → lista (el enlace lleva a login, no es un error)", () => {
    expect(evaluarInvitacion({ ...base, correoSesion: null })).toBe("lista");
  });

  it("ya pasó expira_en → vencida", () => {
    expect(evaluarInvitacion({ ...base, ahora: new Date("2026-09-11T00:00:00Z") })).toBe("vencida");
  });

  it("token ya consumido → ya_usada", () => {
    expect(evaluarInvitacion({ ...base, yaUsada: true })).toBe("ya_usada");
  });

  it("abierta desde otro correo → correo_no_coincide", () => {
    expect(evaluarInvitacion({ ...base, correoSesion: "otra@persona.mx" })).toBe("correo_no_coincide");
  });

  it("el correo compara sin distinguir mayúsculas ni espacios", () => {
    expect(evaluarInvitacion({ ...base, correoSesion: "  ANA@Despacho.MX " })).toBe("lista");
  });

  it("vencida Y desde otro correo → vencida (lo que la hace inservible gana)", () => {
    expect(
      evaluarInvitacion({
        ...base,
        ahora: new Date("2026-09-11T00:00:00Z"),
        correoSesion: "otra@persona.mx",
      }),
    ).toBe("vencida");
  });

  it("ya usada Y desde otro correo → ya_usada (idem)", () => {
    expect(evaluarInvitacion({ ...base, yaUsada: true, correoSesion: "otra@persona.mx" })).toBe(
      "ya_usada",
    );
  });
});

describe("los tres casos de error al aceptar dicen cosas distintas y con su propio arreglo", () => {
  const vencida = MENSAJES_AL_ACEPTAR.vencida("10 de septiembre de 2026");
  const usada = MENSAJES_AL_ACEPTAR.ya_usada;
  const noCoincide = MENSAJES_AL_ACEPTAR.correo_no_coincide("ana@despacho.mx", "otra@persona.mx");

  it("cada mensaje es distinto de los otros dos", () => {
    expect(new Set([vencida, usada, noCoincide]).size).toBe(3);
  });

  it("vencida: dice cuándo venció y que hay que pedir otra", () => {
    expect(vencida).toBe(
      "Esta invitación venció el 10 de septiembre de 2026. Pídele a quien te invitó que te mande una nueva.",
    );
  });

  it("ya usada: manda a entrar directo", () => {
    expect(usada).toBe("Esta invitación ya se usó. Si fuiste tú, entra directo con tu correo.");
  });

  it("correo no coincide: nombra los dos correos y dice qué hacer", () => {
    expect(noCoincide).toContain("ana@despacho.mx");
    expect(noCoincide).toContain("otra@persona.mx");
    expect(noCoincide).toBe(
      "Esta invitación es para ana@despacho.mx. Entraste como otra@persona.mx — sal y vuelve a entrar con ese correo para aceptarla.",
    );
  });
});

describe("MENSAJES_INVITAR — verbatim del prototipo (§4.1)", () => {
  it("sent → el toast exacto de sendInvite()", () => {
    expect(MENSAJES_INVITAR.enviada("ana@despacho.mx", "contador")).toBe(
      "Invitación enviada a ana@despacho.mx con el rol de contador.",
    );
  });

  it("conflict (contribuyente) → el texto exacto de invMsg.conflict", () => {
    expect(MENSAJES_INVITAR.conflictoContribuyente("4 de marzo de 2026", "contador")).toBe(
      "Esa persona ya tiene acceso a tu contabilidad desde el 4 de marzo de 2026, con rol de contador.",
    );
  });

  it("error → el texto exacto de invMsg.error, incluido «La invitación no se guardó.»", () => {
    expect(MENSAJES_INVITAR.errorEnvio).toBe(
      "No se pudo enviar: el servidor de correo rechazó ese dominio. La invitación no se guardó.",
    );
  });
});
