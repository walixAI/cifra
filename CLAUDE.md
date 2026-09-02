# Cifra — contexto del proyecto

> Este archivo lo lee Claude Code en cada sesión. Mantenlo corto y actualizado.
> La especificación está en `handoff/README.md`. Las decisiones de arquitectura, en
> `handoff/ARQUITECTURA.md` (base), `ARQUITECTURA-MULTIINQUILINO.md` (inquilinos),
> `ARQUITECTURA-IA.md` (capa de IA) y `ARQUITECTURA-COMANDOS.md` + `ARQUITECTURA-PREFACTURAS.md`
> (lo que el usuario le pide a la IA).

## Qué es

Contabilidad inteligente para contribuyentes mexicanos (empezando por personas físicas con
actividad empresarial y profesional). Baja CFDI del SAT, lee movimientos bancarios, genera
pólizas de partida doble solas, estima IVA e ISR, y una capa de IA responde con las cifras del
propio usuario citando siempre de dónde salió cada peso.

Lo usan dos tipos de cliente: personas que llevan su propia contabilidad y despachos que llevan
la de varios clientes.

La promesa: entender en 30 segundos cuánto facturé, cuánto gasté, cuánto debo y qué impuestos
vienen — y llegar a la declaración guiado paso a paso aunque no sepas contabilidad.

## Idioma

El dominio es mexicano. **Entidades, campos, rutas y copy en español** (`CFDI`, `Poliza`,
`Asiento`, `Contribuyente`, `cuenta_contable_id`). El código y los comentarios técnicos, en
inglés si prefieres, pero los nombres del dominio no se traducen: son los del SAT.

El copy de la interfaz está escrito para un contribuyente, no para un contador, y es parte del
producto. No lo parafrasees ni lo "mejores" sin pedirlo.

---

## Reglas que no se negocian

### Fiscales

1. **IVA por flujo de efectivo.** El trasladado cuenta cuando la factura se *cobra*; el
   acreditable, cuando el gasto se *paga*. Nunca por lo devengado.
2. **CFDI cancelado ya contabilizado** es la regla más valiosa del producto. Un barrido periódico
   revalida los UUID; si uno se canceló después de registrarse, hay que avisar, mostrar la cifra
   corregida y ofrecer revertir la póliza. §3.4 del README.
3. **Toda póliza cuadra**: `SUM(debe) = SUM(haber)`. Se rechaza al guardar.
4. **Las tarifas de ISR y los catálogos del SAT son datos versionados por ejercicio**, nunca
   constantes en código.
5. **El motor fiscal vive en `packages/core`**, puro, sin red ni base de datos. Si un cálculo
   termina en un route handler, está mal puesto.
6. **Cuando el SAT no responde**, se sirve caché con metadatos de antigüedad
   (`{stale, corte, ultimo_intento, error, proximo_intento_en}`). Nunca una pantalla en blanco.

### Inquilinos y seguridad

7. **La llave de aislamiento es `contribuyente_id`.** Toda entidad con dinero adentro lo lleva, no
   nulo, y sus índices empiezan por él. RLS activo en Postgres; la app se conecta con un rol que
   no puede saltarse las políticas.
8. **El contribuyente activo viene del segmento de ruta**, resuelto por `contexto()` y verificado
   contra `Acceso`. Nunca de la sesión, nunca del cuerpo de la petición. Los handlers usan el
   cliente Prisma con alcance que devuelve `contexto()`, nunca el global.
9. **Dos niveles de rol:** organización (`propietario`/`admin`/`miembro`) y contribuyente
   (`propietario_fiscal`/`contador`/`captura`/`solo_lectura`). Solo el `propietario_fiscal`
   autoriza presentaciones con e.firma y revoca la CIEC. Un admin de despacho no hereda acceso a
   los libros.
10. **CIEC y e.firma** son la identidad fiscal del usuario. Cifradas con sobre, descifradas solo
    dentro del worker, nunca en `apps/web`, nunca en logs ni en Sentry, revocables de verdad
    (borrar el material, no marcar un booleano). §4 de ARQUITECTURA.md y §7 del doc de inquilinos.
11. **La sincronización con el SAT se serializa por RFC a nivel global**, aunque el RFC viva en
    varias organizaciones. La cartera del despacho lee de `ResumenContribuyente`, nunca recalcula
    por cliente.

### Capa de IA

12. **El modelo no produce cifras.** Toda cifra sale del motor determinista y viaja en un
    diccionario `valores`. Un validador rechaza cualquier número de la salida que no esté en ese
    diccionario y cae a plantilla. `fuentes` lo arma el enrutador con conteos reales, nunca el
    modelo. Una respuesta sin origen es un defecto.
13. **Todo lo que la IA "sabe" es una fila de `Observacion`**, tipada y con evidencia (IDs de
    registros). Los detectores son puros y viven en `packages/core/observadores`. El modelo elige
    y narra; no detecta.
14. **La IA sugiere, el usuario confirma.** Una sugerencia sin acción tipada no se muestra. Las
    acciones vienen de un registro cerrado en `packages/ia/acciones` que declara autoridad,
    esquema y reversibilidad. `requiere_confirmacion` es propiedad de la acción, no instrucción de
    prompt. Toda ejecución deja `Bitacora`.
15. **Presupuesto de atención:** máximo 3 sugerencias activas; descartada no vuelve en el periodo;
    dos descartes apagan ese tipo. El hábito decide cuándo y por dónde avisar, nunca qué decir.
