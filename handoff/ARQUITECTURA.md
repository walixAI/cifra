# Arquitectura recomendada — Cifra

Decisiones tomadas, con su porqué y su alternativa. Están pensadas para **una persona
construyendo con Claude Code**: pocas piezas, todo desplegable desde GitHub, nada que administrar
a mano.

---

## 1 · La decisión que manda sobre todas las demás

**Bajar CFDI del SAT no cabe en una función serverless.** Es un trabajo largo (la primera
sincronización son ~3 años de comprobantes), con estado, que falla seguido y hay que reintentar.
Vercel corta a los 300s. Si metes eso en un route handler, el producto se rompe el primer día.

Por eso la arquitectura se parte en dos desde el inicio:

```
┌─────────────────┐        ┌──────────────────┐
│  apps/web       │        │  trabajos        │
│  Next.js        │◄──────►│  (Inngest)       │
│  UI + API       │        │  SAT · bancos    │
│  Vercel         │        │  validez · reportes│
└────────┬────────┘        └─────────┬────────┘
         │                           │
         └────────► Postgres ◄───────┘
                    (Neon)
                        │
                  Blob (XML/PDF/acuses)
```

Y una regla más: **el motor de impuestos no vive en las rutas.** Va en `packages/core`, puro, sin
red ni base de datos, con la tabla de §3.7 del README como suite de pruebas. Es lo único del
sistema donde un error cuesta dinero real al usuario.

---

## 2 · Stack

| Pieza | Elección | Por qué | Alternativa razonable |
|---|---|---|---|
| Framework | **Next.js 15, App Router, TypeScript** | Un solo repo para UI y API; Server Components le van bien a pantallas que son 90% lectura de datos | Remix; o Vite + API aparte si prefieres separar |
| Base de datos | **Postgres en Neon** | Serverless, y **una rama de base de datos por Pull Request** — se empareja con los previews de Vercel, así puedes probar migraciones sin miedo | Supabase (si quieres auth y storage incluidos); RDS si algún día hay equipo de infra |
| ORM | **Prisma** | El esquema es un archivo legible; Claude Code trabaja muy bien con él y las migraciones quedan versionadas | Drizzle (más liviano y más rápido en serverless, menos legible) |
| Trabajos y cron | **Inngest** | Funciona *sobre* Vercel sin servidor aparte, con pasos durables, reintentos y concurrencia por usuario. Resuelve el problema de §1 sin agregar infraestructura | `pg-boss` en la misma Postgres + un worker en Fly.io (más barato, más que mantener) |
| Auth | **Auth.js v5**, magic link por correo | Sin contraseñas que cuidar; se conecta directo al modelo `Acceso` para los roles (contador / captura / solo lectura) | Clerk (más rápido de montar, cuesta y te ata) |
| Archivos | **Vercel Blob** | XML, PDF y acuses; cero configuración | Cloudflare R2 (más barato al crecer) |
| UI | **Tailwind + shadcn/ui**, tokens en `tokens.css` | Los tokens del prototipo entran como CSS custom properties y el modo noche es un `data-theme` en `<html>` | CSS Modules si Tailwind no te gusta |
| Errores y logs | **Sentry** + **Axiom** | Los fallos del SAT hay que poder auditarlos por RFC y por fecha | |
| CI | **GitHub Actions** | typecheck, lint, y las pruebas del motor fiscal en cada PR | |

---

## 3 · Estructura del repositorio

Monorepo con **pnpm workspaces** (Turborepo si el build se hace lento).

```
cifra/
├─ apps/
│  ├─ web/                    Next.js — UI + rutas API
│  │  ├─ app/
│  │  │  ├─ (app)/            pantallas autenticadas
│  │  │  │  ├─ page.tsx                  Inicio
│  │  │  │  ├─ ingresos/ gastos/ cfdi/ bancos/
│  │  │  │  ├─ contabilidad/ impuestos/ estados/
│  │  │  │  ├─ ia/ calendario/ reportes/ fiscal/ configuracion/
│  │  │  ├─ (onboarding)/     los 4 pasos
│  │  │  └─ api/
│  │  └─ components/
│  └─ trabajos/               funciones Inngest
│     ├─ sat-sincronizar.ts       primera bajada + cada 6 h
│     ├─ sat-validez.ts           barrido de UUID cancelados  ← §3.4 del README
│     ├─ sat-constancia.ts
│     ├─ bancos-sincronizar.ts
│     ├─ polizas-generar.ts
│     └─ reportes-armar.ts
├─ packages/
│  ├─ db/                     esquema Prisma, cliente, migraciones, seed
│  ├─ core/                   ⭐ dominio puro, sin E/S
│  │  ├─ impuestos/               iva.ts, isr.ts, diot.ts, tarifas/2024.json 2025 2026
│  │  ├─ contabilidad/            poliza.ts, cuadre.ts, balanza.ts
│  │  ├─ validadores/             rfc.ts, email.ts, codigo.ts, ciec.ts
│  │  └─ __tests__/               las cifras de §3.7 como regresión
│  ├─ sat/                    cliente del SAT, aislado y mockeable
│  ├─ ia/                     enrutador de intenciones + citaciones
│  └─ ui/                     tokens.css + primitivas
├─ design_handoff_cifra/      este paquete
├─ CLAUDE.md                  contexto permanente para Claude Code
└─ .github/workflows/ci.yml
```

