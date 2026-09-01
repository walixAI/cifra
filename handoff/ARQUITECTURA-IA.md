# Arquitectura de la capa de IA — Cifra

Tercer complemento, después de `ARQUITECTURA.md` y `ARQUITECTURA-MULTIINQUILINO.md`. Desarrolla
§6 del README y las reglas 3 y 4 de `CLAUDE.md`, que siguen siendo el contrato: toda respuesta
cita su origen, y la IA sugiere pero el usuario confirma.

---

## 0 · Qué quiere decir "AI native" aquí, y qué no

Hay una lectura fácil y equivocada: poner un chat en la esquina y que el modelo conteste sobre la
base de datos. Eso es una app con IA pegada encima, y además falla justo donde este producto no
puede fallar — un modelo que compone cifras se equivoca en un dígito y el usuario paga de más al
SAT.

La lectura útil son tres capacidades, ninguna de las cuales es un chat:

1. **La plataforma observa.** No solo los datos fiscales: también qué hace el usuario, qué
   ignora, qué le cuesta y cuánto tarda.
2. **La plataforma propone y ejecuta.** Una sugerencia sin botón es una queja. Cada sugerencia
   lleva una acción tipada que el sistema sabe ejecutar y revertir.
3. **La plataforma enseña.** El usuario típico no sabe qué es una póliza ni por qué el IVA de una
   factura que no ha cobrado no cuenta. Explicárselo **con sus propios números** es el producto,
   no la documentación.

Y una restricción que ordena todo lo demás:

> **El modelo no produce cifras. Produce prosa alrededor de cifras que el motor determinista ya
> calculó.** Ver §3 de este documento; se hace cumplir con un validador, no con un prompt.

El chat existe y está en el prototipo, pero es la superficie *menos* importante de las cuatro.
Las otras tres —la ruta guiada, la bandeja de sugerencias y el "explícame" pegado a cada cifra—
son las que hacen que alguien con conocimientos básicos llegue a su declaración.

---

## 1 · Las cuatro capas, y qué vive en cada una

```
   ┌──────────────────────────────────────────────────────┐
   │ 4 · Narrador (LLM)   prosa, tono, nivel de detalle    │  ← nunca inventa números
   ├──────────────────────────────────────────────────────┤
   │ 3 · Sugerencias      problema · impacto · acción      │  ← acción tipada, ejecutable
   ├──────────────────────────────────────────────────────┤
   │ 2 · Observaciones    detectores puros y deterministas │  ← con evidencia: IDs de registros
   ├──────────────────────────────────────────────────────┤
   │ 1 · Hechos           eventos de dominio + de uso      │  ← append-only
   └──────────────────────────────────────────────────────┘
              packages/core (1-2, puro)  ·  packages/ia (3-4)
```

Lo importante del corte: **las capas 1 y 2 no usan modelo**. Un detector de duplicados es una
consulta con `GROUP BY`, no un juicio de un LLM: es más barato, es determinista, se prueba, y
cuando el usuario pregunta "¿por qué me dices esto?" hay una respuesta exacta.

El modelo entra tarde y hace solo dos cosas: elegir qué observaciones merecen convertirse en
sugerencia ahora mismo, y escribir. Si mañana hay que cambiar de modelo o el proveedor se cae, el
producto se pone mudo pero no se vuelve incorrecto.

---

## 2 · Capa 1 — Hechos: eventos de dominio y eventos de uso

Sin esto no hay hábitos que detectar. Dos flujos, una sola tabla `Evento`, append-only,
particionada por mes:

**Eventos de dominio.** Ya existen implícitos en el sistema; hay que emitirlos explícitamente:
`cfdi.recibido`, `cfdi.cancelado_detectado`, `poliza.generada`, `movimiento.conciliado`,
`declaracion.estimada`, `sat.sincronizacion_fallida`. Se emiten desde `apps/trabajos` y desde los
handlers, en la misma transacción que el cambio. Si el evento se emite fuera de la transacción,
tarde o temprano hay eventos de cosas que no pasaron.

