#!/usr/bin/env node
// Genera una migración nueva sin Neon ni Docker: levanta un Postgres real embebido, aplica las
// migraciones que ya existen (`prisma migrate deploy`, tal cual correría en producción) y
// difiere el schema.prisma actual contra ese estado (`prisma migrate dev --create-only`).
//
// Uso:
//   node scripts/generar-migracion.mjs <nombre-de-la-migracion>
//
// El archivo migration.sql resultante hay que revisarlo a mano y, si la migración toca
// tablas nuevas con contribuyente_id, pegarle otra vez el cuerpo de handoff/backend/rls.sql al
// final — no se hace solo, y no es opcional (ver packages/db/README.md).

import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const nombre = process.argv[2];
if (!nombre) {
  console.error("Uso: node scripts/generar-migracion.mjs <nombre>");
  process.exit(1);
}

const directorioPaquete = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPrisma = join(directorioPaquete, "node_modules", "prisma", "build", "index.js");
const dataDir = mkdtempSync(join(tmpdir(), "cifra-migrar-"));
const puerto = 40000 + Math.floor(Math.random() * 15000);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  port: puerto,
  user: "postgres",
  password: "postgres",
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: () => {},
});

try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("cifra");

  const url = `postgresql://postgres:postgres@localhost:${puerto}/cifra`;
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };

  execFileSync(process.execPath, [cliPrisma, "migrate", "deploy"], {
    cwd: directorioPaquete,
    env,
    stdio: "inherit",
  });

  execFileSync(
    process.execPath,
    [cliPrisma, "migrate", "dev", "--create-only", "--name", nombre, "--skip-generate"],
    { cwd: directorioPaquete, env, stdio: "inherit" },
  );
} finally {
  await pg.stop();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
