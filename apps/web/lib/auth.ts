// PLACEHOLDER — se reemplaza en el paso 8 de PRIMEROS-PASOS.md con Auth.js v5 (magic link).
// Existe ya para que contexto() (paso 2) tenga una fuente de sesión real que reemplazar, en vez
// de inventarle una interfaz nueva más adelante.
//
// En desarrollo, y SOLO en desarrollo, se sesiona automáticamente como José Antonio Torres
// Delgado (jose.torres@cifra.test — el dueño de TODA7606258I7 en packages/db/prisma/seed.mjs)
// para poder ver las pantallas en `pnpm dev` sin login real. Si el usuario no existe (no corrió
// `pnpm db:seed`) o no hay base de datos a la mano, se cae a "no autenticado" sin tronar — nunca
// un 500 por esto.
//
// En producción, por default, esto sigue sin hacer nada: siempre null. La única forma de entrar
// antes de que exista Auth.js es fijar AUTH_BYPASS_SECRETO en el entorno (Vercel → Settings →
// Environment Variables — NUNCA en el repo, NUNCA en .env.local) y mandar esa misma cadena en la
// cookie `cifra_auth_bypass`. Sin la variable puesta, el bypass no existe: hace falta el secreto
// Y haberlo puesto tú mismo en el entorno — no es un usuario fijo que cualquiera con la URL
// pueda usar. Cada vez que se usa deja un renglón en Bitácora y un `console.warn` — una puerta
// de servicio sin registro es justo lo que después nadie recuerda que existe.
//
// TODO(paso 8): en cuanto Auth.js con magic link esté funcionando, borra `bypassAutorizado`,
// `coincideSecreto`, `registrarUsoDeBypass`, la constante `COOKIE_BYPASS` y la línea `const
// viaBypass = ...` de `auth()` de vuelta a `if (!enDesarrollo) return null;` — y quita
// AUTH_BYPASS_SECRETO del entorno de Vercel. Ver la tarea gemela en handoff/DESPLIEGUE.md §6.

import { timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { prisma } from "@cifra/db";

export interface Sesion {
  usuario: { id: string; email: string };
}

const CORREO_DEV = "jose.torres@cifra.test";
const COOKIE_BYPASS = "cifra_auth_bypass";

function coincideSecreto(cookie: string, secreto: string): boolean {
  const a = Buffer.from(cookie);
  const b = Buffer.from(secreto);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function bypassAutorizado(): Promise<boolean> {
  const secreto = process.env.AUTH_BYPASS_SECRETO;
  if (!secreto) return false; // sin la variable de entorno, esta puerta no existe

  const cookie = (await cookies()).get(COOKIE_BYPASS)?.value;
  return cookie !== undefined && coincideSecreto(cookie, secreto);
}

/** Rastro del bypass: un renglón en Bitácora (mejor esfuerzo) y siempre un `warn`, aunque el
 * insert falle — no bloquea el acceso por eso, pero nunca queda sin ninguna huella. */
async function registrarUsoDeBypass(usuarioId: string): Promise<void> {
  const ip = (await headers()).get("x-forwarded-for");
  console.warn(
    `[auth] bypass de desarrollo usado en producción: sesión de ${CORREO_DEV} (usuario ${usuarioId}), ip ${ip ?? "desconocida"}`,
  );
  try {
    await prisma.bitacora.create({
      data: {
        usuario_id: usuarioId,
        accion: "bypass_dev_auth",
        entidad: "usuario",
        entidad_id: usuarioId,
        ip: ip ?? null,
        metadatos: { correo: CORREO_DEV },
      },
    });
  } catch (error) {
    console.error("[auth] no se pudo escribir en Bitácora el uso del bypass", error);
  }
}

export async function auth(): Promise<Sesion | null> {
  const enDesarrollo = process.env.NODE_ENV !== "production";
  const viaBypass = !enDesarrollo && (await bypassAutorizado());
  if (!enDesarrollo && !viaBypass) return null;

  try {
    const usuario = await prisma.usuario.findUnique({ where: { email: CORREO_DEV } });
    if (!usuario) return null;
    if (viaBypass) await registrarUsoDeBypass(usuario.id);
    return { usuario: { id: usuario.id, email: usuario.email } };
  } catch {
    // Sin Postgres local corriendo (falta `pnpm db:dev`) esto fallaría al conectar — se trata
    // igual que "no hay sesión", no como un error de servidor.
    return null;
  }
}
