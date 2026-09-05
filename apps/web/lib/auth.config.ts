// Config edge-safe de Auth.js — la única mitad que puede vivir en middleware.ts. Sin providers,
// sin adaptador: nada de Prisma ni Nodemailer aquí, porque el Edge Runtime de Vercel no los
// corre. auth.ts (Node, sin restricción de runtime) extiende esto con lo que sí necesita
// Node — es el patrón oficial de Auth.js v5 para Prisma + Next.js en Vercel.
//
// El callback `authorized` es la "comprobación barata" de ARQUITECTURA-MULTIINQUILINO.md §5:
// ¿hay sesión? La de "¿tiene Acceso a ESTE contribuyente?" es cara (toca la base) y se queda
// exactamente donde estaba, en contexto() — el middleware nunca la hace.

import type { NextAuthConfig } from "next-auth";

export default {
  pages: {
    signIn: "/login",
    verifyRequest: "/login/verificar",
  },
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
