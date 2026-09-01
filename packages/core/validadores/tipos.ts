// Tipo compartido por todos los validadores de packages/core/validadores. Mismo contrato que
// usa el prototipo (Cifra v2.dc.html, static valida*): { ok, msg } — aquí, { ok, mensaje }.
export interface ResultadoValidacion {
  ok: boolean;
  mensaje: string;
}
