// La lógica de servidor detrás de la máquina de estados de §4.1 (crear una invitación) y del
// flujo de aceptarla. Los TEXTOS y la DECISIÓN de estado viven en @cifra/core
// (invitaciones/estado.ts), puros y probados; aquí solo van las consultas, las escrituras y la
// bitácora.
//
// "Al aceptar una invitación se crea Membresia y/o Acceso según el caso": hay dos tipos de
// token —Invitacion (organización → Membresia) y Acceso (contribuyente → se activa la fila)— y
// un solo enlace `/invitaciones/{token}` los maneja a los dos. Son las ÚNICAS dos formas de
// terminar con acceso real; nada se crea por fuera de aquí.

import { randomUUID } from "node:crypto";
import {
  evaluarInvitacion,
  MENSAJES_AL_ACEPTAR,
  MENSAJES_INVITAR,
  validarEmail,
} from "@cifra/core";
import { prisma, prismaParaToken, type ClienteConAlcance } from "@cifra/db";
import type { EstadoAlAceptar } from "@cifra/core";
import { enviarCorreo } from "./correo";

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

// Cómo se lee cada rol en la copy (RolAcceso y RolOrganizacion).
const NOMBRE_ROL: Record<string, string> = {
  contador: "contador",
  captura: "captura",
  solo_lectura: "solo lectura",
  propietario_fiscal: "propietario fiscal",
  propietario: "propietario",
  admin: "administrador",
  miembro: "miembro",
};
const legibleRol = (rol: string) => NOMBRE_ROL[rol] ?? rol;

function urlBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.AUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

function fechaLegible(d: Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Mexico_City",
  }).format(d);
}

async function mandarCorreoInvitacion(correo: string, quienInvita: string, aQue: string, token: string) {
  const url = `${urlBase()}/invitaciones/${token}`;
  await enviarCorreo({
    para: correo,
    asunto: "Te invitaron a Cifra",
    texto:
      `${quienInvita} te dio acceso ${aQue} en Cifra. Abre este enlace para aceptarlo — vale 7 días:\n\n` +
      `${url}\n\nSi no esperabas esto, ignóralo.`,
    html:
      `<p>${quienInvita} te dio acceso ${aQue} en Cifra. Abre este enlace para aceptarlo — vale 7 días:</p>` +
      `<p><a href="${url}">${url}</a></p>` +
      `<p style="color:#666">Si no esperabas esto, ignóralo.</p>`,
  });
}

// ── Crear invitación ─────────────────────────────────────────────────────────

export type ResultadoInvitar =
  | { estado: "sent"; correo: string; rol: string }
  | { estado: "validacion"; mensaje: string }
  | { estado: "conflict"; mensaje: string }
  | { estado: "error"; mensaje: string };

/** Invitar a alguien a los libros de UN contribuyente (Acceso). `db` tiene que ser el cliente
 * con alcance a ese contribuyente que devuelve contexto(). */
export async function invitarAContribuyente(opciones: {
  db: ClienteConAlcance;
  contribuyenteId: string;
  correoCrudo: string;
  rol: "contador" | "captura" | "solo_lectura";
  quienInvita: string;
}): Promise<ResultadoInvitar> {
  const v = validarEmail(opciones.correoCrudo);
  if (!v.ok) return { estado: "validacion", mensaje: v.mensaje };
  const correo = opciones.correoCrudo.trim().toLowerCase();

  const existente = await opciones.db.acceso.findUnique({
    where: {
      contribuyente_id_email: { contribuyente_id: opciones.contribuyenteId, email: correo },
    },
  });
  if (existente && existente.estado !== "revocado") {
    return {
      estado: "conflict",
      mensaje: MENSAJES_INVITAR.conflictoContribuyente(
        fechaLegible(existente.invitado_en),
        legibleRol(existente.rol),
      ),
    };
  }

  // El token se genera ANTES de guardar: si el correo no sale, "la invitación no se guardó" es
  // literal (§4.1, estado error).
  const token = randomUUID();
  try {
    await mandarCorreoInvitacion(correo, opciones.quienInvita, "a una contabilidad", token);
  } catch {
    return { estado: "error", mensaje: MENSAJES_INVITAR.errorEnvio };
  }

  const datos = {
    rol: opciones.rol,
    estado: "invitado" as const,
    usuario_id: null,
    token,
    invitado_en: new Date(),
    expira_en: new Date(Date.now() + SIETE_DIAS_MS),
    revocado_en: null,
  };
  if (existente) {
    await opciones.db.acceso.update({ where: { id: existente.id }, data: datos });
  } else {
    await opciones.db.acceso.create({
      data: { contribuyente_id: opciones.contribuyenteId, email: correo, ...datos },
    });
  }

  return { estado: "sent", correo, rol: legibleRol(opciones.rol) };
}

