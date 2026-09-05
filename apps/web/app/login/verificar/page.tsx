// pages.verifyRequest de Auth.js (auth.config.ts) — a donde llega signIn() después de mandar el
// enlace. En desarrollo, el enlace no se manda de verdad si no hay EMAIL_SERVER (lib/correo.ts
// lo imprime en consola) — esta pantalla lo dice explícito, para que nunca parezca que sí llegó.

export default function PaginaVerificar() {
  const correoSimulado = process.env.NODE_ENV !== "production" && !process.env.EMAIL_SERVER;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-5 py-10 text-center">
      <i className="ph-duotone ph-envelope-simple-open" aria-hidden style={{ fontSize: 34, color: "var(--accent)" }} />
      <h1 className="mt-4 text-lg font-semibold tracking-tight">Revisa tu correo</h1>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        Te mandamos un enlace para entrar. Vale 24 horas.
      </p>
      {correoSimulado && (
        <p className="mt-4 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--chip)", color: "var(--muted)" }}>
          Estás en desarrollo sin <code>EMAIL_SERVER</code> configurado — no se mandó ningún
          correo de verdad. El enlace quedó impreso en la consola de la terminal donde corre{" "}
          <code>pnpm dev</code>.
        </p>
      )}
    </main>
  );
}