**Eventos de uso.** Los que casi nadie instrumenta y son los que dan los hábitos:
`pantalla.vista`, `sugerencia.mostrada`, `sugerencia.aceptada`, `sugerencia.descartada`,
`clasificacion.manual`, `explicacion.abierta`, `cierre.paso_completado`, `sesion.abandonada_en`.

De esos salen cosas concretas y accionables: este usuario clasifica todo el día 16 en pánico;
este otro nunca abre las notificaciones por correo pero sí entra los lunes; a este le cuesta
específicamente distinguir gasto deducible de activo fijo, porque ha corregido esa clasificación
nueve veces.

Reglas:

- **Sin PII en los metadatos del evento.** IDs de registros, sí; el nombre de un cliente, no. Los
  eventos se leen en agregado y viajan a analítica.
- **Retención distinta:** eventos de dominio se quedan (son auditoría); eventos de uso se
  agregan a `PerfilHabitos` y se purgan a los 12 meses.
- El usuario puede ver y apagar la observación de hábitos. Es la clase de recolección que hay que
  poder explicar sin incomodidad.

---

## 3 · Capa 2 — Observaciones: todo lo que la IA "sabe" es una fila

Una `Observacion` es un hecho detectado, tipado, con evidencia. Nunca prosa.

```ts
{
  tipo: 'cfdi_cancelado_contabilizado',
  severidad: 'neg',
  confianza: 1.0,                        // 1.0 = regla determinista
  periodo: '2026-08',
  impacto_centavos: 30100n,
  evidencia: { cfdi_ids: ['3B77…A20'], poliza_ids: ['D-0142'] },
  valores: { uuid: '3B77…A20', proveedor: 'Suministros Anáhuac',
             monto: 218000n, iva: 30100n, fecha_cancelacion: '2026-08-21' }
}
```

Familias de detectores (todos en `packages/core/observadores/`, puros, con pruebas):

| Familia | Ejemplos | Confianza |
|---|---|---|
| **Fiscales duros** | CFDI cancelado ya contabilizado (§3.4 — el más valioso), cuadre de IVA fuera (§3.5), póliza descuadrada, gasto sin CFDI (§3.6) | 1.0, determinista |
| **Anomalías** | CFDI duplicado (mismo monto+fecha+emisor), monto atípico (4.2× la mediana de la categoría), proveedor nuevo creciendo rápido, movimiento bancario huérfano | 0.6–0.95, estadística |
| **Oportunidad** | Retenciones a favor sin aprovechar, gastos deducibles no capturados según el patrón del contribuyente, factura por cobrar vencida | media |
| **De hábito** | "Clasificas siempre el día 16", "llevas 14 días sin conciliar", "sueles equivocarte en activo fijo" | media |
| **De riesgo de plazo** | Al ritmo actual, este contribuyente no llega al día 17 | derivada |

Cada observación tiene `impacto_centavos` cuando se puede cuantificar. Es lo que permite
**ordenar por dinero** en lugar de por severidad genérica, y es lo que hace que §6.3 del README
—Problema / Impacto / Acción— se pueda cumplir sin que el modelo invente el impacto.

Los detectores corren en `apps/trabajos` después de cada sincronización y cada generación de
pólizas, no por petición HTTP. La pantalla lee observaciones ya calculadas.

---

## 4 · Capa 3 — Sugerencias: una acción tipada, o no es sugerencia

Una `Sugerencia` toma una o varias observaciones y les pone un botón. Su campo central no es el
texto:

```ts
{
  observacion_ids: [...],
  accion: { tipo: 'revertir_poliza', payload: { poliza_id: 'D-0142' } },
  estado: 'pendiente',              // pendiente | aceptada | descartada | pospuesta | caducada
  requiere_confirmacion: true,
}
```

**Registro de acciones.** Un catálogo cerrado, versionado, en `packages/ia/acciones/`. Cada
acción declara: qué payload acepta (esquema Zod), qué autoridad necesita, si es reversible y
cómo, y qué rol puede ejecutarla. El LLM **elige entre acciones del registro**; nunca compone una
operación nueva.

