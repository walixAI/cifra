// @cifra/sat — cliente del SAT (descarga de CFDI, validación de estado, constancia), aislado y
// falseable. Se llama solo desde apps/trabajos, nunca desde apps/web.

export * from "./tipos";
export { ClienteSatFalso, type DatosSeed, type OpcionesClienteFalso } from "./cliente-falso";

import { ClienteSatFalso, type DatosSeed, type OpcionesClienteFalso } from "./cliente-falso";
import type { ClienteSat } from "./tipos";

/**
 * Devuelve el cliente que corresponde según SAT_MODO. Hoy solo existe `falso`; cuando exista el
 * real, este es el único lugar que cambia. Los datos del cliente falso los pasa quien llama
 * (apps/trabajos los lee de handoff/datos/seed.json) para no acoplar este paquete a una ruta.
 */
export function crearClienteSat(opciones: {
  modo: string;
  datosSeed?: DatosSeed;
  opcionesFalso?: OpcionesClienteFalso;
}): ClienteSat {
  if (opciones.modo === "real") {
    throw new Error("El cliente real del SAT todavía no existe (paso 7 lo deja como falso).");
  }
  if (!opciones.datosSeed) {
    throw new Error("El cliente falso del SAT necesita los datos del seed.");
  }
  return new ClienteSatFalso(opciones.datosSeed, opciones.opcionesFalso);
}
