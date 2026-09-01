import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los paquetes del monorepo se consumen como fuente TypeScript, no compilada.
  transpilePackages: ["@cifra/ui"],
};

export default nextConfig;
