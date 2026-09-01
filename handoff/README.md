# Handoff: Cifra — contabilidad inteligente para México

## Empieza aquí

| Archivo | Para qué |
|---|---|
| **`PRIMEROS-PASOS.md`** | La secuencia exacta con Claude Code: andamio, GitHub, Neon, Vercel. **Ábrelo primero.** |
| `ARQUITECTURA.md` | Stack recomendado, estructura del monorepo, despliegue, manejo de la CIEC y la e.firma |
| `CLAUDE.md` | Cópialo a la raíz del repo: es el contexto que Claude Code lee en cada sesión |
| **este archivo** | La especificación: dominio, reglas de negocio, validaciones, máquinas de estado, endpoints |
| `backend/schema.prisma` | Esquema de referencia, listo para revisar y migrar |
| `datos/seed.json` | El contribuyente ficticio completo, con las cifras cruzadas |
| `frontend/tokens.css` | Los tokens de diseño, tal cual, con los dos temas |
| `.env.example` | Variables de entorno de los tres entornos |
| `Cifra v2.dc.html` | El prototipo. Ábrelo en el navegador; no necesita servidor |

## Overview

Cifra is a web app for Mexican taxpayers (starting with *personas físicas con actividad
empresarial y profesional*) that answers four questions in under 30 seconds: how much did I
invoice, how much did I spend, what do I owe, and what taxes are due. It pulls CFDI from the
SAT, reads bank movements, generates double-entry bookkeeping automatically, estimates IVA and
ISR, and exposes an AI layer that answers questions with the user's own figures and always cites
where each number came from.

The prototype in this bundle covers **12 screens**, day/night modes, four modal flows, two
drill-down panels, and the empty/error variants of every screen.

## About the design files

`Cifra v2.dc.html` is a **design reference created in HTML** — a prototype showing intended look
and behavior. It is not production code to copy. All data in it is hardcoded fixtures and all
"integrations" are `setTimeout` fakes.

The task is to **build the real backend** behind these screens, and to recreate the UI in the
target codebase's environment (React, Next, Rails views, whatever exists) using its established
patterns. If no frontend environment exists yet, pick one and rebuild the screens there — do not
ship the prototype HTML.

Read this README as the **product spec**: the domain model, the business rules, the state
machines and the validation rules below are the contract. The visual layer is secondary and
recoverable from the prototype file itself.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, copy, interaction and animation timings.
Recreate the UI closely. The Spanish copy is deliberate — it is written for a taxpayer, not an
accountant, and it is part of the product. Do not paraphrase it.

---

# 1 · Domain model

Suggested entities. Names are Spanish because the domain is Spanish and the SAT's own field names
are Spanish; keep them.

### Contribuyente
The account owner.
- `rfc` (unique, 12–13 chars, uppercase)
- `nombre`, `nombre_completo`
- `tipo_persona` — `fisica` | `moral`
- `regimenes[]` — from the constancia, e.g. *Actividad empresarial y profesional*
- `ciec_encriptada` — SAT password, encrypted at rest, revocable by the user
- `efirma` — optional `.cer` + `.key` blobs, encrypted; only needed to **file** returns
- `plan` — e.g. `Negocio`

### Constancia
Snapshot of the *constancia de situación fiscal*, re-read periodically.
- `contribuyente_id`, `leida_en` (date), `raw` (PDF/XML source)
- `domicilio`, `regimenes[]`, `obligaciones[]`

### Obligacion
Derived from the constancia. Drives the Calendario fiscal screen.
- `clave`, `descripcion` — e.g. *Pago definitivo mensual de IVA*
- `periodicidad` — `mensual` | `bimestral` | `anual`
- `dia_limite` — e.g. 17, or `ultimo_dia_mes_siguiente`
- `vigente_desde`, `vigente_hasta`

