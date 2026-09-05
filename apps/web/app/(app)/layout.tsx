// Marco compartido de las pantallas dentro de la app: barra superior con el selector de
// contribuyente (oculto si la organización es `personal`), los accesos a /equipo y /cartera
// cuando aplican, y el correo del usuario con salir. La verificación de acceso a cada pantalla
// NO vive aquí — sigue en contexto() y contextoOrganizacion().

import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth";
import { contextoShell } from "@/lib/contexto-shell";
import { SelectorContribuyente } from "@/components/selector-contribuyente";

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const ctx = await contextoShell();
  if (!ctx) redirect("/login");

  const esDespacho = ctx.organizacion?.tipo === "despacho";
  const inicio = esDespacho ? "/cartera" : `/${ctx.contribuyentes[0]?.slug ?? ""}/impuestos`;

  async function salir() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="min-h-dvh" style={{ background: "var(--bg)" }}>
      <header
        className="flex items-center gap-4 border-b px-5 py-2.5"
        style={{ background: "var(--bar)", borderColor: "var(--line)" }}
      >
        <Link href={inicio} className="flex items-center gap-2">
          <i className="ph-duotone ph-receipt" aria-hidden style={{ fontSize: 19, color: "var(--accent-2)" }} />
          <span className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--text)" }}>
            Cifra
          </span>
        </Link>

        {esDespacho && ctx.contribuyentes.length > 0 && (
          <SelectorContribuyente contribuyentes={ctx.contribuyentes} />
        )}

        <nav className="ml-auto flex items-center gap-4 text-[13px]">
          {esDespacho && (
            <Link href="/cartera" style={{ color: "var(--muted)" }}>
              Cartera
            </Link>
          )}
          {ctx.organizacion && (
            <Link href="/equipo" style={{ color: "var(--muted)" }}>
              Equipo
            </Link>
          )}
          <form action={salir} className="flex items-center gap-2">
            <span className="num text-[12.5px]" style={{ color: "var(--faint)" }}>
              {ctx.usuario.email}
            </span>
            <button type="submit" title="Salir" style={{ color: "var(--muted)" }}>
              <i className="ph-duotone ph-sign-out" aria-hidden style={{ fontSize: 16 }} />
            </button>
          </form>
        </nav>
      </header>

      {children}
    </div>
  );
}
