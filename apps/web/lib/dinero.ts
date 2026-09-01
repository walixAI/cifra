// Dinero en centavos enteros (BigInt) en todo el sistema; se formatea aquí, en la orilla —
// regla de CLAUDE.md. Nada de lo que hay arriba (packages/core, packages/db, las rutas) debe
// convertir a string con signo de pesos: eso es trabajo de esta función y de nadie más.

function conSeparadoresDeMiles(digitos: string): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "$8,420.00" — con centavos, para desgloses y tablas. */
export function formatearPesos(centavos: bigint): string {
  const negativo = centavos < 0n;
  const abs = negativo ? -centavos : centavos;
  const enteros = conSeparadoresDeMiles((abs / 100n).toString());
  const decimales = (abs % 100n).toString().padStart(2, "0");
  return `${negativo ? "-" : ""}$${enteros}.${decimales}`;
}

/** "$22,740" — redondeado a peso entero, para las cifras grandes del encabezado. */
export function formatearPesosRedondo(centavos: bigint): string {
  const negativo = centavos < 0n;
  const abs = negativo ? -centavos : centavos;
  const redondeado = (abs + 50n) / 100n;
  return `${negativo ? "-" : ""}$${conSeparadoresDeMiles(redondeado.toString())}`;
}

/** "+6.9%" / "−4.8%" — para los deltas del histórico. null cuando no hay periodo previo. */
export function formatearDelta(porcentaje: number | null): string {
  if (porcentaje === null) return "—";
  const signo = porcentaje > 0 ? "+" : porcentaje < 0 ? "−" : "";
  return `${signo}${Math.abs(porcentaje).toFixed(1)}%`;
}
