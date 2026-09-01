# Primeros pasos con Claude Code

La secuencia completa, de arriba abajo. Cada bloque en cita es **lo que le dices a Claude Code**,
tal cual. Después de cada uno hay una verificación: si no pasa, no sigas.

Trece pasos. Los primeros cinco son la base y no se saltan; del 6 en adelante puedes reordenar
según lo que quieras enseñar antes.

\---

## 0 · Antes de empezar

Cuentas en **GitHub**, **Vercel**, **Neon** e **Inngest** (las tres últimas tienen plan gratuito
suficiente). Instala `gh` y `pnpm`.

Arma la carpeta así:

```bash
mkdir cifra \&\& cd cifra
mkdir handoff
# del paquete original:
cp .../README.md .../ARQUITECTURA.md handoff/
cp -r .../frontend .../datos handoff/
cp ".../Cifra v2.dc.html" handoff/
# los documentos nuevos:
cp .../ARQUITECTURA-MULTIINQUILINO.md .../ARQUITECTURA-IA.md \\
   .../ARQUITECTURA-COMANDOS.md .../ARQUITECTURA-PREFACTURAS.md handoff/
cp .../tenancy.prisma .../ia.prisma .../comandos.prisma .../prefacturas.prisma handoff/backend/
cp .../rls.sql handoff/backend/
# a la raíz:
cp .../CLAUDE.md .
cp .../.env.example .
```

**`CLAUDE.md` va en la raíz.** Claude Code lo lee en cada sesión; es lo que evita que se te vaya
el contexto entre conversaciones.

Dos aclaraciones sobre los documentos, porque se contradicen a propósito en un punto:

* `ARQUITECTURA-PREFACTURAS.md` **sustituye** a la sección 5 de `ARQUITECTURA-COMANDOS.md`.
* De `handoff/backend/comandos.prisma` hay que **borrar** los modelos `SelloDigital`,
`SerieFolio` y `EmisionCFDI`. Cifra no timbra.

Hazlo ahora, antes del paso 1, para que Claude Code no lea la versión vieja.

\---

## 1 · Andamio y repositorio

> Lee completos, antes de escribir nada: `CLAUDE.md`, `handoff/README.md`,
> `handoff/ARQUITECTURA.md` y `handoff/ARQUITECTURA-MULTIINQUILINO.md`.
>
> Arma el monorepo con pnpm workspaces: Next.js 15 con App Router y TypeScript en `apps/web`, y
> los paquetes `core`, `db`, `sat`, `cfdi`, `ia` y `ui` vacíos pero con su `package.json` y su
> `tsconfig`. Configura Tailwind en `apps/web` e importa `handoff/frontend/tokens.css` en
> `packages/ui`.
>
> No escribas todavía ninguna pantalla ni ningún endpoint. Cuando termine el andamio, inicializa
> git, crea el repositorio privado en GitHub con `gh repo create` y sube la primera versión.

**Verifica:** `pnpm dev` levanta, `pnpm typecheck` pasa, el repo existe.

\---

## 2 · Inquilinos y aislamiento — el paso que no se puede posponer

Este va antes que la base de datos de negocio. Meter multi-inquilino después, con datos reales, es
la migración más cara del proyecto.

> Lee `handoff/ARQUITECTURA-MULTIINQUILINO.md` completo.
>
> En `packages/db`, arma el esquema de plataforma con los modelos de
> `handoff/backend/tenancy.prisma`: Usuario, Organizacion, Membresia, Contribuyente, Acceso,
> Invitacion, CredencialFiscal, AutorizacionCredencial, SolicitudPresentacion, SincronizacionRfc,
> ResumenContribuyente, Bitacora y Suscripcion.
>
> Crea el proyecto en Neon, pon `DATABASE\_URL` y `DIRECT\_URL` en `.env`, y genera la primera
> migración. Incluye `handoff/backend/rls.sql` \*\*dentro\*\* de una migración de Prisma, no como paso
> manual.
>
> Después escribe en `packages/db`:
> - `prismaPara(contribuyenteId)`, el cliente con alcance que fija `app.contribuyente\_id` con
>   `set\_config(..., true)` dentro de la transacción, como está en la sección 4 del documento.
> - En `apps/web/lib/contexto.ts`, el helper `contexto(slug)` de la sección 5: resuelve el
>   segmento de ruta, verifica `Acceso` y devuelve el cliente con alcance. Sin acceso, 404.
>
> Y una prueba de integración que siembre dos organizaciones y confirme que el cliente con
> alcance de la organización A no devuelve ni una fila de la B, ni siquiera con una consulta sin
> `where`.

