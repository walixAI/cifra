import * as constancia from "./funciones/sat-constancia";
import * as sincronizar from "./funciones/sat-sincronizar";
import * as validez from "./funciones/sat-validez";

/** Todas las funciones de Inngest que sirve apps/trabajos. */
export const funciones = [
  sincronizar.cronSincronizar,
  sincronizar.abanicoSincronizar,
  sincronizar.sincronizarUno,
  validez.cronValidez,
  validez.abanicoValidez,
  validez.validezUno,
  constancia.cronConstancia,
  constancia.abanicoConstancia,
  constancia.constanciaUno,
];
