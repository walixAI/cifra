# @cifra/db

Esquema de plataforma (inquilinos, identidad, acceso), aislamiento por fila con RLS, cliente
con alcance, y las migraciones. Ver `handoff/ARQUITECTURA-MULTIINQUILINO.md`.

```
prisma/schema.prisma          plataforma (tenancy.prisma) + entidades fiscales (paso 3)
prisma/migrations/            _plataforma y _fiscal: tablas + rls.sql, cada una en su propia migración
scripts/generar-migracion.mjs autoría de migraciones nuevas sin Neon ni Docker (ver abajo)
src/cliente.ts                singleton sin alcance — solo plataforma, nunca datos con dinero
src/alcance.ts                prismaPara(contribuyenteId) — el cliente que sí deben usar los handlers
src/generated/client/         cliente de Prisma generado (gitignored, `pnpm prisma:generate`)
test/aislamiento.test.ts      la prueba que decide si el resto está construido sobre arena
test/pg-embebido.ts           Postgres real embebido para esa prueba — sin Docker, sin Neon
```

## Desarrollo local: sin base de datos que instalar

`pnpm --filter @cifra/db test` levanta un Postgres real (binario embebido, se borra al
terminar), corre la migración exactamente como correría `prisma migrate deploy` contra Neon
—tablas, rol `cifra_app`, políticas de `rls.sql`— y prueba el aislamiento conectada **como
`cifra_app`**: no es dueña de las tablas ni superusuario, así que si alguna fila se cuela, es la
política la que falló, no el test. No necesita `.env` ni Neon.

## Conectar a Neon

1. **Crea el proyecto** en [neon.tech](https://console.neon.tech) (o `neonctl projects create`
   si usas su CLI). Región cercana a donde vaya a vivir Vercel.
2. **Copia las dos cadenas** desde el dashboard del proyecto → *Connection Details*:
   - la que trae `-pooler` en el host → `DATABASE_URL` (la usa la app, vía PgBouncer)
   - la directa (sin `-pooler`) → `DIRECT_URL` (la usan las migraciones)

   Pégalas en `packages/db/.env` (copia `.env.example`) **y** en `.env` de la raíz — Prisma CLI
   lee el de `packages/db/`, `apps/web` en runtime lee el de la raíz.
3. **Crea el rol de aplicación.** `rls.sql` intenta `CREATE ROLE cifra_app` con el dueño de las
   tablas (`neondb_owner`, que sí tiene `CREATEROLE` en Neon), así que normalmente no hay que
   hacer nada aparte. Si Neon lo rechaza, créalo a mano desde el SQL Editor del dashboard:
   ```sql
   CREATE ROLE cifra_app LOGIN PASSWORD '<algo largo y al azar>';
   ```
   y arma una tercera cadena, `DATABASE_URL` **de la aplicación**, con `cifra_app` en vez del
   rol dueño — esa es la que de verdad debe usar `apps/web` en producción, nunca la del owner.
4. **Aplica la migración:**
   ```bash
   pnpm --filter @cifra/db prisma:migrate:deploy
   ```
   Esto corre `prisma/migrations/*_plataforma/migration.sql` completo, incluida la sección de
   `rls.sql` — no hay paso manual de RLS por separado.
5. **Verifica el aislamiento a mano** (opcional, la prueba automática ya lo cubre con Postgres
   embebido): desde el SQL Editor de Neon,
   ```sql
   SET ROLE cifra_app;
   SELECT set_config('app.contribuyente_id', '<uuid-de-un-contribuyente>', false);
   SELECT count(*) FROM resumen_contribuyente;   -- solo los suyos
   SELECT set_config('app.contribuyente_id', '', false);
   SELECT count(*) FROM resumen_contribuyente;   -- 0
   RESET ROLE;
   ```

## Generar una migración nueva sin Neon ni Docker

```bash
pnpm --filter @cifra/db prisma:migrate:generar <nombre>
```

Levanta el mismo Postgres embebido de las pruebas, aplica las migraciones que ya existen
(`prisma migrate deploy`, tal cual correría en producción) y difiere el `schema.prisma` actual
contra ese estado (`prisma migrate dev --create-only`). El `migration.sql` que resulta hay que
revisarlo a mano — y **si toca alguna tabla con `contribuyente_id` no nulo nueva, hay que
pegarle otra vez el cuerpo de `handoff/backend/rls.sql` al final**. Es idempotente (solo toca
las tablas que aún no tienen la política), no se hace solo, y no es opcional: así se generaron
las dos migraciones que ya existen (`_plataforma` y `_fiscal`).

## Entidades fiscales (paso 3) — dos decisiones que vale la pena tener presentes

- **`Cfdi.uuid` es único por `(contribuyente_id, uuid)`, no globalmente.** El mismo UUID puede
  vivir en dos libros a la vez si el emisor y el receptor son ambos contribuyentes de Cifra.
- **El dinero que alimenta el motor fiscal nunca vive en un `Json`.** `Cfdi.impuestos` (lo que
  packages/core/impuestos va a sumar para IVA/ISR) se normalizó a `CfdiImpuesto`, con
  `importe_centavos BigInt` real. `conceptos` y `Declaracion.calculo` se quedan en `Json` a
  propósito —detalle de despliegue y snapshot de auditoría, no fuente de verdad para sumar— pero
  cualquier importe que se guarde ahí es centavos enteros como string, nunca `number` flotante.
