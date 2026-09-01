// PLACEHOLDER — se reemplaza en el paso 8 de PRIMEROS-PASOS.md con Auth.js v5 (magic link).
// Existe ya para que contexto() (paso 2) tenga una fuente de sesión real que reemplazar, en vez
// de inventarle una interfaz nueva más adelante. Hoy no hay tráfico real que dependa de esto.

export interface Sesion {
  usuario: { id: string; email: string };
}

export async function auth(): Promise<Sesion | null> {
  return null;
}
