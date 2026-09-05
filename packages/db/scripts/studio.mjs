// `pnpm db:studio` — mismo criterio que seed.mjs: si hay DATABASE_URL en el entorno la respeta
// (Neon), si no levanta el Postgres local persistente en packages/db/.pgdata. Prisma Studio se
// queda en primer plano; al cerrarlo (Ctrl+C) se apaga el Postgres local, si fue el que abrimos.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { asegurarBaseLocal } from "./db-local.mjs";

const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "::1"]);
const directorioPaquete = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPrisma = join(directorioPaquete, "node_modules", "prisma", "build", "index.js");

async function main() {
  const local = await asegurarBaseLocal();
  // Solo pisa las variables de entorno en el Postgres local propio — mismo motivo que seed.mjs:
  // en Neon, local.url es DATABASE_URL (cifra_app), y pisar DIRECT_URL con eso es incorrecto
  // aunque Studio no migre nada con esa cadena.
  if (local.esLocal) {
    process.env.DATABASE_URL = local.url;
    process.env.DIRECT_URL = local.url;
  }

  if (local.esLocal) {
    console.log(`→ Sin DATABASE_URL en el entorno: usando Postgres local en ${local.url}`);
  } else {
    const host = new URL(local.url).hostname;
    console.log(
      HOSTS_LOCALES.has(host)
        ? `→ Usando DATABASE_URL del entorno (${host})`
        : `⚠️  Usando DATABASE_URL del entorno — esto abre Studio contra «${host}», no un Postgres local. Studio permite editar y borrar filas desde la UI.`,
    );
  }

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