### CFDI
The core record. One row per comprobante.
- `uuid` (unique), `tipo` — `ingreso` | `egreso` | `nomina` | `pago` | `traslado`
- `direccion` — `emitido` | `recibido`
- `emisor_rfc`, `emisor_nombre`, `receptor_rfc`, `receptor_nombre`
- `fecha_emision`, `fecha_timbrado`
- `subtotal`, `descuento`, `total`
- `impuestos_trasladados[]` / `impuestos_retenidos[]` — `{impuesto: 'IVA'|'ISR'|'IEPS', tasa, importe}`
- `uso_cfdi` — `G01`, `G03`, `I04`…
- `metodo_pago` — `PUE` | `PPD`
- `forma_pago`
- `conceptos[]`
- `estado_sat` — `vigente` | `cancelado`; plus `cancelado_en`, `motivo_cancelacion`
- `estado_interno` — `sin_clasificar` | `clasificado` | `revisar_deduccion`
- `cuenta_contable_id` — nullable; may be an AI suggestion pending confirmation
- `cuenta_sugerida_por_ia` (bool), `confianza_sugerencia`
- `xml` blob, `pdf` blob
- `cobrado` / `pagado` (bool) + `fecha_liquidacion` — **crucial**, see IVA rules

### MovimientoBancario
- `cuenta_bancaria_id`, `fecha`, `descripcion_banco` (raw), `monto` (signed), `saldo`
- `tipo` — `cargo` | `abono`
- `conciliado` (bool), `cfdi_id` (nullable), `poliza_id` (nullable)
- `sugerencia_conciliacion` — `{cfdi_id, score, motivo}`

### CuentaBancaria
- `institucion` (`BBVA`, `Banorte`, `Santander`, `Efectivo`…)
- `mascara` — e.g. `4471`
- `tipo` — `cuenta_empresarial` | `tarjeta_negocio` | `efectivo`
- `origen` — `agregacion` (read-only API) | `estado_de_cuenta` (PDF/CSV upload) | `manual`
- `estado` — `conectada` | `requiere_reautorizacion` | `error`
- `ultimo_sync`

### CuentaContable
Chart of accounts, keyed to the SAT's *código agrupador*.
- `codigo` — e.g. `6100-01`, `1180-01`, `2140-01`
- `nombre`, `naturaleza` (`deudora`|`acreedora`), `nivel`, `padre_id`
- `codigo_agrupador_sat`

### Poliza + Asiento
Double-entry. Generated automatically, editable by the user.
- Poliza: `folio` (`D-0148`, `E-0091`), `tipo` (`diario`|`ingresos`|`egresos`), `fecha`,
  `concepto`, `origen_tipo` (`cfdi`|`banco`|`manual`), `origen_id`, `generada_por`
  (`cifra`|`usuario`), `alerta` (nullable text)
- Asiento: `poliza_id`, `cuenta_contable_id`, `debe`, `haber`, `orden`
- **Invariant:** `SUM(debe) = SUM(haber)` per póliza. Reject on save.

### Declaracion
- `periodo` (`2026-08`), `tipo` (`iva_definitivo`|`isr_provisional`|`diot`|`anual`)
- `estado` — `estimada` | `preparada` | `presentada` | `pagada`
- `calculo` (jsonb — the full breakdown, see §3)
- `fecha_limite`, `presentada_en`, `acuse` blob, `linea_captura`

### Acceso (invited users)
- `contribuyente_id`, `email`, `rol` — `contador` | `captura` | `solo_lectura`
- `estado` — `invitado` | `activo` | `revocado`
- `invitado_en`, `expira_en` (**7 days**), `token`

### Notificacion
- `tipo`, `severidad` (`neg`|`warn`|`ia`|`pos`|`act`), `texto`, `pantalla_destino`,
  `entidad_id`, `leida_en`

### ConversacionIA
- `mensajes[]` — `{rol: 'user'|'ai', texto, fuentes, creado_en}`
- `fuentes` is a **required** string on every AI answer, e.g.
  *"246 CFDI · 182 movimientos bancarios · balanza cuadrada en $412,860"*

---

# 2 · External integrations

