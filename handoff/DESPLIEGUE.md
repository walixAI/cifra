# Despliegue — Cifra

Paso 6 de `PRIMEROS-PASOS.md`.

- **CI (GitHub Actions):** ya está en el repo y corre en cada PR. ✅
- **Bloquear el merge cuando CI falla:** necesita GitHub Pro o repo público (§1). ⚠️
- **Vercel y Neon:** hay que conectarlos desde sus paneles con tu cuenta — pasos de una sola
  vez (§2–3). ⚠️

---

## 1 · CI — ya está

`.github/workflows/ci.yml` corre en cada PR y en cada push a `main`, en dos compuertas:

| Job | Qué corre |
|---|---|
| `estatico-y-motor` | `pnpm typecheck` · `pnpm lint` · `pnpm build` · pruebas de `packages/core` |
| `aislamiento` | la prueba de aislamiento entre organizaciones del paso 2 (`packages/db`, Postgres embebido) y las de `apps/trabajos` del paso 7 (SAT falso, candado por RFC, barrido de validez §3.4) |

### Bloquear el merge si CI falla — necesita GitHub Pro (o repo público)

La protección de rama y los rulesets **no están disponibles en repos privados del plan
gratuito** de GitHub: la API responde `403 "Upgrade to GitHub Pro or make this repository
public"`. Hay dos caminos:

- **GitHub Pro** (~$4/mes): desbloquea la protección de rama en privado. Con eso, y con el
  workflow ya corrido al menos una vez:
  ```bash
  gh api -X PUT repos/walixAI/cifra/branches/main/protection --input - <<'JSON'
  {
    "required_status_checks": {
      "strict": true,
      "checks": [
        { "context": "typecheck · lint · build · pruebas del motor" },
        { "context": "aislamiento (RLS) · trabajos del SAT" }
      ]
    },
    "enforce_admins": false,
    "required_pull_request_reviews": null,
    "restrictions": null
  }
  JSON
  ```
  (`strict: true` = el PR tiene que estar al día con `main` antes de mezclar.) O hacerlo desde
  la UI: *Settings → Branches → Add branch ruleset*, `main`, *Require status checks to pass*,
  y elegir los dos checks.

- **Hacer el repo público**: `gh repo edit walixAI/cifra --visibility public`. Entonces todo lo
  de arriba funciona sin pagar. (El paso 1 pidió repo privado, así que esta es una decisión
  tuya.)

Mientras tanto, CI **sí corre en cada PR** y se ve rojo/verde; lo único que falta es el bloqueo
automático del botón de merge.

---

## 2 · Neon

