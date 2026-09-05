// A donde manda /invitaciones/[token] después de aceptar. La invitación ya quedó usada, así que
// esta pantalla no vuelve a evaluarla — solo confirma y ofrece el enlace a donde ir.

import Link from "next/link";

export default async function PaginaAceptada({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; que?: string }>;
}) {
  const { a, que } = await searchParams;
  const destino = a && a.startsWith("/") ? a : "/";

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-5 py-10 text-center">
      <i className="ph-duotone ph-check-circle" aria-hidden style={{ fontSize: 34, color: "var(--pos)" }} />
      <h1 className="mt-4 text-lg font-semibold tracking-tight">Listo</h1>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        {que ? `Ya tienes acceso a ${que}.` : "Ya tienes acceso."}
      </p>
      <Link
        href={destino}
        className="mt-5 rounded-lg px-4 py-2.5 text-sm font-semibold"
        style={{ background: "var(--accent)", color: "var(--onaccent)" }}
      >
        Ir ahí
      </Link>
    </main>
  );
}
