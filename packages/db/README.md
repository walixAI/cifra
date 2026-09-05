# @cifra/db

Esquema de plataforma (inquilinos, identidad, acceso), aislamiento por fila con RLS, cliente
con alcance, y las migraciones. Ver `handoff/ARQUITECTURA-MULTIINQUILINO.md`.

```
prisma/schema.prisma          plataforma (tenancy.prisma) + entidades fiscales (paso 3)
prisma/migrations/            _plataforma y _fiscal: tablas + rls.sql, cada una en su propia migración
prisma/seed.mjs                orquesta: base de datos, migraciones, y datos-seed.mjs
prisma/datos-seed.mjs         la carga real de handoff/datos/seed.json
scripts/db-local.mjs          Postgres local persistente sin Docker (usado por seed y studio)
scripts/generar-migracion.mjs autoría de migraciones nuevas sin Neon ni Docker (ver abajo)
scripts/studio.mjs            `pnpm db:studio`
src/cliente.ts                singleton sin alcance — solo plataforma, nunca datos con dinero
src/alcance.ts                prismaPara(contribuyenteId) — el cliente que sí deben usar los handlers
src/generated/client/         cliente de Prisma generado (gitignored, `pnpm prisma:generate`) —
                               ver nota de Vercel más abajo
test/aislamiento.test.ts      la prueba que decide si el resto está construido sobre arena
test/pg-embebido.ts           Postgres real embebido para esa prueba — sin Docker, sin Neon
```

## Desarrollo local: sin base de datos que instalar

`pnpm --filter @cifra/db test` levanta un Postgres real (binario embebido, se borra al
terminar), corre la migración exactamente como correría `prisma migrate deploy` contra Neon
—tablas, rol `cifra_app`, políticas de `rls.sql`— y prueba el aislamiento conectada **como
`cifra_app`**: no es dueña de las tablas ni superusuario, así que si alguna fila se cuela, es la
política la que falló, no el test. No necesita `.env` ni Neon.

## Sembrar datos: `pnpm db:seed` y `pnpm db:studio`

Tampoco necesitan `.env` ni Neon para empezar:

```bash
pnpm db:seed      # carga handoff/datos/seed.json
pnpm db:studio    # lo enseña
```

Si no hay `DATABASE_URL` en el entorno, ambos levantan un Postgres local **persistente** en
`packages/db/.pgdata` (gitignored) — mismo binario embebido que las pruebas, pero los datos se
quedan en disco entre corridas, como cualquier Postgres local. `db:seed` limpia y vuelve a
sembrar cada vez que corre (solo en este Postgres propio — nunca si `DATABASE_URL` ya apunta a
Neon: ahí el seed asume una base vacía y no borra nada por su cuenta).

En cuanto haya un `.env` con `DATABASE_URL` apuntando a Neon (ver abajo), los dos comandos lo
usan automáticamente y dejan en paz el Postgres local.

Lo que carga el seed, dentro de una organización `personal`:

- El contribuyente **TODA7606258I7** completo: constancia, 5 obligaciones, 14 cuentas del
  catálogo, 3 cuentas bancarias, sus 11 CFDI (8 recibidos + 3 emitidos — el fixture trae más de
  los "8" que menciona el paso 3 de `PRIMEROS-PASOS.md`; se cargó lo que hay en
  `seed.json`, no una cuenta redonda), sus 5 pólizas con asientos que cuadran
  (`SUM(debe) = SUM(haber)`, verificado), 8 movimientos bancarios por conciliar, notificaciones,
  y el histórico de declaraciones.
- El caso del CFDI cancelado después de contabilizado (§3.4 del README:
  `3B77…A20` → póliza `D-0142` → alerta) queda enlazado de punta a punta.

Y una organización `despacho` ("Despacho Aguilar y Asociados" — mismo nombre que ya aparece
como emisor de honorarios contables en los gastos de TODA, a propósito) con:

- Dos clientes propios, recién dados de alta, cada uno con su `Acceso` en estado `invitado` sin
  usuario todavía — nadie ha iniciado sesión como ellos.
- **El caso difícil de la §3**: TODA7606258I7 vinculado por un `Acceso` nuevo (rol `contador`,
  usuario Ana) sobre el **mismo** registro de `Contribuyente` — su `organizacion_id` sigue
  siendo el de la organización personal. Por diseño (§2 del documento de inquilinos, "un admin
  de despacho no hereda acceso a los libros"), Ana **no** tiene acceso automático a los otros
  dos clientes del despacho — solo a los que se le concedieron explícitamente.

## El cliente generado y Vercel: dos disparadores, no uno

Este paquete trae `"postinstall": "prisma generate --schema=./prisma/schema.prisma"` — se
regenera solo en cualquier `pnpm install` desde cero (clon nuevo, CI). No basta por sí solo en
Vercel: con caché tibia, `pnpm install` puede reportar `Already up to date` y saltarse por
completo los scripts de instalación aunque `src/generated/client/` (que vive fuera de
`node_modules`, y por lo tanto fuera de lo que ese caché conserva) ya no exista — pnpm decide
esto por el lockfile, no por lo que hay en disco. Pasó de verdad: un redeploy con caché
restaurada volvió a tronar con `Can't resolve './generated/client'` después de que un
`pnpm install` limpio ya lo había arreglado.

Por eso `apps/web` regenera el cliente también en su propio `build`
(`pnpm --filter @cifra/db run prisma:generate && next build`, ver `apps/web/package.json`) — no
porque el arreglo viva ahí, sino porque es el único paso que Vercel garantiza correr en cada
build, con o sin caché. Si `apps/trabajos` alguna vez se despliega detrás de un caché parecido,
necesita el mismo refuerzo en su propio arranque.

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
