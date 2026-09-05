// El equivalente de contexto() para las pantallas de organización (/equipo, /cartera): resuelve
// la organización activa del usuario. Mismo espíritu que contexto() —la autoridad se verifica
// contra la base, nunca contra la sesión— pero por Membresia en vez de Acceso.
//
// /equipo y /cartera son rutas planas (no /[organizacion]/…): el mensaje del paso 8 las pide
// así, y el seed nunca le da a un usuario dos organizaciones a la vez. Multi-organización (un
// selector de organización, como el de contribuyente) queda fuera del paso 8 — si un usuario
// llega con dos Membresia, esto toma la primera y habría que construir ese selector.

import { prisma } from "@cifra/db";
import type { RolOrganizacion } from "@cifra/db";
import { auth } from "./auth";
import { NoAutenticado, SinAcceso } from "./errores";

export async function contextoOrganizacion(): Promise<{
  usuario: { id: string; email: string };
  organizacion: { id: string; nombre: string; tipo: string };
  rol: RolOrganizacion;
}> {
  const sesion = await auth();
  if (!sesion) throw new NoAutenticado();

  const membresias = await prisma.membresia.findMany({
    where: { usuario_id: sesion.usuario.id },
    include: { organizacion: true },
    orderBy: { creado_en: "asc" },
  });
  const membresia = membresias[0];
  if (!membresia) throw new SinAcceso(); // 404: no confirmamos que exista organización alguna

  return {
    usuario: sesion.usuario,
    organizacion: {
      id: membresia.organizacion.id,
      nombre: membresia.organizacion.nombre,
      tipo: membresia.organizacion.tipo,
    },
    rol: membresia.rol,
  };
}
