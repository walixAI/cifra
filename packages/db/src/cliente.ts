import { PrismaClient } from "./generated/client";

// Cliente SIN alcance: solo para operaciones de plataforma (Usuario, Organizacion, Membresia,
// Suscripcion — quedan fuera de RLS a propósito, ver rls.sql) y para resolver contexto() antes
// de tener un contribuyente_id. Ningún dato con dinero adentro se lee con este cliente directo:
// eso pasa siempre por prismaPara(). Ver ARQUITECTURA-MULTIINQUILINO.md §4.
const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

// PRISMA_LOG_QUERIES=true agrega el evento "query" sin cambiar nada más — lo usa
// test/aislamiento.test.ts para CONTAR consultas reales (la cartera del despacho, paso 8, tiene
// que ser un número constante, no una por cliente) en vez de confiar a ojo en que el código no
// haga un N+1. Apagado por default: no toca el comportamiento normal de dev ni de producción.
const niveles: Array<"warn" | "error" | { level: "query"; emit: "event" }> =
  process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];
if (process.env.PRISMA_LOG_QUERIES === "true") {
  niveles.push({ level: "query", emit: "event" });
}

export const prisma = globalParaPrisma.prisma ?? new PrismaClient({ log: niveles });

if (process.env.NODE_ENV !== "production") {
  globalParaPrisma.prisma = prisma;
}
