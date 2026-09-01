import { PrismaClient } from "./generated/client";

// Cliente SIN alcance: solo para operaciones de plataforma (Usuario, Organizacion, Membresia,
// Suscripcion — quedan fuera de RLS a propósito, ver rls.sql) y para resolver contexto() antes
// de tener un contribuyente_id. Ningún dato con dinero adentro se lee con este cliente directo:
// eso pasa siempre por prismaPara(). Ver ARQUITECTURA-MULTIINQUILINO.md §4.
const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalParaPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalParaPrisma.prisma = prisma;
}
