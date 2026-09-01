import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Postgres embebido tarda en arrancar (y la primera vez, en descargar el binario).
    hookTimeout: 180_000,
    testTimeout: 60_000,
    // Un Postgres por archivo de prueba; nada de correr varios en paralelo sin coordinarse.
    fileParallelism: false,
  },
});
