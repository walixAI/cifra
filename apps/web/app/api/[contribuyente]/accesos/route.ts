// POST /api/[contribuyente]/accesos — invitar a alguien a los libros de UN contribuyente
// (Acceso). Misma máquina de §4.1 que /api/equipo/invitaciones.

import { contexto } from "@/lib/contexto";
import { NoAutenticado, SinAcceso } from "@/lib/errores";
import { invitarAContribuyente } from "@/lib/invitaciones";

const ROLES_VALIDOS = ["contador", "captura", "solo_lectura"] as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ contribuyente: string }> },
) {
  const { contribuyente: slug } = await params;

  let ctx: Awaited<ReturnType<typeof contexto>>;
  try {
    ctx = await contexto(slug);
  } catch (error) {
    if (error instanceof NoAutenticado) return Response.json({ error: "no_autenticado" }, { status: 401 });
    if (error instanceof SinAcceso) return Response.json({ error: "no_encontrado" }, { status: 404 });
    throw error;
  }

  // Solo quien manda sobre los libros de este contribuyente puede sumar colaboradores. El
  // propietario_fiscal no se puede otorgar por invitación (§2 del documento de inquilinos).
  if (ctx.acceso.rol !== "propietario_fiscal" && ctx.acceso.rol !== "contador") {
    return Response.json({ error: "sin_permiso" }, { status: 403 });
  }

  const cuerpo = (await request.json().catch(() => ({}))) as { correo?: unknown; rol?: unknown };
  const correo = typeof cuerpo.correo === "string" ? cuerpo.correo : "";
  const rol = ROLES_VALIDOS.find((r) => r === cuerpo.rol);
  if (!rol) return Response.json({ error: "rol_invalido" }, { status: 400 });

  const resultado = await invitarAContribuyente({
    db: ctx.db,
    contribuyenteId: ctx.contribuyente.id,
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
          : 502;
  return Response.json(resultado, { status });
}