| Integration | What it does | Notes |
|---|---|---|
| **SAT · descarga de CFDI** | Bulk download of emitted/received/nómina/cancelled CFDI using RFC + CIEC | Prototype claims *"descarga automática cada 6 horas"* and up to **3 years** of history on first sync. Expect throttling and 5xx — the error state is a first-class UI state, not an exception. |
| **SAT · validación de estado** | Confirms each UUID is still `vigente` | Must run on a schedule, not only at import. A CFDI cancelled *after* it was booked is the single most important business rule in the product (§3.4). |
| **SAT · constancia de situación fiscal** | Parses régimen + obligaciones | Drives Calendario fiscal and *Mis obligaciones*. |
| **SAT · presentación** | Files IVA / ISR / DIOT | Requires **e.firma**. Without it the product still works fully — it just cannot file. Never file without explicit user authorization. |
| **Bank aggregation** | Read-only movement feed | Contract shown to the user: *"Nunca podemos mover tu dinero"* and the permission is revocable. Includes a **6-digit MFA step** (§4.2). |
| **Statement upload** | PDF/CSV fallback for unsupported banks | |
| **AI layer** | Q&A + classification + anomaly detection | See §6. |

---

# 3 · Business rules

These are the calculations the UI displays. Get them right; everything else is chrome.

### 3.1 IVA — pago definitivo mensual
```
IVA por pagar = IVA trasladado (cobrado)
              − IVA acreditable (pagado)
              − IVA retenido por clientes personas morales
```
Two non-obvious rules:

- **Flujo de efectivo, not accrual.** IVA trasladado only counts once the invoice is
  *effectively collected*; IVA acreditable only once the expense is *effectively paid*. This is
  why `CFDI.cobrado` / `pagado` / `fecha_liquidacion` exist, and why bank reconciliation feeds the
  tax engine rather than being a bookkeeping nicety. A `PPD` invoice needs its
  *complemento de pago* before its IVA moves.
- **Retenciones** apply when the client is a *persona moral*: 10.67% of the value for IVA in
  the general case. Track them separately — they are a credit, and they roll into the annual
  return.

Fixture (August 2026): `24,500 − 11,885 − 4,195 = 8,420`.

### 3.2 ISR — pago provisional
```
Base = ingresos acumulados del ejercicio − deducciones autorizadas acumuladas
ISR del periodo = tarifa_art_113(Base) − pagos provisionales anteriores
```
Cumulative from January, not per-month. Fixture: `1,286,640 − 474,300 = 812,340` base;
tariff applied, minus `118,160` already paid → `14,320`.

The tariff table (LISR art. 96/113) changes yearly and is inflation-indexed — **store it as
data, versioned by year**, never as constants in code.

### 3.3 Multiple income sources
The fixture taxpayer has *both* actividad empresarial/profesional **and** sueldos y salarios
(ISR withheld by an employer: `3,860`). They are declared together in April and can produce a
refund. The model must support a taxpayer with N income sources and N régimenes at once.

### 3.4 The cancelled-CFDI rule ⚠️ — highest-value rule in the product
When a CFDI that has already been booked into a póliza is later cancelled at the SAT:

1. Its IVA keeps inflating `IVA acreditable`, understating what the user owes.
2. Its expense keeps inflating deductions, understating ISR.
3. The póliza must be reversed before the period closes.

The system must (a) detect it on the validation sweep, (b) raise a `neg` notification,
(c) surface it in the *Cuadre de IVA* panel with the **corrected amount**, and (d) offer a
one-click reversal that links back to the offending póliza.

Fixture: CFDI `3B77…A20` (Suministros Anáhuac, `$2,180`) cancelled 21 Aug, booked in póliza
`D-0142`, contributing `$301` of acreditable. IVA cuadra arithmetically at `$8,420`, but the
honest figure is **`$8,721`**. The UI says exactly that.

### 3.5 Cuadre de IVA (validation panel)
Three outcomes, in priority order:
1. `trasladado − acreditable − retenido ≠ por pagar` → **error**, unexplained difference.
2. Arithmetic holds but some acreditable comes from cancelled CFDI → **warning** with the
   corrected total and a link to the póliza.
3. Otherwise → **ok**.

### 3.6 Other rules the prototype asserts
- **Gastos sin CFDI** are not deductible and acredit no IVA. Fixture: `$6,340` → `$1,014` of
  lost IVA. Chase the supplier before the period closes.
- **Activo fijo** is capitalized, not expensed: a laptop at `$7,900` books to `1250-01 Equipo de
  cómputo` and depreciates over 3 years (`estado_interno = revisar_deduccion`).
- **DIOT** — supplier declaration, due the last day of the following month, 34 suppliers in the
  fixture. Separate deadline from IVA/ISR (30 Sep vs 17 Sep) and the UI treats it as urgent.
