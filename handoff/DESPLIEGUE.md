# Despliegue — Cifra

Paso 6 de `PRIMEROS-PASOS.md`. La parte de CI (GitHub Actions) ya está en el repo y funciona.
Vercel y Neon hay que conectarlos desde sus paneles con tu cuenta — son pasos de una sola vez.

---

## 1 · CI — ya está

`.github/workflows/ci.yml` corre en cada PR y en cada push a `main`, en dos compuertas:

| Job | Qué corre |
|---|---|
| `estatico-y-motor` | `pnpm typecheck` · `pnpm lint` · `pnpm build` · pruebas de `packages/core` |
| `aislamiento` | la prueba de aislamiento entre organizaciones del paso 2 (`packages/db`, Postgres embebido) |

Para que **ningún PR se pueda mezclar si algo falla**, hay que exigir estos checks en la
protección de rama. Una vez que el workflow haya corrido al menos una vez (para que GitHub
conozca los nombres de los checks):

```bash
gh api -X PUT repos/walixAI/cifra/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "typecheck · lint · build · pruebas del motor" },
      { "context": "prueba de aislamiento (RLS)" }
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```

(`strict: true` = el PR tiene que estar al día con `main` antes de mezclar.)

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

## 4 · Verificación

Abre un PR de prueba (`git checkout -b prueba-despliegue`, un cambio trivial, `gh pr create`).
Debe aparecer:

- Los dos checks de **CI** en el PR, verdes.
- Un **preview de Vercel** con su URL.
- En Neon, una **rama nueva** con el nombre del preview.

Si CI pasa pero no ves Vercel/Neon, es que faltan los pasos 2–3 (la integración no está
conectada todavía).