/** Invitar a alguien a la ORGANIZACIÓN (Invitacion → Membresia al aceptar). */
export async function invitarAOrganizacion(opciones: {
  organizacionId: string;
  correoCrudo: string;
  rol: "admin" | "miembro";
  quienInvita: string;
}): Promise<ResultadoInvitar> {
  const v = validarEmail(opciones.correoCrudo);
  if (!v.ok) return { estado: "validacion", mensaje: v.mensaje };
  const correo = opciones.correoCrudo.trim().toLowerCase();

  const usuario = await prisma.usuario.findUnique({ where: { email: correo } });
  if (usuario) {
    const membresia = await prisma.membresia.findUnique({
      where: {
        usuario_id_organizacion_id: {
          usuario_id: usuario.id,
          organizacion_id: opciones.organizacionId,
        },
      },
    });
    if (membresia) {
      return {
        estado: "conflict",
        mensaje: MENSAJES_INVITAR.conflictoOrganizacion(
          fechaLegible(membresia.creado_en),
          legibleRol(membresia.rol),
        ),
      };
    }
  }
  const pendiente = await prisma.invitacion.findUnique({
    where: { organizacion_id_email: { organizacion_id: opciones.organizacionId, email: correo } },
  });
  if (pendiente && !pendiente.aceptada_en) {
    return {
      estado: "conflict",
      mensaje: MENSAJES_INVITAR.conflictoOrganizacion(
        fechaLegible(pendiente.creada_en),
        legibleRol(pendiente.rol),
      ),
    };
  }

  const token = randomUUID();
  try {
    await mandarCorreoInvitacion(correo, opciones.quienInvita, "a tu equipo", token);
  } catch {
    return { estado: "error", mensaje: MENSAJES_INVITAR.errorEnvio };
  }

  const datos = {
    rol: opciones.rol,
    token,
    creada_en: new Date(),
    expira_en: new Date(Date.now() + SIETE_DIAS_MS),
    aceptada_en: null,
  };
  if (pendiente) {
    await prisma.invitacion.update({ where: { id: pendiente.id }, data: datos });
  } else {
    await prisma.invitacion.create({
      data: { organizacion_id: opciones.organizacionId, email: correo, ...datos },
    });
  }

  return { estado: "sent", correo, rol: legibleRol(opciones.rol) };
}

// ── Aceptar invitación ───────────────────────────────────────────────────────

export type InvitacionResuelta =
  | {
      tipo: "organizacion";
      invitacionId: string;
      organizacionId: string;
      organizacionNombre: string;
      organizacionTipo: string;
      correo: string;
      rol: string;
      expiraEn: Date;
      yaUsada: boolean;
    }
  | {
      tipo: "contribuyente";
      accesoId: string;
      contribuyenteId: string;
      contribuyenteNombre: string;
      slug: string;
      correo: string;
      rol: string;
      expiraEn: Date;
      yaUsada: boolean;
    };

