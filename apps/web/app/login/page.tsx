// /login — magic link por correo. Auth.js redirige aquí cuando authorized() (middleware.ts)
// dice que no hay sesión, con ?callbackUrl= a la página que se quería ver — signIn() vuelve ahí
// solo después de que el correo se verifica.

import { signIn } from "@/lib/auth";

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; email?: string }>;
}) {
  const { callbackUrl, email } = await searchParams;

  async function entrar(formData: FormData) {
    "use server";
    const correo = String(formData.get("correo") ?? "").trim();
    // signIn() redirige por dentro (a /login/verificar, o a /login?error=… si algo falla) con un
    // throw especial de Next — no se atrapa aquí porque atraparlo es exactamente lo que
    // cancelaría ese redirect.
    await signIn("nodemailer", { email: correo, redirectTo: callbackUrl || "/" });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <div className="flex items-center gap-2">
        <i className="ph-duotone ph-receipt" aria-hidden style={{ fontSize: 22, color: "var(--accent-2)" }} />
        <h1 className="m-0 text-[19px] font-semibold tracking-tight">Cifra</h1>
      </div>
      <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
        Entra con tu correo — te mandamos un enlace, sin contraseña.
      </p>

      <form action={entrar} className="mt-6 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>
            Correo
          </span>
          <input
            type="email"
            name="correo"
            required
            autoFocus
            defaultValue={email}
            placeholder="tu@correo.mx"
            className="rounded-lg border px-3 py-2.5 text-sm"
            style={{ borderColor: "var(--line)", background: "var(--panel)" }}
          />
        </label>
        <button
          type="submit"
          className="rounded-lg px-4 py-2.5 text-sm font-semibold"
          style={{ background: "var(--accent)", color: "var(--onaccent)" }}
        >
          Mandarme el enlace
        </button>
      </form>
    </main>
  );
}
