// Levanta un Postgres real (binario embebido, sin Docker) para la prueba de aislamiento.
// Corre la migración TAL CUAL la correría `prisma migrate deploy` contra Neon: crea las tablas,
// el rol cifra_app y las políticas de rls.sql. La prueba se conecta como cifra_app — que no es
// dueño de las tablas ni superusuario — para que quien filtre sea la política, no el ORM.

import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directorioPaquete = fileURLToPath(new URL("..", import.meta.url));
const cliPrisma = join(directorioPaquete, "node_modules", "prisma", "build", "index.js");

const USUARIO_SUPERUSUARIO = "postgres";
const CONTRASENA_SUPERUSUARIO = "postgres";
const CONTRASENA_APP = "cifra_app_pruebas";

export interface PgEmbebido {
  /** Conexión como dueño de las tablas (superusuario) — para migrar y sembrar datos. */
  urlSuperusuario: string;
  /** Conexión como cifra_app: ni dueña de las tablas ni superusuario, sujeta a RLS siempre. */
  urlApp: string;
  puerto: number;
  detener(): Promise<void>;
}

/** Puerto aleatorio en un rango alto para no chocar con otra corrida en la misma máquina. */
function puertoLibreAlAzar(): number {
  return 40000 + Math.floor(Math.random() * 15000);
}

export async function levantarPgEmbebido(): Promise<PgEmbebido> {
  const dataDir = mkdtempSync(join(tmpdir(), "cifra-pg-"));
  const puerto = puertoLibreAlAzar();

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: puerto,
    user: USUARIO_SUPERUSUARIO,
    password: CONTRASENA_SUPERUSUARIO,
    persistent: false,
    // Fuerza UTF8 sin importar el codepage de Windows: las migraciones traen comentarios en
    // español con acentos, y el locale del sistema puede dejar el cluster en WIN1252.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase("cifra");

  const urlSuperusuario = `postgresql://${USUARIO_SUPERUSUARIO}:${CONTRASENA_SUPERUSUARIO}@localhost:${puerto}/cifra`;

  // Igual que en CI/Neon: las migraciones corren con el dueño de las tablas, nunca con cifra_app.
  execFileSync(
    process.execPath,
    [cliPrisma, "migrate", "deploy"],
    {
      cwd: directorioPaquete,
      env: {
        ...process.env,
        DATABASE_URL: urlSuperusuario,
        DIRECT_URL: urlSuperusuario,
      },
      stdio: "pipe",
    },
  );

  // rls.sql crea `cifra_app LOGIN` sin contraseña (en Neon el rol se gestiona aparte). Aquí le
  // ponemos una para poder abrir la conexión de la app en la prueba.
  const admin = pg.getPgClient("cifra");
  await admin.connect();
  await admin.query(`ALTER ROLE cifra_app WITH PASSWORD '${CONTRASENA_APP}'`);
  await admin.end();

  const urlApp = `postgresql://cifra_app:${CONTRASENA_APP}@localhost:${puerto}/cifra`;

  return {
    urlSuperusuario,
    urlApp,
    puerto,
    async detener() {
      // En Windows, bajo carga de I/O, el postgres embebido tarda en soltar los handles del
      // directorio de datos. Tanto `pg.stop()` (que con persistent:false borra los datos) como
      // el `rmSync` de respaldo pueden dar EBUSY. Nada de eso debe tumbar una corrida que YA
      // pasó: el directorio vive en el temp del SO y se limpia solo.
      try {
        await pg.stop();
      } catch (error) {
        console.warn(`pg.stop() falló (${(error as Error).message}); el proceso ya salió.`);
      }
      try {
        rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch (error) {
        console.warn(`No se pudo borrar ${dataDir} (${(error as Error).message}); se deja al SO.`);
      }
    },
  };
}