| Nivel de autoridad | Qué incluye | Quién decide |
|---|---|---|
| **Automática** | Ordenar colas, priorizar la bandeja, precalcular explicaciones, marcar sugerencias de cuenta contable | La IA, sola |
| **Con confirmación** | Aplicar una clasificación, generar o revertir una póliza, conciliar un lote, marcar una factura como cobrada | La IA propone, el usuario acepta con un clic |
| **Con autorización explícita** | Presentar una declaración | Solo `propietario_fiscal`, vía `SolicitudPresentacion` (§7 del doc de inquilinos) |
| **Nunca** | Mover dinero, firmar con e.firma sin solicitud aprobada, borrar registros fiscales | — |

La regla 4 de `CLAUDE.md` —la IA sugiere, el usuario confirma— se implementa aquí y no en el
prompt: `requiere_confirmacion` es una propiedad de la acción en el registro, no una instrucción
en inglés que el modelo pueda ignorar un día malo.

**Toda acción ejecutada por sugerencia deja fila en `Bitacora`** con la sugerencia que la
originó. Cuando el usuario pregunte "¿por qué mi póliza cambió?", la respuesta es un renglón, no
una investigación.

### El presupuesto de atención

Una plataforma que observa todo y avisa de todo es una plataforma que el usuario silencia en la
segunda semana. Límites explícitos, en código:

- Máximo **3 sugerencias activas** en Inicio a la vez, ordenadas por `impacto_centavos`. El resto
  vive en la bandeja.
- Una sugerencia descartada **no vuelve** en el mismo periodo. Descartada dos veces, ese `tipo`
  se apaga para ese contribuyente y se registra el motivo.
- "Recordar después" es un estado real con fecha, no un cierre.
- Cerca del día 17 se filtra a lo que bloquea la declaración; las oportunidades esperan.
- Nada de notificar dos veces por el mismo canal. `PerfilHabitos` decide el **cuándo** y el
  **por dónde**; el contenido no cambia según el hábito, solo el momento.

---

## 5 · Capa 4 — El narrador, y el candado que lo hace confiable

El modelo escribe. Recibe observaciones, cifras ya calculadas y el nivel de detalle que toca, y
devuelve texto. El candado:

**Toda cifra del texto tiene que venir de un diccionario `valores` explícito. Un validador
posterior extrae los números de la salida y rechaza la respuesta si alguno no está en el
diccionario.** No se reintenta con un prompt más severo: se cae a la plantilla determinista, que
siempre existe.

```ts
const salida = await narrar({ observacion, valores, nivel, tono });
const inventados = cifrasEnTexto(salida).filter(c => !enDiccionario(c, valores));
if (inventados.length) {
  registrar('narrador.cifra_inventada', { observacion_id, inventados });
  return plantilla(observacion, valores);        // prosa fija, correcta, aburrida
}
```

Esto también resuelve §6.1: `fuentes` no lo escribe el modelo. Se arma con los conteos reales de
la consulta que alimentó la respuesta *—"246 CFDI · 182 movimientos bancarios · balanza cuadrada
en $412,860"—* y se adjunta después. Si el enrutador no pudo armar `fuentes`, no hay respuesta;
es lo que ya dice `IA_EXIGIR_CITACIONES` en `.env.example`.

**El enrutador de intenciones** (§6 del README) se mantiene como está: intenciones tipadas sobre
el libro mayor, no SQL generado. Fuera de alcance → lo dice y lista lo que sí puede contestar.
La clasificación de intención es un problema chico: un modelo pequeño y barato, con la lista
cerrada de intenciones; el modelo grande solo narra.

---

## 6 · La guía paso a paso: la ruta a la declaración

Es la parte que hace que "cualquier persona con conocimientos básicos" llegue al final, y es una
**máquina de estados determinista**, no una conversación. El checklist de 9 pasos de §3.6 del
README deja de ser una lista visual y se convierte en la entidad `Cierre`.

```
Cierre (contribuyente, periodo, tipo: mensual | anual)
  └── PasoCierre × 9
        estado:     bloqueado | pendiente | en_progreso | listo | omitido
        bloqueadores: Observacion[]     ← por qué no puede avanzar
        accion:     la acción tipada que lo resuelve
        explicacion: para qué sirve este paso, con SUS números
```

