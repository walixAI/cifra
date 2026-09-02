// Configuración del worker, leída del entorno. `apps/trabajos` es el único lugar del sistema
// que habla con el SAT y que descifra la CIEC.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DatosSeed } from "@cifra/sat";

/** SAT_MODO — `falso` lee de handoff/datos/seed.json; `real` todavía no existe (paso 7). */
export const SAT_MODO = process.env.SAT_MODO ?? "falso";

/** Cuántos años hacia atrás baja la primera sincronización. */
export const AÑOS_PRIMERA_BAJADA = 3;

/** Llave maestra para el cifrado de sobre de la CIEC (32 bytes en base64). En v0 es una
 *  variable de entorno; el camino a KMS queda abierto desde el esquema (§4 de ARQUITECTURA). */
export function llaveMaestra(): Buffer {
  const b64 = process.env.CREDENCIALES_LLAVE_MAESTRA;
  if (!b64) {
    throw new Error("Falta CREDENCIALES_LLAVE_MAESTRA (32 bytes en base64).");
  }
  const llave = Buffer.from(b64, "base64");
  if (llave.length !== 32) {
    throw new Error(`CREDENCIALES_LLAVE_MAESTRA debe ser de 32 bytes; llegó ${llave.length}.`);
  }
  return llave;
}

let seedCache: DatosSeed | null = null;

/** Los datos del contribuyente ficticio, para el cliente falso del SAT. */
export function datosSeed(): DatosSeed {
  if (seedCache) return seedCache;
  const ruta = fileURLToPath(new URL("../../../handoff/datos/seed.json", import.meta.url));
  seedCache = JSON.parse(readFileSync(ruta, "utf-8")) as DatosSeed;
  return seedCache;
}
