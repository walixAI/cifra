// Datos de /equipo: miembros de la organización, invitaciones pendientes, y —por cada
// contribuyente de la organización— quién tiene Acceso y quién es el responsable.
//
// El Acceso está bajo RLS por contribuyente_id; se lee con prismaPara(cid) por cada
// contribuyente. Es O(N clientes), no O(1): /equipo es una pantalla de administración, no una
// ruta caliente, y así se reusa la política aislamiento_contribuyente ya endurecida sin agregar
// otra. La cartera (§6), que sí tiene que ser O(1), usa otra vía.

import { prisma, prismaPara } from "@cifra/db";
import type { RolAcceso, RolOrganizacion } from "@cifra/db";

export interface Miembro {
  usuarioId: string;
  nombre: string;
  email: string;
  rol: RolOrganizacion;
}

export interface AccesoDeCliente {
  email: string;
  rol: RolAcceso;
  estado: string;
  tieneUsuario: boolean;
}

export interface ClienteDelEquipo {
  id: string;
  slug: string;
  nombre: string;
  rfc: string;
  responsableId: string | null;
  accesos: AccesoDeCliente[];
}

export async function obtenerEquipo(organizacionId: string): Promise<{
  miembros: Miembro[];
  invitacionesPendientes: { email: string; rol: RolOrganizacion; creadaEn: string }[];
  clientes: ClienteDelEquipo[];
}> {
  const [membresias, invitaciones, contribuyentes] = await Promise.all([
    prisma.membresia.findMany({
      where: { organizacion_id: organizacionId },
      include: { usuario: { select: { id: true, nombre: true, email: true } } },
      orderBy: { creado_en: "asc" },
    }),
    prisma.invitacion.findMany({
      where: { organizacion_id: organizacionId, aceptada_en: null },
      orderBy: { creada_en: "asc" },
    }),
    prisma.contribuyente.findMany({
      where: { organizacion_id: organizacionId },
      select: { id: true, slug: true, nombre: true, rfc: true, responsable_id: true },
      orderBy: { nombre: "asc" },
    }),
  ]);

  const clientes = await Promise.all(
    contribuyentes.map(async (c) => {
      const accesos = await prismaPara(c.id).acceso.findMany({ orderBy: { invitado_en: "asc" } });
      return {
        id: c.id,
        slug: c.slug,
        nombre: c.nombre,
        rfc: c.rfc,
        responsableId: c.responsable_id,
        accesos: accesos.map((a) => ({
          email: a.email,
          rol: a.rol,
          estado: a.estado,
          tieneUsuario: a.usuario_id !== null,
        })),
      };
    }),
  );

  return {
    miembros: membresias.map((m) => ({
      usuarioId: m.usuario.id,
      nombre: m.usuario.nombre ?? m.usuario.email,
      email: m.usuario.email,
      rol: m.rol,
    })),
    invitacionesPendientes: invitaciones.map((i) => ({
      email: i.email,
      rol: i.rol,
      creadaEn: i.creada_en.toISOString(),
    })),
    clientes,
  };
}
