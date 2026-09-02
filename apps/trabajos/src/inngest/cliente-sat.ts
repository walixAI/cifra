// El cliente del SAT que usan las funciones. Un singleton por proceso; en `falso` lee del seed.

import { crearClienteSat, type ClienteSat } from "@cifra/sat";
import { SAT_MODO, datosSeed } from "../entorno";

let cache: ClienteSat | null = null;

export function clienteSat(): ClienteSat {
  if (cache) return cache;
  cache = crearClienteSat({
    modo: SAT_MODO,
    datosSeed: SAT_MODO === "falso" ? datosSeed() : undefined,
  });
  return cache;
}
