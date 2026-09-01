import { prisma, prismaPara } from "@cifra/db";
import { auth } from "./auth";
import { NoAutenticado, SinAcceso } from "./errores";

/**
 * Resuelve el contribuyente activo a partir del segmento de ruta
 * (/(app)/[contribuyente]/… y /api/[contribuyente]/…), verifica el Acceso del usuario contra él
 * y devuelve el cliente Prisma con alcance. Es el único lugar que debe llamarse desde route
 * handlers y Server Components: nunca se acepta un contribuyente_id que venga de la sesión o
 * del cuerpo de la petición. Ver ARQUITECTURA-MULTIINQUILINO.md §5.
 */
export async function contexto(slug: string) {
  const sesion = await auth();
  if (!sesion) throw new NoAutenticado();

  const acceso = await prisma.acceso.findFirst({
    where: {
      usuario_id: sesion.usuario.id,
      estado: "activo",
      contribuyente: { slug },
    },
    include: { contribuyente: true },
  });
  // 404, no 403: no le confirmamos a nadie que el contribuyente existe.
  if (!acceso) throw new SinAcceso();

  return {
    usuario: sesion.usuario,
    acceso,
    contribuyente: acceso.contribuyente,
    db: prismaPara(acceso.contribuyente_id),
  };
}
