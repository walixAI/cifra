// Auth.js v5 con magic link — reemplaza el placeholder del paso 2. auth() mantiene su firma
// exacta (`Sesion | null` con `{ usuario: { id, email } }`): contexto() en apps/web/lib/contexto.ts
// no cambia ni una línea.
//
// El bypass de dos factores del paso 6 (AUTH_BYPASS_SECRETO / cookie cifra_auth_bypass) ya no
// existe en este archivo ni en ningún otro — no se desactivó, se borró. Bórralo también de
// Vercel (Settings → Environment Variables) el mismo día que esto se despliegue.

import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import authConfig from "./auth.config";
import { adaptadorUsuario } from "./adaptador-usuario";
import { enviarCorreo } from "./correo";

const { handlers, auth: authNextAuth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: adaptadorUsuario(),
  providers: [
    // Provider de Resend (API HTTP, no SMTP). El envío real pasa siempre por
    // sendVerificationRequest → enviarCorreo() (lib/correo.ts), que decide ahí si simula
    // (desarrollo sin AUTH_RESEND_KEY) o falla explícito (producción sin ella).
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.EMAIL_FROM ?? "Cifra <hola@cifra.mx>",
      // 24 horas: más largo que una sesión de trabajo típica, corto para no dejar un enlace
      // viejo dando vueltas en una bandeja de entrada.
      maxAge: 24 * 60 * 60,
      async sendVerificationRequest({ identifier, url }) {
        await enviarCorreo({
          para: identifier,
          asunto: "Tu enlace para entrar a Cifra",
          texto:
            `Entra a Cifra con este enlace — vale 24 horas:\n\n${url}\n\n` +
            `Si no lo pediste tú, ignora este correo: no pasa nada.`,
          html:
            `<p>Entra a Cifra con este enlace — vale 24 horas:</p>` +
            `<p><a href="${url}">${url}</a></p>` +
            `<p style="color:#666">Si no lo pediste tú, ignora este correo: no pasa nada.</p>`,
        });
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Primera vez que entra tras verificar el enlace: `user` trae el id real que devolvió el
    // adaptador (createUser/getUserByEmail). Se copia al token para que sobreviva entre
    // peticiones sin volver a tocar la base — la sesión es JWT, no de base de datos.
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.sub && session.user) session.user.id = token.sub;
      return session;
    },
  },
});

export { handlers, signIn, signOut };

export interface Sesion {
  usuario: { id: string; email: string };
}

export async function auth(): Promise<Sesion | null> {
  const sesion = await authNextAuth();
  if (!sesion?.user?.id || !sesion.user.email) return null;
  return { usuario: { id: sesion.user.id, email: sesion.user.email } };
}
