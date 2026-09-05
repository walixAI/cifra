// /cartera — la pantalla de entrada del despacho (ARQUITECTURA-MULTIINQUILINO.md §6). Solo para
// organizaciones `despacho`; una organización `personal` no tiene cartera y se va a su
// contribuyente. Lee SOLO de ResumenContribuyente (lib/cartera.ts).

import { redirect } from "next/navigation";
import { contextoOrganizacion } from "@/lib/contexto-organizacion";
import { NoAutenticado, SinAcceso } from "@/lib/errores";
import { obtenerCartera } from "@/lib/cartera";
import { TablaCartera } from "./tabla-cartera";

const PERIODO_ACTUAL = "2026-08"; // el escenario sembrado; el picker de periodo llega en el paso 9

export default async function PaginaCartera() {
  let ctx: Awaited<ReturnType<typeof contextoOrganizacion>>;
  try {
    ctx = await contextoOrganizacion();
  } catch (error) {
    if (error instanceof NoAutenticado) redirect("/login?callbackUrl=/cartera");
    if (error instanceof SinAcceso) redirect("/");
    throw error;
  }

  if (ctx.organizacion.tipo !== "despacho") {
    redirect("/"); // una organización personal no tiene cartera
  }

  const filas = await obtenerCartera(ctx.usuario.id, PERIODO_ACTUAL);

  return (
    <main className="mx-auto max-w-6xl px-5 py-6">
      <div className="flex items-center gap-2">
        <i className="ph-duotone ph-address-book" aria-hidden style={{ fontSize: 22, color: "var(--accent-2)" }} />
        <h1 className="m-0 text-[22px] font-semibold tracking-tight">Cartera</h1>
      </div>
      <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
        {filas.length} {filas.length === 1 ? "cliente" : "clientes"} · lo que le puede estallar al
        despacho, ordenado por urgencia
      </p>

      {filas.length === 0 ? (
        <p className="mt-8 text-sm" style={{ color: "var(--muted)" }}>
          Todavía no tienes clientes con acceso activo. Invítalos desde{" "}
          <a href="/equipo" style={{ color: "var(--accent)" }}>
            Equipo
          </a>
          .
        </p>
      ) : (
        <TablaCartera filas={filas} />
      )}
    </main>
  );
}