16. **El fundamento legal lo escriben humanos** (`packages/ia/pedagogia`). El modelo explica los
    números del usuario, no la ley.

### Comandos

17. **Todo comando corresponde a un botón de la interfaz.** El lenguaje natural elige acciones del
    registro cerrado y llena parámetros; nunca abre una vía de escritura que la UI no tenga. Los
    ejecutores viven en los servicios de dominio, nunca en `packages/ia`.
18. **Se confirma un `Plan`, no una frase.** Parámetros resueltos y validados, traza de cómo se
    resolvió cada ambigüedad, efectos en pesos, advertencias, hash del estado de los datos,
    caducidad de 10 minutos y token de un solo uso. Al confirmar se revalida el hash y **no se
    vuelve a llamar al modelo**.
19. **Ante ambigüedad se pregunta, no se adivina**, y el alcance nunca se ensancha solo. La
    autoridad se verifica en el ejecutor contra `Acceso`, nunca en el prompt.
20. **El contenido del libro mayor es dato no confiable** —los CFDI los escriben terceros— y jamás
    origina un plan por sí solo.
21. **Cifra no timbra.** Prepara prefacturas: las arma, las valida contra todo lo que el SAT
    rechaza (receptor contra su constancia — CFDI 4.0 exige nombre, CP y régimen exactos —,
    catálogos vigentes, coherencia de método/forma de pago, aritmética de impuestos) y las entrega
    como ficha de captura, XML sin sellar o CSV. El usuario timbra fuera. Sin CSD, sin PAC, sin
    folios propios, sin cancelaciones. Una prefactura **no toca el libro mayor** hasta que se
    concilia con el CFDI timbrado que llega por la sincronización.

    **No timbrar no significa no almacenar.** Todo comprobante que llega —bajado del SAT o subido
    por el usuario— se guarda completo en `CFDI` con su `xml` y su `pdf`, como siempre. Lo que
    Cifra no tiene es material de firma (CSD) ni contador de folios propio: `serie` y `folio` son
    atributos de solo lectura que se leen del comprobante.
22. **El XML subido pasa por el mismo parser, la misma validación y la misma tabla que el
    descargado.** Antes de contabilizarlo se valida contra el SAT: que el UUID exista, que esté
    vigente y que el receptor sea el contribuyente. Deduplicación por `uuid`, y `CFDI.origen`
    (`sat` | `xml_subido` | `prefactura_conciliada`) registra por dónde entró. Un XML subido a
    mano es la vía más fácil de meter un comprobante ajeno o ya cancelado.

---

## Estructura

```
apps/web            Next.js 15 App Router — UI + API, rutas /[contribuyente]/…
apps/trabajos       Inngest — SAT, bancos, validez, observadores, reportes
packages/core       ⭐ dominio puro: impuestos, contabilidad, validadores, observadores
packages/db         Prisma: esquema, migraciones, RLS, seed
packages/sat        cliente del SAT, aislado y falseable
packages/cfdi       catálogos versionados + validación de prefacturas
packages/ia         intenciones, acciones, comandos, narrador, pedagogía, hábitos
packages/ui         tokens.css + primitivas
```

## Diseño

- **Tipografía:** IBM Plex Sans (UI) + IBM Plex Mono (toda cifra, RFC, UUID y código de cuenta,
  con `tabular-nums`).
- **Iconos:** Phosphor, peso **duotone**, siempre. Sin emoji.
- **Tokens:** `packages/ui/tokens.css`. Modo noche con `data-theme="night"` en `<html>`.
- **Semántica del color, se respeta:**
  - petróleo `--accent` → acciones primarias y navegación
  - turquesa `--ia` → **solo** la voz de la IA
  - naranja quemado `--act` → **solo** acciones secundarias urgentes y presión de fechas
  - violeta `--data` → **solo** comparativos y datos en el tiempo
  - jade / ámbar / terracota → semáforo del sistema, nunca decorativo
- **Cada pantalla tiene tres presentaciones:** normal, primer uso y sin conexión al SAT.
- Prototipo de referencia: `handoff/Cifra v2.dc.html` (abrir en el navegador). Es **referencia de
  diseño**, no código para copiar. `support.js` no es parte del producto.

## Datos de prueba

`handoff/datos/seed.json` — el contribuyente ficticio completo (José Antonio Torres Delgado,
TODA7606258I7, agosto 2026), más una organización de despacho con tres clientes.

Invariantes: `ingresos − gastos = utilidad`, `utilidad / ingresos = margen`, `iva + isr = total`,
y el trimestre es la suma exacta de sus tres meses. La tabla de §3.7 del README es la suite de
regresión del motor fiscal.

## Convenciones

- Migraciones con `prisma migrate`, nunca `db push` fuera de local. `rls.sql` va dentro de una
  migración, no como paso manual.
- Todo cálculo fiscal nuevo llega con su prueba en `packages/core/__tests__`.
- Dinero en **centavos, entero** (`bigint`), nunca `float`. Se formatea en la orilla.
- **Fechas límite y de calendario son días, no instantes**: se guardan y se formatean en UTC
  (medianoche del día que representan). Solo las marcas de tiempo con hora —respuestas del SAT,
  timbrados, `Bitacora`— van en hora del centro de México, que es donde opera el SAT.
- El cliente del SAT solo se llama desde `apps/trabajos`, nunca desde `apps/web`.
