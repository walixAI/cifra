// Base de datos local de desarrollo — sin Docker, sin cuenta de Neon.
//
// Si ya hay DATABASE_URL en el entorno (o en .env, vía Neon — ver README.md), se respeta tal
// cual: nada de lo de aquí se activa. Si no hay ninguna, se levanta un Postgres embebido
// PERSISTENTE en packages/db/.pgdata — mismos binarios que usan las pruebas, pero con los datos
// guardados en disco entre corridas, como cualquier Postgres local.
//
// El proceso de Postgres se apaga solo cuando el script que lo levantó termina (lo hace
// embedded-postgres con un exit hook); por eso cada comando (seed, studio) abre su propia
// instancia sobre el mismo directorio y la cierra al terminar. Los datos persisten porque
// `persistent: true` no los borra al parar — solo se borrarían con `borrarDatosLocales()`.

import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directorioPaquete = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(directorioPaquete, ".pgdata");
const PUERTO = 55432;

// El dueño de las tablas: migra y siembra (bypassa RLS por ser superusuario).
const CONTRASENA_APP = "cifra_app_local"; // solo local; en Neon el rol se gestiona aparte

function urlDueno(puerto) {
  return `postgresql://postgres:postgres@localhost:${puerto}/cifra`;
}
/** La cadena que debe usar apps/web: rol cifra_app, sin bypass de RLS — como en producción. */
function urlApp(puerto) {
  return `postgresql://cifra_app:${CONTRASENA_APP}@localhost:${puerto}/cifra`;
}

/** Le pone contraseña a cifra_app si el rol ya existe (lo crea rls.sql, sin contraseña). */
export async function asegurarContrasenaApp(puerto = PUERTO) {
  const cliente = new pg.Client({ connectionString: urlDueno(puerto) });
  try {
    await cliente.connect();
    const existe = await cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'cifra_app'");
    if (existe.rowCount > 0) {
      await cliente.query(`ALTER ROLE cifra_app WITH PASSWORD '${CONTRASENA_APP}'`);
    }
  } catch {
    // Si aún no se ha corrido ninguna migración, cifra_app no existe todavía — no pasa nada,
    // seed.mjs corre las migraciones y en la siguiente llamada ya se le pone la contraseña.
  } finally {
    await cliente.end().catch(() => {});
  }
}

/**
 * Devuelve las cadenas de conexión a usar y, si tocó levantar un Postgres local, una función
 * `cerrar()` para apagarlo al terminar. Si ya había DATABASE_URL en el entorno, `cerrar` no
 * hace nada — no es nuestro Postgres, no lo tocamos.
 *
 * `url` es la del dueño (migrar/sembrar); `urlApp` es la de cifra_app (lo que consume apps/web,
 * con RLS de verdad). En Neon las dos vienen del entorno.
 */
export async function asegurarBaseLocal() {
  if (process.env.DATABASE_URL) {
    return {
      url: process.env.DATABASE_URL,
      urlApp: process.env.DATABASE_URL,
      esLocal: false,
      async cerrar() {},
    };
  }

  const yaInicializado = existsSync(join(dataDir, "PG_VERSION"));

  const instancia = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: PUERTO,
    user: "postgres",
    password: "postgres",
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: (mensaje) => console.error(String(mensaje)),
  });

  if (!yaInicializado) {
    console.log(`(sin DATABASE_URL — inicializando Postgres local en ${dataDir})`);
    await instancia.initialise();
  }
  await instancia.start();
  if (!yaInicializado) {
    await instancia.createDatabase("cifra");
  }
  await asegurarContrasenaApp(PUERTO);

  return {
    url: urlDueno(PUERTO),
    urlApp: urlApp(PUERTO),
    esLocal: true,
    async cerrar() {
      await instancia.stop();
    },
  };
}

/** Borra los datos del Postgres local (no toca Neon). Para empezar de cero. */
export async function borrarDatosLocales() {
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
