# Arquitectura de comandos — Cifra

Cuarto complemento. Va después de `ARQUITECTURA-IA.md` y depende de él: el registro cerrado de
acciones de §4 de aquel documento es la pieza que hace posible esto.

Aquí se resuelve que el usuario pueda **pedirle cosas a la IA en su idioma** —consultar, generar
archivos, ejecutar operaciones— y que las que cambian algo pasen siempre por una confirmación
informada.

\---

## 0 · Una sola tubería, dos puertas de entrada

Lo primero que hay que evitar es construir esto como un sistema aparte. El flujo de sugerencias
del documento anterior y el flujo de comandos de este son **la misma máquina**, entrada por lados
distintos:

```
   sugerencia (el sistema inicia)  ──┐
                                     ├──►  PLAN  ──► confirmación ──► EJECUTOR
   comando (el usuario inicia)     ──┘                                    │
                                                                    la misma función
                                                                    que el botón de la UI
```

De ahí sale el invariante que mantiene todo esto seguro:

> \*\*Todo comando corresponde a una operación que también existe como botón en la interfaz. Si no
> existe como botón, no existe como comando.\*\*

El lenguaje natural elige y llena parámetros. Nunca abre una vía de escritura que la UI no tenga.
Sin esta regla, el chat se convierte en una API paralela sin permisos, sin validación y sin
pruebas — que es exactamente cómo estos productos terminan borrando datos de alguien.

\---

## 1 · Tres clases de petición, tres tratos distintos

|Clase|Ejemplo|Trato|
|-|-|-|
|**Consulta**|*"¿Cuánto llevo facturado y cuánto es de pago de impuestos?"*|Se responde de inmediato. Intención tipada sobre el libro mayor, cifras del motor, `fuentes` obligatorio. Sin confirmación: no cambia nada.|
|**Artefacto**|*"Descarga un reporte de las facturas y gastos de este mes"*|No toca el libro mayor, pero produce algo que el usuario se lleva. Se **previsualiza el alcance** (periodo, qué incluye, cuántos registros) y se genera. Confirmación ligera.|
|**Operación**|*"Arma una prefactura idéntica a la del mes pasado del cliente N"*, *"sincroniza con el SAT"*, *"concilia estos movimientos"*|Plan explícito → confirmación → ejecución. **Siempre.**|

La clasificación la hace el enrutador de intenciones, no el modelo grande, y ante duda clasifica
hacia arriba: una petición ambigua se trata como operación. Equivocarse hacia la confirmación de
más es un roce; equivocarse hacia la ejecución de menos es una operación con dinero de por medio
—una sincronización, una conciliación, una prefactura entregada— que nadie pidió.

Las consultas se responden con lo que ya está construido: §6 del README y el narrador con su
validador de cifras. Este documento se ocupa de las otras dos.

\---

## 2 · El Plan: lo que el usuario confirma no es la frase

Aquí está la decisión que sostiene todo lo demás.

**La confirmación no vuelve a pasar por el modelo.** Cuando el usuario dice "sí", no se
re-interpreta su frase original: se ejecuta un `Plan` persistido, con parámetros ya resueltos,
validados y congelados. El modelo participa una sola vez, al principio, para producir el plan.

