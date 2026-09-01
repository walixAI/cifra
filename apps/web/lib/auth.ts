// PLACEHOLDER — se reemplaza en el paso 8 de PRIMEROS-PASOS.md con Auth.js v5 (magic link).
// Existe ya para que contexto() (paso 2) tenga una fuente de sesión real que reemplazar, en vez
// de inventarle una interfaz nueva más adelante.
//
// En desarrollo, y SOLO en desarrollo, se sesiona automáticamente como José Antonio Torres
// Delgado (jose.torres@cifra.test — el dueño de TODA7606258I7 en packages/db/prisma/seed.mjs)
// para poder ver las pantallas en `pnpm dev` sin login real. Si el usuario no existe (no corrió
// `pnpm db:seed`) o no hay base de datos a la mano, se cae a "no autenticado" sin tronar — nunca
// un 500 por esto. En producción esto no hace nada: siempre null hasta que exista Auth.js.

import { prisma } from "@cifra/db";

export interface Sesion {
  usuario: { id: string; email: string };
}

const CORREO_DEV = "jose.torres@cifra.test";

export async function auth(): Promise<Sesion | null> {
  if (process.env.NODE_ENV === "production") return null;

  try {
    const usuario = await prisma.usuario.findUnique({ where: { email: CORREO_DEV } });
    if (!usuario) return null;
    return { usuario: { id: usuario.id, email: usuario.email } };
  } catch {
    // Sin Postgres local corriendo (falta `pnpm db:dev`) esto fallaría al conectar — se trata
    // igual que "no hay sesión", no como un error de servidor.
    return null;
  }
}
