#!/usr/bin/env node
// `pnpm db:dev` — levanta el Postgres local persistente (packages/db/.pgdata) y se queda
// corriendo en primer plano, para que `pnpm dev` (apps/web) tenga algo a qué conectarse.
// Ctrl+C lo apaga limpio. Si ya hay DATABASE_URL en el entorno (Neon), no hace nada — no hay
// Postgres local que levantar.

import { asegurarBaseLocal } from "./db-local.mjs";

async function main() {
  if (process.env.DATABASE_URL) {
    console.log(`DATABASE_URL ya está en el entorno (${process.env.DATABASE_URL.replace(/:[^:@]+@/, ":****@")}).`);
    console.log("No hay Postgres local que levantar — este comando es solo para desarrollo sin Neon.");
    return;
  }

  const local = await asegurarBaseLocal();
  console.log("Postgres local corriendo:");
  console.log(`  · dueño (migrar/sembrar):  ${local.url}`);
  console.log(`  · apps/web (con RLS):      ${local.urlApp}`);
  console.log("apps/web/.env.local debe apuntar a la de cifra_app (ya viene así en el repo).");
  console.log("Ctrl+C para apagarlo.");

  const apagar = async () => {
    console.log("\nApagando Postgres local…");
    await local.cerrar();
    process.exit(0);
  };
  process.on("SIGINT", apagar);
  process.on("SIGTERM", apagar);

  // Se queda vivo indefinidamente — el proceso de postgres embebido lo mantiene ocupado.
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
