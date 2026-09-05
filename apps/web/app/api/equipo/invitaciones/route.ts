// POST /api/equipo/invitaciones — invitar a alguien a la ORGANIZACIÓN (Invitacion → Membresia
// al aceptar). La máquina de §4.1: el cuerpo de la respuesta le dice al cliente qué estado
// pintar (conflict | error | sent | validacion).

import { contextoOrganizacion } from "@/lib/contexto-organizacion";
import { NoAutenticado, SinAcceso } from "@/lib/errores";
import { invitarAOrganizacion } from "@/lib/invitaciones";

const ROLES_VALIDOS = ["admin", "miembro"] as const;

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof contextoOrganizacion>>;
  try {
    ctx = await contextoOrganizacion();
  } catch (error) {
    if (error instanceof NoAutenticado) return Response.json({ error: "no_autenticado" }, { status: 401 });
    if (error instanceof SinAcceso) return Response.json({ error: "no_encontrado" }, { status: 404 });
    throw error;
  }

  // §2 del documento de inquilinos: solo propietario y admin invitan al equipo.
  if (ctx.rol !== "propietario" && ctx.rol !== "admin") {
    return Response.json({ error: "sin_permiso" }, { status: 403 });
  }

  const cuerpo = (await request.json().catch(() => ({}))) as { correo?: unknown; rol?: unknown };
  const correo = typeof cuerpo.correo === "string" ? cuerpo.correo : "";
  const rol = ROLES_VALIDOS.find((r) => r === cuerpo.rol);
  if (!rol) return Response.json({ error: "rol_invalido" }, { status: 400 });

  const resultado = await invitarAOrganizacion({
    organizacionId: ctx.organizacion.id,
    correoCrudo: correo,
    rol,
    quienInvita: ctx.usuario.email,
  });

  const status =
    resultado.estado === "sent"
      ? 200
      : resultado.estado === "validacion"
        ? 400
        : resultado.estado === "conflict"
          ? 409
          : 502; // error de envío
  return Response.json(resultado, { status });
}