**Verifica:** esa prueba pasa. Si no pasa, todo lo demás está construido sobre arena.

\---

## 3 · El resto del modelo de datos

> Toma `handoff/backend/schema.prisma` como punto de partida para las entidades fiscales.
> Revísalo contra la sección 1 del README y dime qué le falta o qué está mal modelado \*\*antes\*\* de
> generar la migración.
>
> A cada entidad con dinero adentro agrégale `contribuyente\_id` no nulo con su relación, y el
> índice principal empezando por esa columna. Después corre `rls.sql` otra vez: es idempotente y
> aplica la política a las tablas nuevas.
>
> Luego escribe el seed que carga `handoff/datos/seed.json`: el contribuyente TODA7606258I7 con
> sus 8 CFDI, sus 5 pólizas, su catálogo de cuentas y sus obligaciones, dentro de una organización
> `personal`. Agrega también una organización `despacho` con tres clientes, uno de ellos el mismo
> TODA7606258I7 vinculado por `Acceso`, para tener cubierto el caso difícil de la sección 3.

**Verifica:** `pnpm db:seed`, y `pnpm db:studio` muestra los datos con sus dos organizaciones.

A la entidad CFDI agrégale serie, folio y origen (sat | xml\_subido | prefactura\_conciliada), leídos del comprobante. Son de solo lectura: Cifra no administra series ni folios.

\---

## 4 · El motor fiscal (lo más importante)

Puro, sin red ni base de datos, sin saber qué es un inquilino.

> Implementa `packages/core` en este orden, con pruebas antes de pasar al siguiente:
>
> 1. `validadores/` — las reglas de la sección 5 del README, \*\*con sus mensajes exactos en
>    español\*\*. Una prueba por fila de cada tabla.
> 2. `impuestos/iva.ts` — pago definitivo mensual por \*\*flujo de efectivo\*\* (sección 3.1).
> 3. `impuestos/isr.ts` — pago provisional acumulado, con la tarifa como dato versionado en
>    `tarifas/2026.json` (sección 3.2).
> 4. `contabilidad/cuadre.ts` — las tres salidas de la sección 3.5, incluida la del CFDI cancelado
>    con la cifra corregida.
> 5. `contabilidad/poliza.ts` — generación desde CFDI y desde movimiento bancario, con el
>    invariante debe = haber.
>
> La tabla de la sección 3.7 del README es la suite de regresión: agosto, trimestre jun–ago y año
> ene–ago tienen que dar exactamente esas cifras. Dinero en centavos enteros.

**Verifica:** `pnpm test` verde, y agosto dando `8,420` de IVA con la advertencia de los `301` del
CFDI cancelado.

\---

## 5 · Una pantalla completa, de punta a punta

> Ahora la vertical de \*\*Impuestos\*\*, que toca todo: ruta, endpoint, motor, cuadre y voz de la IA.
>
> `GET /api/\[contribuyente]/impuestos?periodo=` con el desglose de las secciones 3.1 y 3.2, el
> resultado del cuadre, las obligaciones con sus fechas, las retenciones a favor y el histórico
> mes por mes con sus deltas. Usa el cliente con alcance de `contexto()`, nunca el global.
>
> Y la pantalla en `/(app)/\[contribuyente]/impuestos`, siguiendo el prototipo
> `handoff/Cifra v2.dc.html` y la semántica de color de `CLAUDE.md`: el bloque de "¿Cómo se
> calculó?" en turquesa porque es voz de la IA, la presión de fecha y la DIOT en naranja quemado,
> el histórico comparativo en violeta.
>
> Incluye los tres estados: normal, primer uso y sin conexión al SAT, con el contrato de datos
> rancios de la sección 7 del README.

