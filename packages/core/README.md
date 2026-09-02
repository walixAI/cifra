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

## Los números de ISR del fixture eran ficticios — se recalcularon

La columna ISR de la tabla original de §3.7 (`11,880 / 12,940 / 13,410 / 14,320` para
mayo–agosto) **nunca salió de aplicar una tarifa real a la base**. Estaba escrita a mano para que
las pantallas del prototipo se vieran plausibles.

Se recalcularon todas con la tarifa 2026 real (Anexo 8 de la RMF, DOF 28-dic-2025) y la fórmula
completa del artículo 106:

```
ISR del periodo = tarifa_art_96(base acumulada, meses)
                − pagos provisionales anteriores
                − ISR retenido 10% por clientes personas morales (acumulado)
```

La tercera resta faltaba en la primera versión de §3.2 del README; se corrigió el README, el
motor tiene razón. `impuestos/isr.ts` recibe la retención como parámetro (`calcularIsr`).

Para agosto: base `$812,340.00` → tarifa ×8 meses `$193,590.66` − pagos previos reales
`$162,771.95` − retención `$4,275.00` = **`$26,543.71`**. La reconstrucción completa de la tabla,
con el supuesto para los meses que el fixture no desglosa (reparto por igual del par
abril/mayo y junio/julio, que no toca ningún invariante), está en
`__tests__/regresion-3-7.test.ts`.

**Los números de IVA no se tocaron:** son aritmética pura sobre cifras dadas, no dependen de
ninguna tarifa, y ya cuadraban — agosto `$8,420.00`, con el aviso de los `$301` del CFDI
cancelado que corrige a `$8,721.00`.

`tarifas/2026.json` versiona la tabla mensual del Anexo 8 con su fuente citada adentro (regla 4
de `CLAUDE.md`: nunca constantes en código). El día que cambie el ejercicio se agrega
`tarifas/2027.json`; `calcularIsr` lanza `TarifaNoDisponibleError` si le piden un año sin tabla.
