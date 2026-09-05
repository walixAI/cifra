"use server";

// Asignar (o quitar) el responsable de un cliente. Solo propietario/admin de la organización, y
// solo sobre clientes de su propia organización, y el responsable tiene que ser miembro de esa
// misma organización. Queda en Bitácora (§9: asignación de responsable no es cambio de acceso,
// pero sí es una decisión de administración que conviene poder auditar).

import { revalidatePath } from "next/cache";
import { prisma } from "@cifra/db";
import { contextoOrganizacion } from "@/lib/contexto-organizacion";

export async function asignarResponsable(contribuyenteId: string, responsableId: string | null) {
  const ctx = await contextoOrganizacion();
  if (ctx.rol !== "propietario" && ctx.rol !== "admin") {
    throw new Error("solo propietario o admin asignan responsables");
  }

  const contribuyente = await prisma.contribuyente.findUnique({ where: { id: contribuyenteId } });
  if (!contribuyente || contribuyente.organizacion_id !== ctx.organizacion.id) {
    throw new Error("ese cliente no es de tu organización");
  }

  if (responsableId !== null) {
    const membresia = await prisma.membresia.findUnique({
      where: {
        usuario_id_organizacion_id: { usuario_id: responsableId, organizacion_id: ctx.organizacion.id },
      },
    });
    if (!membresia) throw new Error("el responsable tiene que ser miembro de la organización");
  }

  await prisma.$transaction([
    prisma.contribuyente.update({
      where: { id: contribuyenteId },
      data: { responsable_id: responsableId },
    }),
    prisma.bitacora.create({
      data: {
        usuario_id: ctx.usuario.id,
        organizacion_id: ctx.organizacion.id,
        contribuyente_id: contribuyenteId,
        accion: "acceso_cambiado",
        entidad: "contribuyente",
        entidad_id: contribuyenteId,
        metadatos: { campo: "responsable_id", nuevo: responsableId },
      },
    }),
  ]);

  revalidatePath("/equipo");
}