**Verifica:** cuadra con el prototipo lado a lado, y forzar el error muestra la franja sobre datos
reales, no una pantalla en blanco.

\---

## 6 · Despliegue

> Conecta el repo a Vercel con `apps/web` como raíz y rama de Neon por preview. Configura las
> variables de `.env.example` en los tres entornos. Agrega el workflow de GitHub Actions con
> typecheck, lint, las pruebas de `packages/core` y la prueba de aislamiento del paso 2. Que
> ningún PR se pueda mezclar si alguna de las dos falla.

**Verifica:** abre un PR de prueba y confirma que salen preview de Vercel y rama de Neon.

\---

## 7 · El SAT

Aquí el proyecto se vuelve real. Ve despacio.

> Implementa `packages/sat` \*\*primero como cliente falso\*\* que lee de `handoff/datos/seed.json`,
> con la misma interfaz que tendrá el real, y que pueda simular error 503 y respuestas lentas.
>
> Luego los trabajos en `apps/trabajos` con Inngest:
> - `sat-sincronizar` — primera bajada (hasta 3 años) y luego cada 6 h, con pasos durables,
>   reintentos, y el candado global por RFC de la sección 3 del documento de inquilinos usando
>   `SincronizacionRfc`. Abanico por contribuyente, nunca un ciclo dentro de una función.
> - `sat-validez` — el barrido de UUID. Cuando encuentre un CFDI cancelado que ya está en una
>   póliza: notificación `neg`, cifra corregida en el cuadre y acción de revertir. Sección 3.4.
> - `sat-constancia` — parseo de régimen y obligaciones.
>
> La CIEC sigue la sección 4 de ARQUITECTURA.md y la 7 del documento de inquilinos: descifrado
> solo dentro del worker, con `AutorizacionCredencial` vigente, y cada uso a `Bitacora`.

**Verifica:** con el cliente falso, cancelar un CFDI en el seed dispara la notificación y cambia
el cuadre a la cifra corregida, sin tocar nada más. Y dos organizaciones con el mismo RFC no
sincronizan en paralelo.

\---

## 8 · Auth, accesos y la cartera del despacho

> Auth.js v5 con magic link. Al aceptar una invitación se crea `Membresia` y/o `Acceso` según el
> caso. Implementa la máquina de estados de la sección 4.1 del README con sus mensajes exactos y
> la expiración a 7 días.
>
> Después las pantallas de organización: el selector de contribuyente en la barra superior (oculto
> si la organización es `personal`), `/equipo` con la matriz de accesos y los dos niveles de rol, y
> `/cartera` para despachos, que lee \*\*solo\*\* de `ResumenContribuyente` — nunca recalcula por
> cliente. Los trabajos del paso 7 actualizan esa tabla al terminar.

**Verifica:** la cartera con 3 clientes hace un número constante de consultas, no una por cliente.

\---

## 9 · Las demás pantallas

> Las diez pantallas restantes contra endpoints reales, siguiendo el prototipo y la sección 7 del
> README. Todas bajo `/\[contribuyente]/`, todas con sus tres estados. Y el onboarding de 4 pasos
> de la sección 4.6, que ahora además crea la organización.

\---

## 10 · Observaciones y sugerencias

> Lee `handoff/ARQUITECTURA-IA.md` completo. Implementa las capas 1 a 3, todavía sin modelo:
>
> - `Evento` (dominio y uso), emitido en la misma transacción que el cambio.
> - `packages/core/observadores/` — los detectores de la sección 3, puros y con pruebas. Empieza
>   por los fiscales duros, que son deterministas: CFDI cancelado contabilizado, cuadre fuera,
>   póliza descuadrada, gasto sin CFDI.
> - `packages/ia/acciones/` — el registro cerrado: cada acción con su esquema Zod, rol requerido,
>   reversibilidad y `requiere\_confirmacion`. Los ejecutores apuntan a los servicios de dominio que
>   ya existen; no escribas lógica nueva dentro de `packages/ia`.
> - `apps/trabajos/observar.ts` y `sugerir.ts`, con el presupuesto de atención de la sección 4:
>   máximo 3 activas, descartada no vuelve, dos descartes silencian el tipo.
>
> Las sugerencias se muestran con plantillas de texto fijas. El modelo entra hasta el paso 11.