1. Crea el proyecto en [console.neon.tech](https://console.neon.tech). Región cercana a la de
   Vercel (p. ej. `aws-us-east-1`).
2. En el proyecto, **Settings → Branching** deja activado *"Create branch for each preview"* —
   eso es lo que da una rama de base de datos por PR.
3. Copia las dos cadenas de **Connection Details**:
   - la que trae `-pooler` en el host → `DATABASE_URL`
   - la directa (sin `-pooler`) → `DIRECT_URL`
4. Crea el rol de aplicación (ver `packages/db/README.md`): desde el SQL Editor,
   ```sql
   CREATE ROLE cifra_app LOGIN PASSWORD '<algo largo y al azar>';
   ```
   y arma una tercera cadena con `cifra_app` en vez del rol dueño — esa es la `DATABASE_URL`
   que usa `apps/web` en runtime. Las migraciones (`prisma migrate deploy`) usan la del dueño.
5. Aplica la migración inicial:
   ```bash
   DATABASE_URL='<cadena directa del dueño>' DIRECT_URL='<la misma>' \
     pnpm --filter @cifra/db prisma:migrate:deploy
   ```

---

## 3 · Vercel

1. **New Project** → importa `walixAI/cifra`.
2. **Root Directory:** `apps/web`. Vercel detecta pnpm workspaces solo; deja el resto en
   automático (framework: Next.js).
3. **Integrations → Neon:** instala la integración de Neon y enlázala al proyecto. Con eso
   Vercel inyecta `DATABASE_URL` y `DIRECT_URL` de la rama de Neon que corresponda a cada
   deployment (una rama efímera por preview, la principal para producción).
4. **Environment Variables** — de `.env.example`, en los tres entornos (Production / Preview /
   Development):

   | Variable | Production | Preview | Development |
   |---|---|---|---|
   | `DATABASE_URL`, `DIRECT_URL` | *las inyecta la integración de Neon* | ídem | Postgres local (`pnpm db:dev`) |
   | `AUTH_SECRET` | `openssl rand -base64 32` (una por entorno) | ídem | ídem |
   | `AUTH_URL` / `NEXT_PUBLIC_APP_URL` | el dominio de producción | `https://$VERCEL_URL` | `http://localhost:3000` |
   | `EMAIL_SERVER`, `EMAIL_FROM` | Resend real | Resend real o de prueba | de prueba |
   | `CREDENCIALES_LLAVE_MAESTRA` | 32 bytes base64 (KMS en el futuro) | otra distinta | otra distinta |
   | `SAT_MODO`, `BANCOS_MODO` | `falso` hasta el paso 7 | `falso` | `falso` |
   | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | de Inngest (paso 7) | — | — |
   | `BLOB_READ_WRITE_TOKEN` | de Vercel Blob | de Vercel Blob | opcional |
   | `ANTHROPIC_API_KEY`, `IA_MODELO`, `IA_EXIGIR_CITACIONES` | reales (paso 11) | — | — |
   | `SENTRY_DSN`, `AXIOM_TOKEN`, `AXIOM_DATASET` | reales | opcional | — |
   | `TZ` | `America/Mexico_City` | ídem | ídem |

5. El build de Vercel es `next build` normal, a `.next`. (`pnpm build:verificar` de la raíz
   escribe en `.next-verificar` — eso es solo para verificar el build en local sin pisar el
   `.next` de un `pnpm dev` que esté corriendo; Vercel y CI no lo usan.)

---

## 4 · Inngest y el worker de trabajos (`apps/trabajos`)

`apps/trabajos` es un servicio aparte de `apps/web`: un servidor Hono que expone las funciones
de Inngest en `/api/inngest` y nada más. Corre los tres trabajos del SAT (`sat-sincronizar`
cada 6 h, `sat-validez` diario, `sat-constancia` semanal), cada uno como cron → abanico →
función por contribuyente, con la concurrencia limitada a 1 por RFC.

**Es el único proceso que descifra la CIEC y habla con el SAT.** `apps/web` nunca lo hace
(regla de `CLAUDE.md`). Por eso `CREDENCIALES_LLAVE_MAESTRA` y las llaves de Inngest viven
aquí, no en el web.

### 4.1 · Inngest Cloud (una vez)

1. Crea la app en [app.inngest.com](https://app.inngest.com). El `id` del cliente es
   `cifra-trabajos` (ver `apps/trabajos/src/inngest/cliente.ts`).
2. De **Settings → Keys** copia:
   - **Event Key** → `INNGEST_EVENT_KEY`
   - **Signing Key** → `INNGEST_SIGNING_KEY`
3. Cuando el worker esté desplegado, en **Apps → Sync** apunta a
   `https://<host-del-worker>/api/inngest`. Inngest lee las funciones y programa los crones
   solo — no hay que crear los schedules a mano.

### 4.2 · Dónde corre el worker

No en Vercel (los crones de Inngest necesitan un endpoint estable y el worker no es
serverless-friendly con el Postgres bajo RLS). Opciones:

- **Railway / Render / Fly**: un servicio Node, comando `pnpm --filter @cifra/trabajos start`
  (levanta `tsx src/servidor.ts` en el puerto `PUERTO_TRABAJOS`, default 3100). Raíz del repo,
  no `apps/trabajos` — pnpm necesita el workspace completo.
- Variables que necesita: `DATABASE_URL` / `DIRECT_URL` (la cadena de `cifra_app`, la misma
  con RLS que usa el web — el worker se conecta con ese rol a propósito), `SAT_MODO`
  (`falso` hasta tener acceso real al SAT), `CREDENCIALES_LLAVE_MAESTRA` (la **misma** que el
  web: el web cifra la CIEC al guardarla, el worker la descifra), `INNGEST_EVENT_KEY`,
  `INNGEST_SIGNING_KEY`, `TZ=America/Mexico_City`.

### 4.3 · Migraciones

El worker usa el mismo esquema que el web. El paso 7 no agrega migraciones: `sincronizacion_rfc`
(con los campos del candado) y `sincronizacion_sat` ya venían en la migración `plataforma` del
paso 2. `prisma migrate deploy` de §2 es todo lo que hace falta.

### 4.4 · Qué pasa si un worker muere a media sincronización

El candado por RFC (`SincronizacionRfc`) es un arrendamiento de **15 minutos que se renueva en
cada paso durable** de la bajada (`candado-rfc.ts`). Un worker vivo pero lento no lo pierde
—sigue renovando—; un worker muerto deja de renovar y el arrendamiento vence solo en ≤ 15 min,
sin intervención. Quien lo recupera es la siguiente corrida de ese RFC (el fan-out del cron de
6 h, o un reintento). La bajada es idempotente (upsert por `(contribuyente_id, uuid)`, el
`cursor` solo avanza al terminar bien), así que recuperar no duplica nada.

Dos detalles que importan en operación:

- El `worker_id` lleva el número de intento (`${runId}#${intento}`), no solo el `runId`. Un
  reintento de la misma corrida reconoce el arrendamiento que dejó el intento anterior como
  **huérfano**, lo registra como incidente (`console.error` + callback) y lo retoma; no se
  queda bloqueado 15 min contra sí mismo.
- Si un worker pierde el arrendamiento a media corrida (otro lo recuperó tras el TTL), la
  renovación siguiente lanza `ArrendamientoPerdido` y la corrida aborta para que Inngest la
  reintente — nunca se pisa al worker que ya tomó el candado.

### 4.5 · Fronteras

- `apps/trabajos` es un **despliegue separado** de `apps/web` y el **único lugar donde se
  descifra la CIEC**.
- **No se importa nada de `apps/web` en `apps/trabajos`, ni al revés.** Lo que compartan vive
  en un `packages/*` (`core`, `db`, `sat`, `cfdi`).
- **El cliente del SAT (`packages/sat`) no se exporta hacia `apps/web` en ninguna forma** —
  `apps/web` no lo lista como dependencia y no lo importa ni transitivamente.
- Todavía **no hay UI para capturar la CIEC**, así que el cliente falso **no la exige**. El
  punto de descifrado (`usarCiec` en `apps/trabajos/src/credenciales.ts`) ya está escrito con
  su forma final —autorización verificada contra `AutorizacionCredencial`, descifrado de
  sobre, renglón en `Bitácora`— pero tolera que aún no exista `CredencialFiscal` y entrega una
  CIEC vacía. Un `TODO` en ese archivo apunta a la §7 del documento de inquilinos: cuando
  exista la captura, la ausencia de credencial vuelve a ser un error duro.

---

## 5 · Verificación

Abre un PR de prueba (`git checkout -b prueba-despliegue`, un cambio trivial, `gh pr create`).
Debe aparecer:

- Los dos checks de **CI** en el PR, verdes.
- Un **preview de Vercel** con su URL.
- En Neon, una **rama nueva** con el nombre del preview.

Si CI pasa pero no ves Vercel/Neon, es que faltan los pasos 2–3 (la integración no está
conectada todavía).
