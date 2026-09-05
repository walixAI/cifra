// /invitaciones/[token] — aceptar una invitación. El mismo enlace sirve para los dos tipos de
// token (Invitacion de organización, Acceso de contribuyente); buscarInvitacion() los distingue.
//
// Cuatro salidas, cada una con su propio arreglo:
//   · no existe / no coincide con ninguna tabla → "enlace que no sirve" (no se revela cuál se probó)
//   · vencida         → dice cuándo venció y que hay que pedir otra
//   · ya usada        → manda a entrar directo con tu correo
//   · correo no coincide → nombra los dos correos y ofrece salir y volver a entrar
//   · todo en orden, sin sesión → a /login con el correo del invitado prellenado
//   · todo en orden, con la sesión correcta → botón de aceptar

import { redirect } from "next/navigation";
import { evaluarInvitacion, MENSAJES_AL_ACEPTAR } from "@cifra/core";
import { auth, signOut } from "@/lib/auth";
import { aceptarInvitacion, buscarInvitacion } from "@/lib/invitaciones";

function fechaLegible(d: Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Mexico_City",
  }).format(d);
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <div className="flex items-center gap-2">
        <i className="ph-duotone ph-envelope-simple" aria-hidden style={{ fontSize: 20, color: "var(--accent-2)" }} />
        <h1 className="m-0 text-[17px] font-semibold tracking-tight">Invitación a Cifra</h1>
      </div>
      <div className="mt-4">{children}</div>
    </main>
  );
}

function Aviso({ tono, children }: { tono: "neg" | "warn"; children: React.ReactNode }) {
  return (
    <p
      className="rounded-lg px-3.5 py-3 text-sm leading-relaxed"
      style={{
        background: tono === "neg" ? "var(--neg-bg)" : "var(--act-bg)",
        color: "var(--text)",
      }}
    >
      {children}
    </p>
  );
}

export default async function PaginaInvitacion({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const inv = await buscarInvitacion(token);
  if (!inv) {
    return (
      <Marco>
        <Aviso tono="neg">Este enlace de invitación no sirve — puede que ya se haya usado o que esté mal copiado.</Aviso>
      </Marco>
    );
  }

  const sesion = await auth();
  const estado = evaluarInvitacion({
    expiraEn: inv.expiraEn,
    yaUsada: inv.yaUsada,
    correoInvitado: inv.correo,
    correoSesion: sesion?.usuario.email ?? null,
    ahora: new Date(),
  });

  if (estado === "vencida") {
    return (
      <Marco>
        <Aviso tono="neg">{MENSAJES_AL_ACEPTAR.vencida(fechaLegible(inv.expiraEn))}</Aviso>
      </Marco>
    );
  }

  if (estado === "ya_usada") {
    return (
      <Marco>
        <Aviso tono="warn">{MENSAJES_AL_ACEPTAR.ya_usada}</Aviso>
        <a href="/login" className="mt-3 inline-block text-sm font-semibold" style={{ color: "var(--accent)" }}>
          Entrar
        </a>
      </Marco>
    );
  }

  if (estado === "correo_no_coincide") {
    async function salir() {
      "use server";
      await signOut({ redirectTo: `/login?callbackUrl=/invitaciones/${token}` });
    }
    return (
      <Marco>
        <Aviso tono="warn">
          {MENSAJES_AL_ACEPTAR.correo_no_coincide(inv.correo, sesion!.usuario.email)}
        </Aviso>
        <form action={salir} className="mt-3">
          <button type="submit" className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
            Salir y entrar con {inv.correo}
          </button>
        </form>
      </Marco>
    );
  }

  // estado === "lista"
  if (!sesion) {
    redirect(`/login?callbackUrl=/invitaciones/${token}&email=${encodeURIComponent(inv.correo)}`);
  }

  const queEs =
    inv.tipo === "organizacion"
      ? `al equipo de ${inv.organizacionNombre}, con rol de ${inv.rol}`
      : `a la contabilidad de ${inv.contribuyenteNombre}, con rol de ${inv.rol.replace("_", " ")}`;

  async function aceptar() {
    "use server";
    const resultado = await aceptarInvitacion(token, sesion!.usuario);
    if (resultado.ok) {
      redirect(
        `/invitaciones/aceptada?a=${encodeURIComponent(resultado.destino)}&que=${encodeURIComponent(resultado.que)}`,
      );
    }
    // Cambió algo entre pintar la página y darle al botón (venció, alguien más la usó): recargar
    // la vuelve a evaluar y muestra el estado correcto.
    redirect(`/invitaciones/${token}`);
  }

  return (
    <Marco>
      <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        Te invitaron {queEs}.
      </p>
      <form action={aceptar} className="mt-4">
        <button
          type="submit"
          className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold"
          style={{ background: "var(--accent)", color: "var(--onaccent)" }}
        >
          Aceptar
        </button>
      </form>
    </Marco>
  );
}
