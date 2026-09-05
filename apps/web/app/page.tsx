// La raíz manda a cada quien a su lugar: un despacho a su cartera, una persona a su
// contribuyente. Sin sesión, el middleware ya redirigió a /login antes de llegar aquí.
// (Una pantalla de inicio propia para organizaciones `personal` llega en el paso 9.)

import { redirect } from "next/navigation";
import { contextoShell } from "@/lib/contexto-shell";

export default async function Raiz() {
  const ctx = await contextoShell();
  if (!ctx) redirect("/login");

  if (ctx.organizacion?.tipo === "despacho") redirect("/cartera");
  if (ctx.contribuyentes[0]) redirect(`/${ctx.contribuyentes[0].slug}/impuestos`);
  if (ctx.organizacion) redirect("/equipo");

  // Sesión válida pero sin organización ni acceso a ningún contribuyente: no hay nada que ver
  // todavía (típico justo después de registrarse, antes de aceptar cualquier invitación).
  return (
    <main className="grid min-h-dvh place-items-center p-8 text-center">
      <div className="max-w-sm">
        <h1 className="text-lg font-semibold tracking-tight">Ya entraste a Cifra</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Todavía no tienes acceso a ninguna contabilidad. Cuando alguien te invite, el enlace del
          correo te trae aquí con acceso.
        </p>
      </div>
    </main>
  );
}
