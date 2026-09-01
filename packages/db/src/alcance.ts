import { prisma } from "./cliente";

/**
 * Cliente Prisma con alcance a un contribuyente. Cada operación corre dentro de su propia
 * transacción, que primero fija `app.contribuyente_id` con `set_config(..., true)` — es decir
 * SET LOCAL — y luego ejecuta la consulta. Esa variable de sesión es lo que compara la política
 * de rls.sql; si nunca se fija, `current_setting` devuelve NULL y la tabla no regresa ninguna
 * fila (falla cerrada).
 *
 * SET LOCAL solo vive dentro de la transacción en la que se fija — por eso cada operación abre
 * la suya en vez de compartir una. Es el costo conocido de RLS con el pooler de Neon en modo
 * transacción (una variable de sesión normal se filtraría a la siguiente conexión).
 *
 * `contexto()` en apps/web/lib/contexto.ts es el único lugar que debe llamar a esta función; los
 * handlers usan siempre el `db` que devuelve, nunca `prisma` a secas. Ver
 * ARQUITECTURA-MULTIINQUILINO.md §4–§5.
 */
export function prismaPara(contribuyenteId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, resultado] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.contribuyente_id', ${contribuyenteId}, true)`,
            query(args),
          ]);
          return resultado;
        },
      },
    },
  });
}

export type ClienteConAlcance = ReturnType<typeof prismaPara>;
