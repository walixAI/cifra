import { PrismaPlugin } from "@prisma/nextjs-monorepo-workaround-plugin";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los paquetes del monorepo se consumen como fuente TypeScript, no compilada.
  transpilePackages: ["@cifra/ui", "@cifra/db", "@cifra/core"],
  // El cliente de Prisma trae binarios nativos: se ejecuta tal cual en el server, sin bundlear.
  serverExternalPackages: ["@prisma/client"],
  // `@cifra/db` está en transpilePackages, así que webpack sí bundlea el código que importa
  // "./generated/client" — y con eso pierde la relación "el motor vive junto al index.js" que
  // Prisma da por hecha para encontrarlo en runtime. Pasó de verdad: compiló y desplegó bien,
  // y tronó en la primera consulta en Vercel con "could not locate the Query Engine". Este
  // plugin (recomendado por Prisma para monorepos con Next.js, mismo pin que `prisma` y
  // `@prisma/client`) hace que webpack trate el cliente generado como externo en el server, para
  // que el binario del motor viaje junto a su index.js tal cual Prisma espera encontrarlo.
  webpack: (config, { isServer }) => {
    if (isServer) config.plugins.push(new PrismaPlugin());
    return config;
  },
  // Vercel y CI usan el default (.next). `NEXT_DIST_DIR` deja verificar el build en local sin
  // corromper el .next de un `pnpm dev` que esté corriendo — comparten carpeta y el worker de
  // dev se cae con "Jest worker child process exceptions". Lo usa `pnpm build:verificar`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