/** Busca el token en las DOS tablas. `null` si no aparece en ninguna. Nunca revela cuál se probó. */
export async function buscarInvitacion(token: string): Promise<InvitacionResuelta | null> {
  // Invitacion no está bajo RLS (lleva organizacion_id, no contribuyente_id).
  const inv = await prisma.invitacion.findUnique({
    where: { token },
    include: { organizacion: true },
  });
  if (inv) {
    return {
      tipo: "organizacion",
      invitacionId: inv.id,
      organizacionId: inv.organizacion_id,
      organizacionNombre: inv.organizacion.nombre,
      organizacionTipo: inv.organizacion.tipo,
      correo: inv.email,
      rol: inv.rol,
      expiraEn: inv.expira_en,
      yaUsada: inv.aceptada_en !== null,
    };
  }

  // Acceso SÍ está bajo RLS — se busca con alcance al token (política acceso_por_token).
  const acc = await prismaParaToken(token).acceso.findFirst({
    where: { token },
    include: { contribuyente: true },
  });
  if (acc) {
    return {
      tipo: "contribuyente",
      accesoId: acc.id,
      contribuyenteId: acc.contribuyente_id,
      contribuyenteNombre: acc.contribuyente.nombre,
      slug: acc.contribuyente.slug,
      correo: acc.email,
      rol: acc.rol,
      expiraEn: acc.expira_en,
      yaUsada: acc.usuario_id !== null || acc.estado !== "invitado",
    };
  }

  return null;
}

export type ResultadoAceptar =
  | { ok: true; destino: string; que: string }
  | { ok: false; estado: EstadoAlAceptar; mensaje: string };

export async function aceptarInvitacion(
  token: string,
  usuario: { id: string; email: string },
): Promise<ResultadoAceptar> {
  const inv = await buscarInvitacion(token);
  if (!inv) {
    return { ok: false, estado: "ya_usada", mensaje: MENSAJES_AL_ACEPTAR.ya_usada };
  }

  const estado = evaluarInvitacion({
    expiraEn: inv.expiraEn,
    yaUsada: inv.yaUsada,
    correoInvitado: inv.correo,
    correoSesion: usuario.email,
    ahora: new Date(),
  });
  if (estado === "vencida") {
    return { ok: false, estado, mensaje: MENSAJES_AL_ACEPTAR.vencida(fechaLegible(inv.expiraEn)) };
  }
  if (estado === "ya_usada") {
    return { ok: false, estado, mensaje: MENSAJES_AL_ACEPTAR.ya_usada };
  }
  if (estado === "correo_no_coincide") {
    return {
      ok: false,
      estado,
      mensaje: MENSAJES_AL_ACEPTAR.correo_no_coincide(inv.correo, usuario.email),
    };
  }

  if (inv.tipo === "organizacion") {
    await prisma.$transaction([
      prisma.membresia.upsert({
        where: {
          usuario_id_organizacion_id: {
            usuario_id: usuario.id,
            organizacion_id: inv.organizacionId,
          },
        },
        create: {
          usuario_id: usuario.id,
          organizacion_id: inv.organizacionId,
          rol: inv.rol as "admin" | "miembro" | "propietario",
        },
        // Ya es miembro: un enlace viejo no lo promueve ni lo degrada.
        update: {},
      }),
      prisma.invitacion.update({ where: { id: inv.invitacionId }, data: { aceptada_en: new Date() } }),
      prisma.bitacora.create({
        data: {
          usuario_id: usuario.id,
          organizacion_id: inv.organizacionId,
          accion: "acceso_cambiado",
          entidad: "membresia",
          metadatos: { via: "invitacion", rol: inv.rol },
        },
      }),
    ]);
    const destino = inv.organizacionTipo === "despacho" ? "/cartera" : "/";
    return { ok: true, destino, que: inv.organizacionNombre };
  }

  // Contribuyente: se activa la fila de Acceso que ya existe.
  await prismaParaToken(token).acceso.update({
    where: { id: inv.accesoId },
    data: { usuario_id: usuario.id, estado: "activo" },
  });
  await prisma.bitacora.create({
    data: {
      usuario_id: usuario.id,
      contribuyente_id: inv.contribuyenteId,
      accion: "acceso_cambiado",
      entidad: "acceso",
      entidad_id: inv.accesoId,
      metadatos: { via: "invitacion", rol: inv.rol },
    },
  });
  return { ok: true, destino: `/${inv.slug}/impuestos`, que: inv.contribuyenteNombre };
}