- **Cobranza** — days-to-collect per client. Fixture average 23 days; Grupo Médico Anáhuac 31.
- **Salud financiera** — a 0–100 score over six axes: ingresos 88, cobranza 71, liquidez 79,
  gastos 84, impuestos 90, contabilidad 80 → composite **82**, `+6` vs previous period. Define
  the weighting explicitly; the user will ask why it moved.
- **Cierre mensual** — a 9-step checklist: CFDI sincronizados, XML procesados, gastos
  clasificados, bancos conciliados, facturas por cobrar revisadas, pólizas generadas, balanza
  revisada, impuestos estimados, estados financieros generados.

### 3.7 Fixture coherence (use as seed data + regression tests)

| Periodo | Ingresos | Gastos | Utilidad | IVA | ISR | Total imp. | Margen |
|---|---|---|---|---|---|---|---|
| Mayo 2026 | | | | 7,140 | 11,880 | 19,020 | |
| Junio 2026 | | | | 8,010 | 12,940 | 20,950 | |
| Julio 2026 | | | | 7,860 | 13,410 | 21,270 | |
| **Agosto 2026** | 185,420 | 74,280 | 111,140 | 8,420 | 14,320 | 22,740 | 59.9% |
| Trimestre jun–ago | 512,680 | 221,940 | 290,740 | 24,290 | 40,670 | 64,960 | 56.7% |
| Año ene–ago | 1,286,640 | 474,300 | 812,340 | 57,840 | 113,360 | 171,200 | 63.1% |
| 1 abr – 31 ago | 842,910 | 329,180 | 513,730 | 37,650 | 70,770 | 108,420 | 60.9% |

Invariants that must hold in any period: `ingresos − gastos = utilidad`,
`utilidad / ingresos = margen`, `iva + isr = total`, and the *trimestre* row is the exact sum of
the three monthly rows. Balanza cuadrada at `412,860`; 148 pólizas; 246 CFDI;
182 bank movements (174 reconciled, 8 orphaned worth `9,180`); `48,200` receivable
(`29,800` current + `18,400` overdue).

---

# 4 · State machines

Every one of these is fully wired in the prototype — step through it to see each branch.

### 4.1 Invitar usuario
```
idle ──validate──> (invalid) ──> idle + field error
     └─valid─────> sending ─┬─> conflict   (email already has access)
                            ├─> error      (mail server rejected)
                            └─> sent ──850ms──> closed + toast
```
- `conflict` offers a recovery action → *Ver accesos*.
- `error` offers *Reintentar* and states the invitation was **not** saved.
- Prototype triggers: `ana@despacho.mx` → conflict; any `*.test` domain → error.
- Invitation expires in **7 days**.

### 4.2 Conectar banco
```
pick ──> connecting (~1.2s) ──> mfa ──validate code──> verifying ─┬─> mfa + error
                                                                  └─> done ──> toast
```
- MFA is a 6-digit numeric code; input filters non-digits and caps at 6.
- `Subir estado de cuenta` and `Caja y efectivo` short-circuit and never enter the machine.
- Prototype trigger: code `000000` → rejected by the bank.

### 4.3 Verificar RFC (onboarding step 1)
```
idle ──structural validation──> (invalid) ──> field error, specific to the failure
     └─valid──> checking (SAT lookup ~1.2s) ─┬─> notfound  ("El SAT no reconoce ese RFC")
                                             └─> ok ──> advance to step 2
```
Editing the field resets the machine to `idle` so the SAT lookup re-runs.
Prototype trigger: `XAXX010101000` → notfound.

### 4.4 Sincronización con el SAT
`idle → trying → (ok | error 503)`. On error the whole app enters the **stale-data** presentation
(§7): a banner over real-but-stale figures, automatic retry every 15 min, cached data still
served. Not a blocking error screen.

### 4.5 Importar XML
`idle → processing (~1.7s) → done`, resettable.

### 4.6 Onboarding
4 steps: RFC + CIEC → e.firma (skippable) → bancos (multi-select, skippable) → resumen.
Every step after the first is skippable; the first is not. The summary reports what was actually
found: `2,842 CFDI desde 2023`, régimenes detected, accounts connected.

---

# 5 · Validation rules

