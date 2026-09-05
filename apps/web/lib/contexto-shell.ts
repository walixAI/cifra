// Lo que necesita la barra superior (app/(app)/layout.tsx): quién es el usuario, en qué
// organización está (si en alguna), y a qué contribuyentes puede entrar. No verifica acceso a
// ninguna pantalla en concreto — eso lo hacen contexto() y contextoOrganizacion() en cada
// página. Esto solo pinta el marco.

import { prisma, prismaParaUsuario } from "@cifra/db";
import type { RolOrganizacion } from "@cifra/db";
import { auth } from "./auth";

export interface ContextoShell {
  usuario: { id: string; email: string };
  organizacion: { id: string; nombre: string; tipo: string } | null;
  rolOrganizacion: RolOrganizacion | null;
  contribuyentes: { slug: string; nombre: string }[];
}

export async function contextoShell(): Promise<ContextoShell | null> {
  const sesion = await auth();
  if (!sesion) return null; // el middleware ya debió redirigir; esto es el respaldo

  // Una persona puede estar en una organización (Membresia) o no —un cliente que aceptó una
  // invitación a sus libros tiene Acceso pero no Membresia—. Las dos cosas son válidas.
  const [membresia, accesos] = await Promise.all([
    prisma.membresia.findFirst({
      where: { usuario_id: sesion.usuario.id },
      include: { organizacion: true },
      orderBy: { creado_en: "asc" },
    }),
    prismaParaUsuario(sesion.usuario.id).acceso.findMany({
      where: { estado: "activo" },
      select: { contribuyente: { select: { slug: true, nombre: true } } },
      orderBy: { invitado_en: "asc" },
    }),
  ]);

  return {
    usuario: sesion.usuario,
    organizacion: membresia
      ? { id: membresia.organizacion.id, nombre: membresia.organizacion.nombre, tipo: membresia.organizacion.tipo }
      : null,
    rolOrganizacion: membresia?.rol ?? null,
    contribuyentes: accesos.map((a) => ({ slug: a.contribuyente.slug, nombre: a.contribuyente.nombre })),
  };
}
