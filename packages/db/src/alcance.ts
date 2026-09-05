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

/**
 * Cliente con alcance a UN usuario (no a un contribuyente). Fija `app.usuario_id` en vez de
 * `app.contribuyente_id`. Es lo único que necesita la cartera del despacho
 * (ARQUITECTURA-MULTIINQUILINO.md §6): con este cliente, `acceso.findMany()` devuelve
 * exactamente los `Acceso` de esa persona (política `acceso_propio`), y
 * `resumenContribuyente.findMany()` devuelve exactamente los resúmenes de los contribuyentes a
 * los que tiene `Acceso` activo (política `cartera_por_acceso`) — en ambos casos porque la
 * política resuelve la autorización consultando `acceso` ella misma, no porque la app le haya
 * pasado una lista de contribuyentes. El único dato que aporta esta función es la identidad del
 * usuario; qué ve, lo decide Postgres. Una sola llamada por tabla, sin importar cuántos
 * contribuyentes tenga: Postgres resuelve la subconsulta de la política como parte del mismo
 * plan, no como una ida y vuelta aparte de la aplicación.
 */
export function prismaParaUsuario(usuarioId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, resultado] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.usuario_id', ${usuarioId}, true)`,
            query(args),
          ]);
          return resultado;
        },
      },
    },
  });
}

/**
 * Cliente con alcance a UNA invitación por su token. Fija `app.token_invitacion` — solo lo
 * aprovecha la política `acceso_por_token` de rls.sql (paso 8, fase 3), y solo sobre `acceso`:
 * quien abre el enlace de invitación aún no tiene sesión con alcance a ningún contribuyente, y
 * el token (único, alto en entropía) es la autorización para ver y aceptar esa fila. Deja de
 * servir en cuanto la invitación se acepta o se revoca — el `where` de la consulta sigue
 * filtrando por token igual, defensa en profundidad.
 */
export function prismaParaToken(token: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, resultado] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.token_invitacion', ${token}, true)`,
            query(args),
          ]);
          return resultado;
        },
      },
    },
  });
}