Los 9 pasos ya están definidos: CFDI sincronizados, XML procesados, gastos clasificados, bancos
conciliados, facturas por cobrar revisadas, pólizas generadas, balanza revisada, impuestos
estimados, estados financieros generados. Y al final, la declaración: estimada → preparada →
presentada → pagada, que ya existe en `Declaracion`.

Cómo se ve para el usuario que no sabe contabilidad:

- **Un paso a la vez, con el porqué antes del qué.** "Faltan 12 gastos por clasificar. Clasificar
  es decirle a Cifra de qué fue cada gasto, y de eso depende cuánto IVA puedes acreditar: ahora
  mismo hay $3,180 de IVA esperando en esos 12."
- **El bloqueador es la explicación.** Un paso bloqueado nunca dice "no puedes continuar": dice
  qué falta, cuánto vale, y trae el botón que lo arregla.
- **Estimación de esfuerzo honesta**, calculada del historial del propio usuario: "unos 6
  minutos, según lo que sueles tardar". Sale de `PerfilHabitos`, no de una constante.
- **Se puede omitir un paso**, con la consecuencia dicha en pesos.
- **La anual es la misma máquina** con más pasos y con la particularidad de §3.3: sueldos y
  salarios más actividad empresarial, que puede terminar en saldo a favor. Ese caso merece su
  propia narración, porque es la única vez que el producto da una buena noticia.

La ruta se recalcula cuando llegan eventos, no cuando se abre la pantalla.

---

## 7 · La capa pedagógica: explicar sin dar clases

Cada cifra de la interfaz es explicable. El prototipo ya tiene el bloque *"¿Cómo se calculó?"* en
turquesa; hay que generalizarlo a un gesto disponible en toda la app.

**Tres niveles, el usuario elige y se recuerda su elección:**

1. **Qué significa** — una frase. "El IVA acreditable es el IVA que ya pagaste en tus gastos y
   que puedes descontar del que cobraste."
2. **Cómo se calculó lo tuyo** — la aritmética con sus números y enlaces a los registros:
   `24,500 − 11,885 − 4,195 = 8,420`.
3. **Por qué la ley es así** — el fundamento, breve, con la referencia. Aquí y solo aquí el texto
   es general; va escrito y revisado por humanos, en `packages/ia/pedagogia/conceptos/`, no
   generado. Es contenido fiscal: si el modelo alucina un artículo de la LIVA, el daño es de
   confianza y es permanente.

Los conceptos son un grafo pequeño y curado (unos 60: IVA trasladado, acreditable, flujo de
efectivo, deducción autorizada, activo fijo, DIOT, póliza, partida doble, retención…), cada uno
con sus prerrequisitos. El nivel 2 se genera y **se cachea por (concepto, contribuyente,
periodo)**: es la misma explicación hasta que cambien las cifras, y generarla en cada carga de
pantalla es tirar dinero.

**El currículo se adapta al régimen**, no al nivel percibido de la persona. Nada de "modo
principiante": es condescendiente y además la gente aprende. Lo que sí se adapta es qué conceptos
se ofrecen primero, según lo que el usuario ha tenido que corregir —eso sí sale de los eventos.

---

## 8 · Multi-inquilino: lo que cambia con un despacho de por medio

- **La IA corre siempre bajo el cliente con alcance de `contexto()`.** El ensamblado de contexto
  para el modelo sale del mismo Prisma con RLS. Una fuga entre inquilinos por la ventana de la IA
  cuenta igual que por la de SQL.
- **Los embeddings y cachés llevan `contribuyente_id`** y se filtran por él antes de recuperar,
  no después.
- **Nada de entrenar ni afinar con datos de inquilinos.** Contractualmente, y también en el
  `.env`: sin retención en el proveedor.
- **El registro cambia con el rol, el contenido no.** A un `contador` no hay que explicarle qué
  es una póliza; a un `propietario_fiscal` sí. La capa pedagógica se atenúa por rol; las cifras y
  las citas son idénticas.