**Por qué `packages/core` separado:** el motor fiscal se prueba sin base de datos, sin red y sin
Next. Le puedes correr la tabla de agosto en milisegundos y saber que no se rompió nada. Si vive
dentro de un route handler, no se prueba nunca.

**Por qué `packages/sat` separado:** el SAT es el componente más frágil del sistema. Aislado,
puedes falsearlo completo en desarrollo y en CI.

---

## 4 · Secretos: la CIEC y la e.firma

Esto merece párrafo propio porque es lo único aquí que puede arruinarle la vida a un usuario.

La **CIEC** da acceso de lectura a toda la información fiscal de una persona. La **e.firma**
permite *firmar como esa persona ante el SAT*: presentar declaraciones, y también dar de alta
obligaciones. No son "credenciales de una integración", son la identidad fiscal del usuario.

Reglas mínimas:

1. **Cifrado con sobre.** Una llave de datos por registro, envuelta por una llave maestra en
   KMS (AWS KMS, GCP KMS o Infisical). Para el v0, `libsodium` sealed box con la llave maestra en
   variable de entorno es aceptable — pero deja el camino a KMS abierto desde el esquema.
2. **Se descifra únicamente dentro del worker**, en memoria, para una operación concreta. Nunca
   en `apps/web`, nunca en un Server Component, nunca en un log, nunca en Sentry.
3. **Nunca en un `SELECT *`.** Columnas aparte, o tabla aparte con acceso restringido.
4. **Revocable.** El usuario puede retirarla y el prototipo se lo promete explícitamente. Retirar
   debe borrar el material, no marcar un booleano.
5. **Auditoría.** Cada uso deja registro: qué worker, qué operación, cuándo. Si algún día hay una
   pregunta, tiene que haber respuesta.
6. **La e.firma nunca firma sola.** Autorización explícita del usuario por cada presentación.

---

## 5 · Despliegue

```
GitHub  ──push──►  Vercel  (apps/web)         producción + un preview por PR
        ──push──►  Inngest (apps/trabajos)     sincronizado con el deploy
                   Neon                        rama de BD por preview
```

**Entornos:** `production`, `preview` (efímero por PR, con rama de Neon y datos semilla), `local`
(Postgres en Docker + SAT falseado).

**Migraciones:** `prisma migrate` en CI, y en el PR se corre contra la rama de Neon antes de
mezclar. Nunca `db push` en producción.

**Datos semilla:** `datos/seed.json` de este paquete carga el contribuyente ficticio completo —
las mismas cifras del prototipo. Sirve para desarrollo, para los previews y para las pruebas.

---

## 6 · Del prototipo al frontend real

El prototipo es un archivo con la lógica adentro. La extracción tiene un orden que evita
rehacer trabajo:

1. **Tokens primero.** `frontend/tokens.css` de este paquete entra como está. El modo noche ya
   funciona: `document.documentElement.dataset.theme = 'night'`.
2. **El armazón.** Sidebar colapsable, barra superior (chat de IA, búsqueda `⌘K`,
   notificaciones, tema, avatar) y el encabezado de pantalla. Es lo único compartido por las 12
   pantallas.
3. **Una pantalla vertical completa**, de la UI al motor: **Impuestos**. Toca el modelo, el motor
   fiscal, el cuadre y la voz de la IA. Cuando esa funciona de punta a punta, las otras once son
   variaciones.
4. **Las demás pantallas**, contra endpoints reales.
5. **Los tres estados de cada pantalla** (normal / primer uso / sin conexión). No los dejes para
   el final: el contrato de datos rancios de §7 del README cambia la forma de los endpoints.

Lo que **no** hay que portar del prototipo: los `setTimeout` que finjen red, los datos en
`static`, y `support.js`.

---

## 7 · Errores que este diseño trata de evitar

- **Meter el SAT en una función serverless.** Se rompe en la primera sincronización real.
- **Calcular IVA por lo devengado.** En México es por flujo de efectivo: hasta que se cobra o se
  paga. Si te equivocas aquí, todas las cifras del producto están mal y el usuario paga de más o
  de menos.
- **Tratar la cancelación de CFDI como un caso raro.** Es el caso que le da valor al producto
  (§3.4 del README) y necesita un barrido periódico, no una validación al importar.
- **Tarifas de ISR como constantes en código.** Cambian cada año y se indexan por inflación.
  Datos versionados por ejercicio, siempre.
- **Fallar en blanco cuando el SAT no responde.** Sirve caché con metadatos de antigüedad. El
  usuario prefiere sus cifras de ayer con una advertencia honesta que una pantalla de error.
- **Que la IA responda sin citar.** Una respuesta sin origen es un defecto, no una respuesta.
