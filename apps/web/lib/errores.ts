export class NoAutenticado extends Error {
  constructor() {
    super("No autenticado");
    this.name = "NoAutenticado";
  }
}

/**
 * Se traduce a 404, nunca a 403: no confirmamos que el contribuyente exista si el usuario no
 * tiene Acceso. Ver ARQUITECTURA-MULTIINQUILINO.md §5.
 */
export class SinAcceso extends Error {
  readonly status = 404;
  constructor() {
    super("No encontrado");
    this.name = "SinAcceso";
  }
}
