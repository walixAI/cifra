// Adaptador de Auth.js hecho a mano sobre Usuario — no @auth/prisma-adapter. Ese adaptador
// oficial espera modelos User/Account/Session/VerificationToken con esos nombres exactos de
// accessor de Prisma: chocaría con Usuario, que ya existe con sus relaciones y en español (regla
// del dominio de CLAUDE.md), y traería Account/Session que no hacen falta — solo hay magic link
// (sin OAuth) y sesión JWT (sin tabla Session).
//
// Todos los métodos de Adapter son opcionales; con Nodemailer + JWT, Auth.js solo llama a estos
// seis. Nada de Account, Session ni sus métodos — no aplican sin OAuth.

import { prisma } from "@cifra/db";
import type { Adapter, AdapterUser, VerificationToken } from "next-auth/adapters";

function aAdapterUser(u: {
  id: string;
  email: string;
  nombre: string | null;
  email_verificado_en: Date | null;
}): AdapterUser {
  return {
    id: u.id,
    email: u.email,
    name: u.nombre,
    image: null,
    emailVerified: u.email_verificado_en,
  };
}

export function adaptadorUsuario(): Adapter {
  return {
    async getUser(id) {
      const u = await prisma.usuario.findUnique({ where: { id } });
      return u ? aAdapterUser(u) : null;
    },

    async getUserByEmail(email) {
      const u = await prisma.usuario.findUnique({ where: { email } });
      return u ? aAdapterUser(u) : null;
    },

    // Se ignora el id que propone Auth.js: Usuario.id ya tiene @default(uuid()) en el schema, y
    // así el id real siempre sale de la base, nunca de lo que el llamador haya sugerido.
    async createUser(datos) {
      const u = await prisma.usuario.create({
        data: { email: datos.email, nombre: datos.name ?? null, email_verificado_en: datos.emailVerified },
      });
      return aAdapterUser(u);
    },

    async updateUser(datos) {
      const u = await prisma.usuario.update({
        where: { id: datos.id },
        data: {
          email: datos.email,
          nombre: datos.name,
          email_verificado_en: datos.emailVerified,
        },
      });
      return aAdapterUser(u);
    },

    async createVerificationToken({ identifier, token, expires }): Promise<VerificationToken> {
      await prisma.tokenVerificacion.create({
        data: { identificador: identifier, token, expira_en: expires },
      });
      return { identifier, token, expires };
    },

    // Un solo uso: la fila se borra al leerla. Si ya se usó, ya expiró y algo la limpió, o nunca
    // existió, los tres casos son indistinguibles desde aquí y los tres son "null" — Auth.js lo
    // trata como enlace inválido.
    async useVerificationToken({ identifier, token }) {
      try {
        const fila = await prisma.tokenVerificacion.delete({
          where: { identificador_token: { identificador: identifier, token } },
        });
        return { identifier: fila.identificador, token: fila.token, expires: fila.expira_en };
      } catch {
        return null;
      }
    },
  };
}