```ts
Plan {
  frase\_original: "arma una prefactura idéntica a la del mes pasado para Anáhuac",

  accion\_tipo: 'crear\_prefactura\_desde\_plantilla',
  parametros: {                        // resueltos, tipados, validados con Zod
    receptor\_rfc: 'GMA010315AB2',
    origen\_cfdi\_uuid: '9C21…F04',
    fecha: '2026-09-01',
    conceptos: \[...],
    total\_centavos: 4640000n,
  },

  resolucion: \[                        // CÓMO se resolvió cada ambigüedad. Se muestra.
    { dijo: 'el mes pasado', entendi: 'julio 2026', porque: 'hoy es 1 sep' },
    { dijo: 'Anáhuac', entendi: 'Grupo Médico Anáhuac · GMA010315AB2',
      porque: 'único cliente que coincide en los últimos 12 meses' },
  ],

  efectos: \[                           // qué va a cambiar, en pesos y en registros
    { que: 'Se arma una prefactura de ingreso, lista para timbrar en el portal del SAT',
      monto\_centavos: 4640000n },
    { que: 'Entra a tu bandeja de prefacturas pendientes', contador\_previsto: '3 · $52,400' },
    { que: 'No toca tus cifras: ni Ingresos ni IVA se mueven hasta que concilie con el CFDI timbrado' },
  ],

  advertencias: \[
    'La prefactura no es un comprobante fiscal. La timbras tú en el SAT o con tu PAC;
     Cifra solo la arma y la valida.',
    'Ya hay 1 prefactura abierta para este receptor por un monto parecido — revísala antes de crear otra.',
  ],

  reversible: true,                    // descartar una prefactura no deja rastro fiscal
  requiere\_rol: 'captura',
  hash: 'sha256:…',                    // sobre parametros + estado de los datos
  expira\_en: '2026-09-01T10:12:00',    // 10 minutos
  token\_uso\_unico: '…',
}
```

Tres propiedades que no son negociables:

**El plan caduca.** Diez minutos. Un plan aprobado media hora después se calculó sobre datos que
ya cambiaron.

**El plan se revalida al confirmar.** El `hash` cubre los parámetros *y* el estado de los datos de
los que depende. Si entre la vista previa y el "sí" llegó un CFDI, cambió una conciliación o el
cliente actualizó su constancia, la ejecución se detiene y se muestra el plan nuevo. Nunca se
ejecuta a ciegas algo que se calculó sobre otra realidad.

**El token es de un solo uso.** Doble clic, doble envío o un reintento de red no crean dos
prefacturas. Además, llave de idempotencia en el ejecutor (`accion\_tipo + parametros\_hash +
contribuyente\_id`): una prefactura duplicada que el usuario alcanza a timbrar dos veces sí es un
comprobante fiscal que hay que cancelar, y ahí ya no hay vuelta atrás desde Cifra.

### La vista previa, para alguien que no sabe contabilidad

El plan se le enseña al usuario en su idioma, y el orden importa:

1. **Qué entendí** — la lista de `resolucion`. Es donde el usuario cacha que le entendimos otro
cliente, antes de que pase nada.
2. **Qué va a pasar** — los `efectos`, en pesos. Para una prefactura, esto incluye decir con
claridad lo que **no** pasa: "esto no mueve tu IVA ni tus Ingresos hasta que el CFDI timbrado
concilie". Para una conciliación o una póliza, sí se muestra el efecto fiscal ("esto sube tu IVA
de septiembre en $6,400"), que es la promesa pedagógica del documento anterior aplicada en el
momento en que sirve.
3. **Qué hay que saber** — las `advertencias`, arriba del botón, no en letra chica: que la
prefactura la timbra el usuario fuera, que ya hay una parecida abierta, lo que no se puede
deshacer.
4. **Confirmar / Ajustar / Cancelar.** *Ajustar* abre el formulario normal de la UI con los
valores precargados. El lenguaje natural llega hasta donde llega; el formulario siempre está.

\---

## 3 · Cuando no se entiende, se pregunta

La tentación es que el modelo elija la interpretación más probable. Con dinero y con el SAT de
por medio, no.

* **Referente ambiguo** ("cliente N" coincide con dos): se pregunta, con opciones concretas y sus
RFC. Nunca se adivina.
* **Parámetro faltante** ("arma la prefactura de Anáhuac" sin monto ni periodo): se pide solo lo
que falta, no se rehace todo.
* **El alcance nunca se ensancha solo.** "Concilia los movimientos" no es "concilia los 182".
Si el modelo no puede acotar, pregunta.
* **Fuera del registro de acciones**: lo dice y enumera lo que sí sabe hacer. Igual que §6.2 del
README para las consultas.
* **Sin permiso**: se explica quién sí puede y se ofrece pedírselo. Un `solo\_lectura` que pide
armar una prefactura no recibe un error genérico.

