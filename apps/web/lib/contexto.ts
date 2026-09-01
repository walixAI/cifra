import { prisma, prismaPara } from "@cifra/db";
import { auth } from "./auth";
import { NoAutenticado, SinAcceso } from "./errores";

/**
 * Resuelve el contribuyente activo a partir del segmento de ruta
 * (/(app)/[contribuyente]/… y /api/[contribuyente]/…), verifica el Acceso del usuario contra él
 * y devuelve el cliente Prisma con alcance. Es el único lugar que debe llamarse desde route
 * handlers y Server Components: nunca se acepta un contribuyente_id que venga de la sesión o
 * del cuerpo de la petición. Ver ARQUITECTURA-MULTIINQUILINO.md §5.
 *
 * El arranque en dos pasos importa: `acceso` sí está bajo RLS (es dato de inquilino — "quién ve
 * los libros de X"), así que no se puede consultar con el cliente global. En cambio
 * `contribuyente` NO lo está (no tiene columna `contribuyente_id`), así que se resuelve el slug
 * primero con el cliente global, y ya con ese id se abre el cliente con alcance para verificar
 * el `Acceso` — la única consulta a `acceso` que puede ver esa fila es la que corre bajo el
 * mismo `contribuyente_id`.
 */
export async function contexto(slug: string) {
  const sesion = await auth();
  if (!sesion) throw new NoAutenticado();

  // Paso 1 — resolver el contribuyente por slug. Tabla fuera de RLS.
  const contribuyente = await prisma.contribuyente.findUnique({ where: { slug } });
  // 404, no 403: no le confirmamos a nadie que el contribuyente existe.
  if (!contribuyente) throw new SinAcceso();

  const db = prismaPara(contribuyente.id);

  // Paso 2 — verificar el Acceso, ya con alcance. RLS solo deja ver la fila si es de este
  // contribuyente, así que basta filtrar por usuario_id y estado.
  const acceso = await db.acceso.findFirst({
    where: { usuario_id: sesion.usuario.id, estado: "activo" },
  });
  if (!acceso) throw new SinAcceso();

  return { usuario: sesion.usuario, acceso, contribuyente, db };
}
