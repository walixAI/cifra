// `JSON.stringify` no sabe serializar BigInt, y el dinero de todo el sistema viaja en centavos
// como BigInt (regla de CLAUDE.md). Los endpoints lo mandan como string — "84200", nunca un
// number — para que el cliente no tenga que adivinar si perdió precisión.

export function respuestaJsonConBigInt(datos: unknown, init?: ResponseInit): Response {
  const cuerpo = JSON.stringify(datos, (_clave, valor) =>
    typeof valor === "bigint" ? valor.toString() : valor,
  );
  return new Response(cuerpo, {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...init?.headers },
  });
}