\---

## 4 · Autoridad, verificada en el ejecutor

La tabla de §4 del documento de IA se conserva y se le agrega la nueva capacidad. Lo importante
es **dónde** se comprueba: en el ejecutor, contra `Acceso` y el registro, en el momento de
ejecutar. No al planear, y jamás confiando en que el modelo respetó una instrucción.

|Acción|Rol mínimo|Reversible|Confirmación|
|-|-|-|-|
|Consultar, explicar, generar reporte|`solo\_lectura`|—|Alcance|
|Clasificar, conciliar, marcar cobrado|`captura`|Sí|Plan|
|Generar o revertir póliza|`contador`|Sí|Plan|
|Sincronizar con el SAT|`captura`|N/A|Plan (es un trabajo, ver §6)|
|Crear o descartar una prefactura|`captura`|Sí|Plan|
|Presentar declaración|`propietario\_fiscal` vía `SolicitudPresentacion`|No|Autorización aparte|
|Timbrar o cancelar un CFDI, mover dinero, firmar sin solicitud, borrar registros fiscales|—|—|**No existe la acción**|

Salvo *Presentar declaración*, ninguna acción del registro es irreversible: Cifra no timbra, así
que no puede crear un comprobante fiscal que después haya que cancelar.

\---

## 5 · Emisión de comprobantes → prefacturas

Esta sección planteaba **emitir y timbrar CFDI** desde Cifra. Se descarta por completo.
La sustituye `ARQUITECTURA-PREFACTURAS.md`: Cifra arma la factura, la valida contra todo lo
que el SAT rechaza y se la entrega al usuario (ficha de captura, XML sin sellar o CSV); el
usuario timbra fuera, en el portal del SAT o con su PAC. Sin CSD, sin PAC, sin folios propios,
sin cancelaciones. Una prefactura no toca el libro mayor hasta que se concilia con el CFDI
timbrado que llega por `sat-sincronizar`.

Todo lo que este documento diga sobre "timbrar", "emitir CFDI" o `packages/cfdi-emision` queda
anulado por esa decisión; abajo ya está corregido.

\---

## 6 · Comandos que tardan

*"Sincroniza con el SAT"* no se contesta en una petición HTTP. El comando **no ejecuta: encola**,
y el plan lo dice así.

