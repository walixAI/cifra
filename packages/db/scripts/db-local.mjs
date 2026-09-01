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
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directorioPaquete = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(directorioPaquete, ".pgdata");
const PUERTO = 55432;

function urlPara(puerto) {
  return `postgresql://postgres:postgres@localhost:${puerto}/cifra`;
}

/**
 * Devuelve la cadena de conexión a usar y, si tocó levantar un Postgres local, una función
 * `cerrar()` para apagarlo al terminar. Si ya había DATABASE_URL en el entorno, `cerrar` no
 * hace nada — no es nuestro Postgres, no lo tocamos.
 */
export async function asegurarBaseLocal() {
  if (process.env.DATABASE_URL) {
    return {
      url: process.env.DATABASE_URL,
      esLocal: false,
      async cerrar() {},
    };
  }

  const yaInicializado = existsSync(join(dataDir, "PG_VERSION"));

  const pg = new EmbeddedPostgres({
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
    await pg.initialise();
  }
  await pg.start();
  if (!yaInicializado) {
    await pg.createDatabase("cifra");
  }

  const url = urlPara(PUERTO);
  return {
    url,
    esLocal: true,
    async cerrar() {
      await pg.stop();
    },
  };
}

/** Borra los datos del Postgres local (no toca Neon). Para empezar de cero. */
export async function borrarDatosLocales() {
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