Implement these **server-side with the same messages** — the copy is specific by failure cause on
purpose, and it is the difference between a form the user can fix and one they abandon.

### RFC
Order matters; return the first failure.

| Check | Message (es-MX) |
|---|---|
| empty | `Escribe tu RFC.` |
| chars outside `A-ZÑ&0-9` | `El RFC solo lleva letras y números, sin espacios ni guiones.` |
| doesn't start with 3 letters | `Empieza con las letras de tu nombre: 4 si eres persona física, 3 si es empresa.` |
| length < 12 | `Faltan caracteres: llevas {n} y un RFC son 12 o 13.` |
| length > 13 | `Sobran caracteres: llevas {n} y un RFC son 12 o 13.` |
| chars 4–10 (PF) / 3–9 (PM) not 6 digits | `Después de las letras va la fecha en AAMMDD, seis dígitos.` |
| month not 01–12 | `El mes «{mm}» no existe.` |
| day invalid for that month | `El día «{dd}» no existe en ese mes.` |
| homoclave not 3 alphanumerics | `La homoclave son 3 caracteres alfanuméricos.` |

13 chars → persona física; 12 → persona moral. Day validation uses
`[31,29,31,30,31,30,31,31,30,31,30,31]` (Feb permissive at 29).
Production should additionally verify the **check digit** and reject the SAT's inconvenient-word
list — the prototype does not.

### Correo
| Check | Message |
|---|---|
| empty | `Escribe el correo de la persona.` |
| whitespace | `El correo no lleva espacios.` |
| no `@` | `Falta la arroba.` |
| more than one `@` | `El correo lleva una sola arroba.` |
| nothing before `@` | `Falta el nombre antes de la arroba.` |
| nothing after `@` | `Falta el dominio después de la arroba.` |
| domain has no dot | `El dominio necesita un punto, como despacho.mx.` |
| TLD not ≥2 letters | `La terminación del dominio no se ve bien.` |

### Código MFA
empty → `Escribe el código que te mandó el banco.` · non-digits → `El código son puros números.` ·
short → `Faltan {n} dígito(s).`

### CIEC
Optional; if present, minimum 8 chars → `La CIEC son al menos 8 caracteres.`

### Póliza
`SUM(debe) = SUM(haber)`, else reject.

---

# 6 · The AI layer

Not decoration — it is the product's voice, and it has rules.

1. **Every answer cites its sources.** A `fuentes` string is mandatory:
   *"246 CFDI · 182 movimientos bancarios · balanza cuadrada en $412,860"*. An answer without
   provenance is a bug.
2. **Answers use the user's own figures**, never generic advice. Scope: cobranza, gastos por
   categoría, impuestos del periodo, utilidad, clientes, conciliación bancaria. Out of scope →
   say so and list what it *can* answer.
3. **Recommendations are structured** as `Problema / Impacto / Acción` with a peso amount and a
   concrete action button — not a paragraph of advice.
4. **Classification is a suggestion, not a decision.** The AI proposes a `cuenta_contable`; the
   user confirms. Store `cuenta_sugerida_por_ia` so the UI can label it *"Sugerida por la IA"*.
