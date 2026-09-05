// La comprobación barata de ARQUITECTURA-MULTIINQUILINO.md §5: ¿hay sesión? Si no, a /login. La
// de "¿tiene Acceso a ESTE contribuyente?" es cara (toca la base) y vive en contexto(), nunca
// aquí. Usa auth.config.ts (edge-safe) — Prisma y Nodemailer no corren en el Edge Runtime, así
// que el config completo (auth.ts) no puede importarse desde este archivo.

import NextAuth from "next-auth";
import authConfig from "./lib/auth.config";

export const { auth } = NextAuth(authConfig);
export default auth;

export const config = {
  // Todo menos: /api (los route handlers responden su propio 401/404 vía contexto(), nunca un
  // redirect HTML); /login; /invitaciones (esa página maneja su propio flujo de sesión, con el
  // correo del invitado prellenado — el middleware lo mandaría a /login sin ese dato); y los
  // estáticos de Next.
  matcher: ["/((?!api|login|invitaciones|_next/static|_next/image|favicon\\.ico).*)"],
};