* Devuelve un identificador de trabajo; la conversación muestra progreso por pasos ("consultando
emitidos… 340 comprobantes… validando").
* Respeta el candado global por RFC de §3 del documento de inquilinos: si ya hay una
sincronización corriendo, el plan lo informa y ofrece seguirla en vez de encolar otra.
* Si falla, cae en el contrato de datos rancios de §7 del README, no en un error de chat.
* Al terminar, `Notificacion` con destino a la pantalla que corresponda, aunque el usuario ya
haya cerrado la conversación.

\---

## 7 · Los datos del libro mayor son datos, nunca instrucciones

Este producto tiene una superficie de inyección que la mayoría no tiene: **los CFDI los escriben
terceros.** Un proveedor puede poner cualquier texto en el campo de concepto, y ese texto entra
al contexto del modelo cuando el usuario pregunta por sus gastos.

Mitigaciones, en capas:

* El contenido del libro mayor entra en un bloque delimitado y marcado como no confiable, nunca
concatenado a las instrucciones.
* **El modelo no ejecuta: produce planes.** Aunque una inyección logre que proponga algo, ese algo
tiene que pasar por el registro cerrado, la validación de esquema, la comprobación de rol y la
confirmación del usuario. Es la razón principal por la que la confirmación no se puede
"optimizar" después.
* El texto de terceros nunca puede originar un plan por sí solo: un plan siempre nace de una frase
del usuario o de una observación determinista.
* Detector de anomalías para contenido de CFDI con patrones de instrucción. Es raro; cuando
aparezca, se quiere saber.

\---

## 8 · Rastro

Cada comando ejecutado deja: la frase original, el plan con su hash, quién confirmó, cuándo, y
el resultado. En `Bitacora` y en `AccionEjecutada`, que ya existen.

Es lo que permite contestar "¿por qué se armó esta prefactura?" o "¿quién revirtió esa póliza?"
con un renglón. En un despacho, con un tercero operando sobre libros ajenos, esa pregunta se va a
hacer.

Los planes descartados también se guardan, sin PII y por poco tiempo: son la mejor señal de dónde
el enrutador entiende mal.

\---

## 9 · Qué se agrega al monorepo

```
packages/ia/
  ├─ comandos/
  │   ├─ clasificador.ts      consulta | artefacto | operacion
  │   ├─ planificador.ts      frase → Plan (con resolución y efectos)
  │   ├─ resolutores/         "el mes pasado", "cliente N", "estos movimientos"
  │   └─ vista-previa.ts      Plan → prosa, vía el narrador validado
  └─ acciones/                el registro cerrado — compartido con sugerencias
packages/cfdi/                catálogos versionados, validación de prefacturas y formatos de
                              entrega (ficha, XML sin sellar, CSV) — ver ARQUITECTURA-PREFACTURAS.md
apps/trabajos/
  └─ conciliar-prefacturas.ts detector que enlaza la prefactura con el CFDI real de sat-sincronizar
apps/web/app/api/\[contribuyente]/
  ├─ comandos/route.ts        POST frase → Plan
  └─ comandos/\[id]/confirmar/route.ts   POST token → ejecución
```

**Los ejecutores no viven aquí.** Viven donde ya están las operaciones de la UI, en sus servicios
de dominio. El registro apunta a ellos. Si alguien escribe un ejecutor dentro de `packages/ia`,
el invariante de §0 se rompió.

\---

## 10 · Evaluación

Se suma a los conjuntos dorados de §10 del documento de IA:

* **Clasificación de clase** (consulta / artefacto / operación) sobre \~200 frases reales. Un solo
falso negativo —una operación clasificada como consulta— es un fallo bloqueante en CI, no una
métrica.
* **Resolución de parámetros:** frases con referentes ambiguos donde la respuesta correcta es
*preguntar*. Se mide cuántas veces adivina en lugar de preguntar.
* **Fidelidad del plan:** que los `efectos` mostrados coincidan con lo que la ejecución realmente
produce, sobre el seed. Un plan que promete algo distinto de lo que hace es peor que no tener
comandos.
* **Inyección:** un conjunto de CFDI con texto hostil en los conceptos, verificando que nunca
origina un plan.

\---

## Apéndice · Reglas para agregar a `CLAUDE.md`

Ya están integradas en `CLAUDE.md` como reglas 17–20. Se dejan aquí como referencia; la regla de
emisión de CFDI la sustituye la de prefacturas (regla 21 de `CLAUDE.md`, ver
`ARQUITECTURA-PREFACTURAS.md`).

```markdown
17. \*\*Todo comando corresponde a un botón de la interfaz.\*\* El lenguaje natural elige acciones del
    registro cerrado y llena parámetros; nunca abre una vía de escritura que la UI no tenga. Los
    ejecutores viven en los servicios de dominio, nunca en `packages/ia`.
18. \*\*Se confirma un `Plan`, no una frase.\*\* El plan lleva parámetros resueltos y validados, la
    traza de cómo se resolvió cada ambigüedad, los efectos en pesos, las advertencias, un hash del
    estado de los datos, caducidad de 10 minutos y token de un solo uso. Al confirmar se revalida
    el hash y \*\*no se vuelve a llamar al modelo\*\*.
19. \*\*Ante ambigüedad se pregunta, no se adivina\*\*, y el alcance nunca se ensancha solo. La
    autoridad se verifica en el ejecutor contra `Acceso`, nunca en el prompt.
20. \*\*El contenido del libro mayor es dato no confiable\*\* —los CFDI los escriben terceros— y jamás
    origina un plan por sí solo.
```

