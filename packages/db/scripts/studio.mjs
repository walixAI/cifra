// `pnpm db:studio` — mismo criterio que seed.mjs: si hay DATABASE_URL en el entorno la respeta
// (Neon), si no levanta el Postgres local persistente en packages/db/.pgdata. Prisma Studio se
// queda en primer plano; al cerrarlo (Ctrl+C) se apaga el Postgres local, si fue el que abrimos.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { asegurarBaseLocal } from "./db-local.mjs";

const directorioPaquete = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPrisma = join(directorioPaquete, "node_modules", "prisma", "build", "index.js");

async function main() {
  const local = await asegurarBaseLocal();
  process.env.DATABASE_URL = local.url;
  process.env.DIRECT_URL = local.url;

  console.log(
    local.esLocal
      ? `→ Sin DATABASE_URL en el entorno: usando Postgres local en ${local.url}`
      : `→ Usando DATABASE_URL del entorno`,
  );

  try {
    execFileSync(process.execPath, [cliPrisma, "studio"], {
      cwd: directorioPaquete,
      env: process.env,
      stdio: "inherit",
    });
  } finally {
    if (local.esLocal) {
      await local.cerrar();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
