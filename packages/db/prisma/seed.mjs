// Punto de entrada de `prisma db seed` (ver "prisma.seed" en package.json). Orquesta: base de
// datos (local embebida si no hay DATABASE_URL, o la del entorno si ya hay una — Neon, según
// packages/db/README.md), migraciones, y la carga de datos de datos-seed.mjs.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { asegurarBaseLocal, asegurarContrasenaApp, exigirDestinoLocal } from "../scripts/db-local.mjs";
import { sembrarDatos } from "./datos-seed.mjs";

const directorioPaquete = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPrisma = join(directorioPaquete, "node_modules", "prisma", "build", "index.js");

async function main() {
  const local = await asegurarBaseLocal();
  // Solo pisa las variables de entorno cuando el Postgres es el local propio: ahí "url" sirve
  // para las dos (mismo servidor, un solo rol dueño). Si ya había DATABASE_URL en el entorno
  // (Neon), asegurarBaseLocal() lo devuelve tal cual en `local.url` — pisar DIRECT_URL con eso
  // reemplazaba la cadena del dueño por la de cifra_app y hacía correr `migrate deploy` con un
  // rol sin privilegios para migrar. Pasó de verdad: ver la migración 20260905050613 en Neon.
  if (local.esLocal) {
    process.env.DATABASE_URL = local.url;
    process.env.DIRECT_URL = local.url;
  } else {
    // No es el Postgres local: antes de correr migrate deploy (o, si el host fuera de verdad
    // vacío, el TRUNCATE de más abajo) contra lo que sea que haya en DATABASE_URL, exige que
    // sea localhost o una confirmación explícita. Ver exigirDestinoLocal().
    exigirDestinoLocal(local.url, { comando: "pnpm db:seed" });
  }

  console.log(
    local.esLocal
      ? `→ Sin DATABASE_URL en el entorno: usando Postgres local en ${local.url}`
      : `→ Usando DATABASE_URL del entorno (${local.url.replace(/:[^:@]+@/, ":****@")})`,
  );

  execFileSync(process.execPath, [cliPrisma, "migrate", "deploy"], {
    cwd: directorioPaquete,
    env: process.env,
    stdio: "inherit",
  });

  // rls.sql (dentro de la primera migración) crea `cifra_app` sin contraseña. En local le
  // ponemos una para que apps/web pueda conectarse con ese rol y RLS se ejerza de verdad — no
  // como `postgres`, que la ignora. En Neon esto no hace nada (el rol se gestiona aparte).
  if (local.esLocal) await asegurarContrasenaApp();

  // Import diferido: el cliente generado no existe hasta que corrió `prisma generate`, y
  // conviene que ese error salga después del migrate deploy, no antes.
  const { PrismaClient } = await import("../src/generated/client/index.js");
  const prisma = new PrismaClient();

  try {
    if (local.esLocal) {
      // Solo en el Postgres local propio: correr esto dos veces no debe fallar por RFC/slug
      // duplicados. NUNCA se hace esto si DATABASE_URL apunta a otra parte (Neon incluido) —
      // ahí el seed asume una base vacía y, si no lo está, el error de unicidad debe salir.
      console.log("→ Limpiando datos del Postgres local antes de sembrar…");
      await prisma.$executeRawUnsafe(`
        TRUNCATE TABLE
          bitacora, resumen_contribuyente, solicitud_presentacion, autorizacion_credencial,
          credencial_fiscal, invitacion, acceso, sincronizacion_sat, mensaje_ia,
          conversacion_ia, notificacion, declaracion, asiento, poliza, movimiento_bancario,
          cuenta_bancaria, cfdi_impuesto, cfdi, cuenta_contable, obligacion, constancia,
          contribuyente, membresia, suscripcion, organizacion, usuario
        RESTART IDENTITY CASCADE
      `);
    }

    await sembrarDatos(prisma);
    console.log("✔ Semilla cargada.");
  } finally {
    await prisma.$disconnect();
  }

  if (local.esLocal) {
    console.log(
      "\nLos datos quedaron en packages/db/.pgdata (persisten entre corridas).\n" +
        "Para verlos: pnpm db:studio\n",
    );
    await local.cerrar();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