**Verifica:** el CFDI cancelado del seed produce una `Observacion` con evidencia y una
`Sugerencia` con la acción `revertir\_poliza`, y el botón funciona.

\---

## 11 · El narrador y las consultas

> Ahora sí el modelo. `packages/ia/narrador/` con el validador de cifras de la sección 5 del
> documento de IA: extrae los números de la salida y si alguno no está en el diccionario `valores`,
> registra el fallo y cae a la plantilla. `fuentes` lo arma el enrutador con conteos reales.
>
> El enrutador de intenciones de la sección 6 del README: lista cerrada de intenciones sobre el
> libro mayor, nunca SQL generado. Fuera de alcance lo dice y enumera lo que sí puede contestar.
>
> Y el conjunto dorado en `packages/ia/evaluacion/` sobre el seed, con la prueba automática de que
> ninguna respuesta trae cifras inventadas.

\---

## 12 · La ruta guiada a la declaración

> Sección 6 del documento de IA. `Cierre` y `PasoCierre` con los 9 pasos de la sección 3.6 del
> README, recalculados por evento y no al abrir la pantalla.
>
> Cada paso: su estado, sus bloqueadores como IDs de `Observacion`, su acción tipada, cuántos
> pendientes, cuánto valen en pesos y los minutos estimados desde `PerfilHabitos`. Un paso
> bloqueado nunca dice "no puedes continuar": dice qué falta, cuánto vale y trae el botón.
>
> Y la capa pedagógica de la sección 7: el gesto de "explícame" en cualquier cifra, con los tres
> niveles. El nivel 3 se siembra desde `packages/ia/pedagogia/conceptos/`, escrito a mano, nunca
> generado.

\---

## 13 · Comandos y prefacturas

> Lee `handoff/ARQUITECTURA-COMANDOS.md` y `handoff/ARQUITECTURA-PREFACTURAS.md`.
>
> Primero la tubería de comandos: clasificador (consulta / artefacto / operación), planificador que
> produce un `Plan` con parámetros resueltos, traza de resolución, efectos en pesos, advertencias,
> hash del estado, caducidad de 10 minutos y token de un solo uso. Confirmar revalida el hash y
> \*\*no vuelve a llamar al modelo\*\*. Ante ambigüedad, se pregunta.
>
> Después las prefacturas: `packages/cfdi` con los catálogos versionados y las validaciones de la
> sección 3 —receptor contra su constancia, coherencia de método y forma de pago, aritmética—, los
> tres formatos de entrega, y el matcher que concilia la prefactura con el CFDI real cuando llega
> por `sat-sincronizar`, con score y confirmación como la conciliación bancaria.

**Verifica:** *"genera una factura idéntica a la del mes pasado para Anáhuac"* produce un plan que
muestra qué entendió y qué va a pasar; confirmarlo crea la prefactura; y timbrar ese CFDI en el
seed la marca como timbrada sola.

\---

## Lo que falta después

Bancos (agregación, conciliación y la máquina de estados con MFA de la sección 4.2), reportes,
DIOT, y la presentación con e.firma vía `SolicitudPresentacion`.

\---

## Cómo pedir cambios

* **Nombra el documento y la sección.** "Cambia el cuadre según la sección 3.5 del README" o "usa
el patrón de la sección 5 del documento de comandos" funciona mucho mejor que describir el
cambio desde cero.
* **Actualiza `CLAUDE.md` cuando cambie una decisión.** Es la memoria del proyecto entre sesiones.
Si algo de las 22 reglas deja de valer, edítalo el mismo día.
* **Una sesión, un paso.** Estos pasos son largos. Abrir una conversación nueva por paso mantiene
el contexto limpio y hace más fácil volver atrás.

