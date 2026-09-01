import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los paquetes del monorepo se consumen como fuente TypeScript, no compilada.
  transpilePackages: ["@cifra/ui", "@cifra/db"],
  // El cliente de Prisma trae binarios nativos: se ejecuta tal cual en el server, sin bundlear.
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
