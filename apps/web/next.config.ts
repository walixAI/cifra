import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los paquetes del monorepo se consumen como fuente TypeScript, no compilada.
  transpilePackages: ["@cifra/ui", "@cifra/db", "@cifra/core"],
  // El cliente de Prisma trae binarios nativos: se ejecuta tal cual en el server, sin bundlear.
  serverExternalPackages: ["@prisma/client"],
  // Vercel y CI usan el default (.next). `NEXT_DIST_DIR` deja verificar el build en local sin
  // corromper el .next de un `pnpm dev` que esté corriendo — comparten carpeta y el worker de
  // dev se cae con "Jest worker child process exceptions". Lo usa `pnpm build:verificar`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