5. **Anomaly detection** runs continuously: duplicate CFDI (same amount + date + issuer),
   unusual amount (fixture: 4.2× the category's typical), new supplier ramping fast, bank
   movements with no matching CFDI.
6. **Explainability on the tax calculation.** *"¿Cómo se calculó?"* returns prose that walks the
   arithmetic and links to the source records.

Backend implication: build a **query router** over the ledger with a fixed set of typed
intents + a citation payload, rather than handing an LLM raw SQL. Every number in an answer
must be traceable to record IDs.

---

# 7 · Screens → data requirements

Suggested endpoints. `?periodo=` accepts `mes` | `trimestre` | `anio` | a custom range; all
figures must be recomputed per period (see §3.7 for the invariants).

| Screen | Needs |
|---|---|
| **Inicio** | `GET /resumen?periodo=` — KPIs (ingresos, gastos, utilidad, impuestos + deltas vs previous), por cobrar split current/overdue, CFDI processed/to-review, salud financiera, `atencion[]` (prioritized issues), AI insights, actividad reciente |
| **Ingresos** | `GET /ingresos?periodo=` — invoices, aging, clients, collection days |
| **Gastos** | `GET /gastos?periodo=` — by category, deducible flag, IVA acreditable, XML import |
| **CFDI** | `GET /cfdi?tipo=&periodo=&estado=` — tabs: Emitidos, Recibidos, Cancelados, Nómina, Sin clasificar. Per-row drill-down returns the full comprobante **plus its trace**: downloaded from SAT → validity → payment → booking |
| **Bancos** | `GET /bancos`, `GET /movimientos?cuenta=` — accounts, balances, reconciliation queue, `POST /conciliar` (batch) |
| **Contabilidad** | `GET /diario`, `/mayor`, `/balanza`, `/catalogo`. Póliza drill-down returns asientos, debe/haber/diferencia, `origen` prose, and any `alerta` |
| **Impuestos** | `GET /impuestos?periodo=` — the full §3.1/§3.2 breakdown, the cuadre result (§3.5), obligaciones with due dates, retenciones a favor, month-by-month history with deltas |
| **Estados financieros** | `GET /estados?periodo=` — resultados, balance, flujo, ratios |
| **IA / Insights** | `POST /ia/preguntar`, `GET /ia/recomendaciones`, `GET /ia/revisiones`, `GET /cierre` |
| **Calendario fiscal** | `GET /calendario?mes=` — days marked `crit` (declarar) / `warn` (preparar) / `soft` (cierre) |
| **Reportes** | `GET /reportes`, `POST /reportes` — monthly/annual packages: balanza, estados, XML, acuse |
| **Mi información fiscal** | `GET /constancia` — régimen, obligaciones, domicilio, read date |
| **Configuración** | Integrations, preferences, `GET/POST /accesos`, security |

Cross-cutting: `GET /notificaciones` (severidad + destination screen + entity id),
`GET /buscar?q=` — global search spanning CFDI, proveedores and cuentas contables in one response.

### Empty and error states are API states, not UI afterthoughts

Every screen has three presentations, and the API should make it obvious which one applies:

- **Normal** — data present.
- **Primer uso** — nothing connected yet. The API returns empty collections *and* a
  `configuracion_pendiente` flag. The UI then suppresses the notification badge, the period
  tabs and the closing checklist, and asserts no régimen. Configuración stays fully usable.
- **Sin conexión al SAT** — serve **cached data plus staleness metadata**
  (`{ stale: true, corte: '2026-08-29T19:40', ultimo_intento: '10:42', error: 503,
  proximo_intento_en: 900 }`). Never a blank error page: the user sees their real figures with a
  banner saying exactly how old they are. Retries are automatic every 15 min.

There is also a genuine per-tab empty: CFDI → Nómina, when the taxpayer has no employees.

---

# 8 · Interactions & motion

- **Screen entrance** — `opacity 0 → 1`, `translateY(5px) → 0`, `220ms ease-out`.
- **Number transitions** — changing the period tweens every figure on the dashboard
  (18 nodes) over **640ms** with `easeOutCubic`, and flips the delta chip's semantic color when
  the sign changes. Prose and the "vs" labels swap with it.
- **Drawers** — slide from right, `220ms cubic-bezier(.22,.61,.36,1)`, width 472px, scrim
  `rgba(8,12,14,.34)`.
- **Modals** — `160ms ease-out`, scrim `rgba(8,12,14,.42)`, top-aligned at `11vh`.
- **Menus** — pop, `150ms ease-out`.
- **Spinners** — 900ms linear rotation.
- **Thinking indicator** — three dots, 1.1s stagger at 180ms.
- **Toasts** — bottom-left, auto-dismiss at **3.6s**.
- **Keyboard** — `⌘K` global search, `⌘\` collapse sidebar, `Esc` closes any overlay,
  `Enter` submits the focused form.
- **Sidebar** — collapses 236px → 68px, `200ms cubic-bezier(.22,.61,.36,1)`, icon-only.

---

# 9 · Design tokens

Two themes on the same token names; the app sets `data-theme="night"` on `<html>`.

### Day
```
--bg        #f6f7f9    --panel     #ffffff    --inset   #f8fafc    --chip    #eef1f5
--line      #e6e9ee    --line2     #eef1f5
--text      #111827    --muted     #6b7280    --faint   #8b939f
--accent    #12507f    --accent-2  #2f7fbf    --accent-soft #eaf2f9  --accent-line #dde7f0
--pos #146c43 / bg #e7f5ee     --neg #b42318 / bg #fee4e2     --warn #b54708 / bg #fef0c7
--ia   #0f7c8a / bg #e3f2f4 / line #c4e2e6      (AI voice)
--data #5b4bb8 / bg #ecebfa                      (comparisons only)
--act  #c2410c / bg #ffedd5                      (urgent secondary actions)
--bar  #c8d3de   --shadow 0 1px 2px rgba(16,24,40,.05)   --radius 14px
sidebar: --sb #12507f, --sb-text #f2f7fb, --sb-active rgba(255,255,255,.16)
```

### Night
```
--bg #0f1417   --panel #141b1f   --inset #182023   --chip #1a2226
--line #212b30   --line2 #1e282d
--text #e8ecef   --muted #8a969c   --faint #6f7c83
--accent #2fbfa8   --accent-2 #2fbfa8   --onaccent #08201d
--pos #57cfc0   --neg #e07a8b   --warn #d8a24a
--ia #3ec7c0   --data #9a8cf0   --act #e08d5a
sidebar: --sb #0d2a31
```

### Semantics — enforce these, they carry meaning
- **Petróleo `--accent`** — primary actions, navigation, sidebar.
- **Turquesa `--ia`** — *only* the AI's voice: chat, explanations, insights, suggestions. It is
  the one hue that reads the same in both themes, which is why the AI owns it.
- **Naranja quemado `--act`** — *only* urgent secondary actions and deadline pressure.
- **Violeta `--data`** — *only* comparisons and data-over-time.
- **Jade / ámbar / terracota** — system semiotics (ok / attention / problem). Never decorative.

### Type & spacing
- **IBM Plex Sans** 400/500/600 for UI; **IBM Plex Mono** 400/500 for every figure, RFC, UUID and
  account code, with `font-variant-numeric: tabular-nums` (class `.num`).
- Scale: 11 / 12 / 12.5 / 13 / 13.5 / 14 / 15 / 17 / 22 / 24 / 25 / 29 / 34 / 46px.
  Headings `letter-spacing: -0.02em`; hero figures `-0.03em`.
- Card padding 15–20px; grid gap 13px; section gap 13px; radius 14px cards / 9–12px controls
  / 99px pills.

### Icons
**Phosphor Icons, duotone weight** throughout (`@phosphor-icons/web`). No exceptions, no emoji.

---

# 10 · Assets

None. All iconography is Phosphor duotone from CDN; there are no images, no logos and no
photography in the prototype. The brand mark is a Phosphor `chart-line-up` glyph in a rounded
square — replace it with the real mark when there is one.

---

# 11 · Files

- `Cifra v2.dc.html` — the full prototype. Single file: markup at the top, a `<style>` block with
  the tokens in `:root` / `html[data-theme="night"]`, and the component logic in the trailing
  `<script>` (fixtures live in `static` fields: `PERIODOS`, `CFDIS`, `POLIZAS`, `ANSWERS`,
  `MONTHS`, `VACIOS`, plus the `valida*` functions, which are the §5 rules verbatim).
- `support.js` — the prototype's runtime. **Not part of the product**; ignore it.

To read the fixtures and validators directly, search the script for `static PERIODOS`,
`static CFDIS`, `static POLIZAS`, `static validaRFC`, `static validaEmail`.

---

# 12 · Suggested build order

1. **Contribuyente + Constancia + Obligaciones**, and the §5 validators. Nothing works without a
   verified RFC.
2. **SAT CFDI ingestion** with the periodic validity sweep. This is the hard, slow, flaky part —
   do it early and design for failure (§7 staleness contract).
3. **Chart of accounts + automatic póliza generation** from CFDI, with the balance invariant.
4. **Bank aggregation + reconciliation**, which is what turns accrual records into the
   cash-flow figures the tax engine needs.
5. **Tax engine** (§3), with the tariff tables as versioned data and §3.7 as a regression suite.
6. **Cancelled-CFDI detection and the cuadre panel** (§3.4/§3.5) — the highest-value feature and
   the one that earns the product its trust.
7. **AI query router** with mandatory citations (§6).
8. **Reports, DIOT, filing with e.firma.**
