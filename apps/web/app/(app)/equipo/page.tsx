// /equipo — miembros de la organización, invitaciones pendientes, y la matriz de accesos por
// cliente con asignación de responsable. Los dos niveles de rol de
// ARQUITECTURA-MULTIINQUILINO.md §2: Membresia.rol (organización) y Acceso.rol (contribuyente).
// Un admin de despacho NO hereda acceso a los libros — solo administra.

import { redirect } from "next/navigation";
import { contextoOrganizacion } from "@/lib/contexto-organizacion";
import { NoAutenticado, SinAcceso } from "@/lib/errores";
import { obtenerEquipo } from "@/lib/equipo";
import { FormularioInvitar } from "@/components/formulario-invitar";
import { ClienteFila } from "./cliente-fila";

const ROL_ORG: Record<string, string> = {
  propietario: "Propietario",
  admin: "Administrador",
  miembro: "Miembro",
};

function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" })
    .format(new Date(iso))
    .replace(".", "");
}

export default async function PaginaEquipo() {
  let ctx: Awaited<ReturnType<typeof contextoOrganizacion>>;
  try {
    ctx = await contextoOrganizacion();
  } catch (error) {
    if (error instanceof NoAutenticado) redirect("/login?callbackUrl=/equipo");
    if (error instanceof SinAcceso) redirect("/");
    throw error;
  }

  const puedeAdministrar = ctx.rol === "propietario" || ctx.rol === "admin";
  const esDespacho = ctx.organizacion.tipo === "despacho";
  const { miembros, invitacionesPendientes, clientes } = await obtenerEquipo(ctx.organizacion.id);

  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <div className="flex items-center gap-2">
        <i className="ph-duotone ph-users-three" aria-hidden style={{ fontSize: 22, color: "var(--accent-2)" }} />
        <h1 className="m-0 text-[22px] font-semibold tracking-tight">Equipo</h1>
      </div>
      <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
        {ctx.organizacion.nombre} · tu rol: {ROL_ORG[ctx.rol] ?? ctx.rol}
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Miembros */}
        <section className="rounded-2xl border p-4.5" style={{ background: "var(--panel)", borderColor: "var(--line)" }}>
          <div className="text-[14px] font-semibold">Miembros</div>
          <div className="mt-2.5 flex flex-col">
            {miembros.map((m) => (
              <div key={m.usuarioId} className="flex items-center justify-between border-b py-2 last:border-0" style={{ borderColor: "var(--line2)" }}>
                <div>
                  <div className="text-[13.5px] font-medium">{m.nombre}</div>
                  <div className="num text-[12px]" style={{ color: "var(--faint)" }}>
                    {m.email}
                  </div>
                </div>
                <span className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                  {ROL_ORG[m.rol] ?? m.rol}
                </span>
              </div>
            ))}
            {invitacionesPendientes.map((i) => (
              <div key={i.email} className="flex items-center justify-between border-b py-2 last:border-0" style={{ borderColor: "var(--line2)" }}>
                <div>
                  <div className="num text-[13px]">{i.email}</div>
                  <div className="text-[12px]" style={{ color: "var(--faint)" }}>
                    invitado el {fechaCorta(i.creadaEn)} · sin aceptar
                  </div>
                </div>
                <span className="text-[12.5px]" style={{ color: "var(--warn)" }}>
                  {ROL_ORG[i.rol] ?? i.rol}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Invitar al equipo — solo despachos: a una organización personal no se le suman miembros */}
        {puedeAdministrar && esDespacho && (
          <FormularioInvitar
            endpoint="/api/equipo/invitaciones"
            verAccesosHref="/equipo"
            roles={[
              { valor: "admin", etiqueta: "Administrador", detalle: "Invita gente, da de alta clientes, asigna responsables. No factura." },
              { valor: "miembro", etiqueta: "Miembro", detalle: "Solo lo que sus accesos por cliente le concedan." },
            ]}
          />
        )}
      </div>

      {/* Matriz de accesos por cliente */}
      <section className="mt-4 rounded-2xl border p-4.5" style={{ background: "var(--panel)", borderColor: "var(--line)" }}>
        <div className="text-[14px] font-semibold">Clientes y accesos</div>
        <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted)" }}>
          Estar en el equipo no da acceso a los libros de un cliente — eso se concede aquí, cliente por cliente.
        </p>
        {clientes.length === 0 ? (
          <p className="mt-3 text-[13px]" style={{ color: "var(--faint)" }}>
            Esta organización todavía no tiene clientes.
          </p>
        ) : (
          <div className="mt-1">
            {clientes.map((c) => (
              <ClienteFila key={c.id} cliente={c} miembros={miembros} puedeAdministrar={puedeAdministrar} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
