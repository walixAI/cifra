# @cifra/core

El motor fiscal. Puro: sin red, sin base de datos, sin saber qué es un inquilino (regla 5 de
`CLAUDE.md`). Todo lo de aquí son funciones que reciben datos y devuelven cifras en centavos
(`bigint`), nunca `float`.

```
validadores/     rfc.ts, email.ts, codigo.ts, ciec.ts — sección 5 del README, mensajes exactos
impuestos/       iva.ts (§3.1), isr.ts (§3.2), tarifas/2026.json
contabilidad/    cuadre.ts (§3.5), poliza.ts (generación + partida doble)
__tests__/       una prueba por fila de cada tabla del §5, y la regresión de la §3.7
```

## ⚠️ El ISR de agosto de la sección 3.7 no es reproducible con la tarifa real de 2026

Esto hay que leerlo antes de confiar en la tabla del README como si fuera la salida esperada de
`impuestos/isr.ts`.

La sección 3.7 dice que agosto da `ISR = 14,320`. Verifiqué la tarifa 2026 real (Anexo 8 de la
RMF 2026, DOF 28 de diciembre de 2025 — dos fuentes independientes coinciden) y la apliqué a la
base que el propio README da para agosto (`calculoIsrAgosto` en `handoff/datos/seed.json`:
ingresos acumulados $1,286,640, deducciones acumuladas $474,300 → base $812,340, que sí coincide
con la tabla). El resultado real es **ISR del periodo = $75,430.66**, no $14,320.

La diferencia es grande (~$61,000) y no es un error de redondeo: los $14,320 del prototipo nunca
salieron de aplicarle la tarifa 2026 real a esa base. Son una cifra ilustrativa que quien armó el
prototipo escribió a mano para que la pantalla se viera bien — no hay forma de que ambas cosas
sean ciertas a la vez.

**Decisión que tomé:** `impuestos/isr.ts` implementa la fórmula y la tarifa reales, correctamente
sourceadas y versionadas (`tarifas/2026.json`, con la fuente citada adentro). Las pruebas afirman
lo que la tarifa real de verdad da, no los $14,320 del fixture — ver el comentario en
`__tests__/isr.test.ts` y `__tests__/regresion-3-7.test.ts`. El IVA sí reproduce el fixture
exacto (es aritmética pura sobre cifras dadas, no depende de ninguna tarifa) y es lo que pide la
verificación de este paso: `pnpm test` verde, agosto en `$8,420` de IVA con el aviso de los `$301`
del CFDI cancelado — ambos exactos.

Ship un motor que calcula ISR mal a propósito, solo para que coincida con un dato de maqueta,
sería exactamente lo que la regla 6 de `ARQUITECTURA.md` advierte que no hay que hacer
("calcular mal cuesta dinero real al usuario"). Si el criterio correcto fuera otro —por ejemplo,
que el fixture tiene prioridad y hay que ajustar la tarifa para que reconcilie— es una decisión
de producto que hay que tomar a propósito, no algo que se cuela en un commit.
