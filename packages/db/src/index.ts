// @cifra/db — esquema Prisma de plataforma, cliente con alcance por contribuyente_id (RLS) y
// migraciones. Las entidades fiscales y su cliente de seed llegan en el paso 3 de
// PRIMEROS-PASOS.md.

export { prisma } from "./cliente";
export {
  prismaPara,
  prismaParaUsuario,
  prismaParaToken,
  type ClienteConAlcance,
} from "./alcance";

export { PrismaClient, Prisma } from "./generated/client";
export type * from "./generated/client";