- **Para el despacho, la IA resume la cartera:** qué clientes están en riesgo de no llegar al 17
  y por qué. Se calcula desde `ResumenContribuyente` y las observaciones, con la misma regla de
  no inventar cifras.

---

## 9 · Costo, latencia y qué se precalcula

Un modelo en la ruta de cada petición es lento y caro, y este producto tiene pantallas que se
abren cien veces al día.

- **Precalculado en trabajos:** observaciones, sugerencias, los textos de los insights de Inicio,
  las explicaciones de nivel 2 del periodo abierto. La pantalla lee filas.
- **Bajo demanda:** el chat y las explicaciones de conceptos que el usuario abre por primera vez.
- **Caché por (tipo, valores hash, nivel).** Dos usuarios con el mismo problema y cifras distintas
  comparten estructura, no texto; pero un mismo usuario que reabre la misma explicación no
  regenera nada.
- **Presupuesto por contribuyente y por mes**, con degradación a plantillas deterministas cuando
  se agota. El producto sigue siendo correcto sin modelo; solo se vuelve más seco.

---

## 10 · Evaluación: la IA necesita su §3.7

El motor fiscal tiene la tabla de §3.7 como suite de regresión. La capa de IA necesita la suya, y
sin ella no hay forma de cambiar un prompt sin miedo.

- **Detectores:** pruebas unitarias normales. Son deterministas; no hay excusa.
- **Enrutador de intenciones:** un conjunto de ~150 preguntas reales etiquetadas con su intención.
  Métrica: exactitud de clasificación y tasa de "fuera de alcance" bien detectada.
- **Narrador:** sobre el seed, un conjunto dorado de preguntas con la respuesta correcta. Se
  verifica automáticamente lo verificable —que las cifras estén en el diccionario, que `fuentes`
  exista y cuadre, que no haya números inventados— y con juez-modelo lo demás.
- **En CI:** los dos primeros bloquean el merge. El tercero corre nocturno y reporta.

---

## 11 · Qué se agrega al monorepo

```
packages/core/observadores/     detectores puros, con pruebas   ← capa 2
packages/ia/
  ├─ intenciones/               enrutador tipado (§6 README)
  ├─ acciones/                  registro cerrado de acciones ejecutables
  ├─ narrador/                  plantillas + LLM + validador de cifras
  ├─ pedagogia/conceptos/       grafo curado, texto escrito por humanos
  ├─ habitos/                   agregación de eventos → PerfilHabitos
  └─ evaluacion/                conjuntos dorados
apps/trabajos/
  ├─ observar.ts                corre detectores tras cada sync
  ├─ sugerir.ts                 observaciones → sugerencias, con presupuesto
  ├─ ruta-recalcular.ts         estado del Cierre
  └─ habitos-agregar.ts         nocturno
```

---

## Apéndice · Reglas para agregar a `CLAUDE.md`

```markdown
14. **El modelo no produce cifras.** Toda cifra sale del motor determinista y viaja en un
    diccionario `valores`. Un validador rechaza cualquier número en la salida que no esté en ese
    diccionario y cae a plantilla. `fuentes` lo arma el enrutador con conteos reales, nunca el
    modelo.
15. **Todo lo que la IA "sabe" es una fila de `Observacion`**, tipada y con evidencia (IDs de
    registros). Los detectores son puros y viven en `packages/core/observadores`. El modelo elige
    y narra; no detecta.
16. **Una sugerencia sin acción tipada no se muestra.** Las acciones vienen de un registro cerrado
    en `packages/ia/acciones` que declara autoridad, esquema y reversibilidad.
    `requiere_confirmacion` es propiedad de la acción, no instrucción de prompt. Toda ejecución
    deja `Bitacora` con la sugerencia que la originó.
17. **Presupuesto de atención:** máximo 3 sugerencias activas; descartada no vuelve en el periodo;
    dos descartes apagan ese tipo. El hábito decide cuándo y por dónde avisar, nunca qué decir.
18. **El fundamento legal de la capa pedagógica lo escriben humanos** (`packages/ia/pedagogia`).
    El modelo explica los números del usuario, no la ley.
```
