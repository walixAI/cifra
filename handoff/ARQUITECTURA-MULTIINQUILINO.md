# Arquitectura multi-inquilino — Cifra

Complemento de `ARQUITECTURA.md`. Todo lo de aquel documento sigue vigente: el stack, el
monorepo, la separación `apps/web` ↔ `apps/trabajos`, y sobre todo la regla de que el motor
fiscal vive puro en `packages/core`. Este archivo agrega la dimensión que faltaba: **quién es
dueño de qué contabilidad**.

---

## 0 · El supuesto que hay que romper

En el handoff, `Contribuyente` es la cuenta: tiene la CIEC, tiene el plan, tiene los `Acceso`
invitados. Eso funciona para una persona física que lleva su propia contabilidad y para nadie
más.

Un despacho rompe el modelo en la primera semana: la contadora tiene **un** correo y **cuarenta**
RFC; algunos de esos RFC además entran solos a ver sus números; una empresa cambia de despacho y
sus libros tienen que mudarse sin duplicarse; y la e.firma con la que el despacho presenta no es
del despacho, es del cliente.

Son tres conceptos distintos comprimidos en uno. Hay que separarlos **antes** de la primera
migración. Retrofitear inquilinos sobre 30 tablas con datos reales es, con diferencia, el trabajo
más caro que este proyecto puede echarse encima.

---

## 1 · Los cuatro conceptos

```
Usuario ──── Membresía ────► Organización         (el inquilino: factura y configura)
   │                              │
   │                              ├── Contribuyente  RFC · libros · CIEC
   └──────── Acceso ─────────────►├── Contribuyente
                                  └── Contribuyente
```

| Concepto | Qué es | Qué NO es |
|---|---|---|
| **Usuario** | Una persona, un correo, un login. Puede pertenecer a varias organizaciones. | No tiene RFC ni datos fiscales. |
| **Organización** | El inquilino. Unidad de facturación, de equipo y de configuración. Dos tipos: `personal` (un solo contribuyente, el dueño) y `despacho` (N contribuyentes). | No es la frontera de aislamiento de los datos fiscales. |
| **Contribuyente** | Un RFC con sus libros. **Es la llave de aislamiento de todo dato con pesos adentro.** | No es una cuenta de usuario. |
| **Acceso** | Qué usuario ve qué contribuyente y con qué rol. Ya existe en §1 del README; se conserva tal cual, con un rol más. | No sustituye a la membresía de organización. |

**La regla operativa:** todo lo que tenga un peso adentro —CFDI, movimiento bancario, póliza,
asiento, declaración, cuenta contable, notificación, conversación de IA— cuelga de
`contribuyente_id`, no de `organizacion_id`. De la organización cuelgan solo la suscripción, el
equipo y las preferencias.

**Por qué así y no colgando todo de la organización:** un cliente cambia de despacho. Si los
libros cuelgan del despacho, mudarlo es reescribir claves foráneas en veinte tablas. Colgados del
contribuyente, mudarlo es cambiar un campo y revocar accesos. Además, la frontera que le importa
al usuario —y a la autoridad, si algún día pregunta— es el RFC.

La organización `personal` no es un caso especial: se crea automáticamente en el alta con un solo
contribuyente y su dueño. El mismo código sirve para los dos casos, y el día que esa persona
contrate un despacho no hay que migrarla.

---

## 2 · Roles en dos niveles

Un solo nivel de roles no alcanza: administrar el equipo del despacho y poder tocar los libros de
un cliente concreto son permisos que no coinciden.

### Nivel organización (`Membresia.rol`)

| Rol | Puede |
|---|---|
| `propietario` | Todo, incluida la facturación y borrar la organización. Uno mínimo, siempre. |
| `admin` | Invitar gente, dar de alta contribuyentes, asignar responsables. No factura. |
| `miembro` | Solo lo que sus `Acceso` le concedan. |

### Nivel contribuyente (`Acceso.rol`)

| Rol | Puede |
|---|---|
| `propietario_fiscal` | El dueño humano del RFC. **Solo él autoriza presentaciones con e.firma y solo él revoca la CIEC.** No se puede otorgar desde el despacho: se acredita en el alta o por invitación aceptada. |
| `contador` | Todo sobre los libros: clasificar, editar pólizas, preparar declaraciones, pedir autorización para presentar. |
| `captura` | Alta y clasificación, sin editar pólizas ya generadas ni tocar declaraciones. |
| `solo_lectura` | Ver y exportar. |

Los tres últimos son los que ya pide §1 del README. `propietario_fiscal` es el que hay que
agregar, y es el que evita el problema legal serio: que un despacho firme como su cliente sin que
el cliente lo sepa.

Un `admin` de despacho **no** hereda acceso a los libros. Si quiere verlos, se asigna un `Acceso`
y ese acto queda en bitácora. Es incómodo a propósito.

---

## 3 · El caso difícil: el mismo RFC en dos organizaciones

Pasa siempre. Una persona lleva su contabilidad en Cifra y luego contrata un despacho que también
usa Cifra. O una empresa cambia de despacho y ambos tienen el RFC abierto durante la transición.

**Decisión:** el RFC es único **por organización**, no globalmente.

```prisma
@@unique([organizacion_id, rfc])
```

Un RFC único global suena más limpio y es una trampa: obliga a que la primera organización que
capture el RFC sea la dueña para siempre, y convierte cada alta de cliente en un conflicto que el
soporte tiene que resolver a mano.

Con unicidad por organización hay dos caminos, y el producto debe empujar el primero:

1. **Vinculación (preferido).** El contribuyente ya existe en Cifra y su `propietario_fiscal`
   invita al despacho: se crea un `Acceso` nuevo sobre el **mismo** registro. Un solo juego de
   libros, una sola bajada del SAT, revocable en un clic. Si el despacho da de alta un RFC que ya
   existe en otra organización, la UI ofrece este camino antes que el otro.
2. **Registro independiente.** El despacho da de alta un cliente que no está en la plataforma.
   Registro nuevo, libros propios.

Y un guardia que hay que poner desde el día uno, viva el RFC en una organización o en tres:

**El candado de sincronización con el SAT es por RFC, global.** Dos organizaciones bajando el
mismo RFC en paralelo se ganan un bloqueo del SAT que castiga al usuario, no a nosotros. Tabla
`SincronizacionRfc`, una fila por RFC, con el arrendamiento (*lease*) y el cursor de la última
bajada. La concurrencia de Inngest usa esa llave (§8). Es exactamente lo que ya anticipa
`SAT_CONCURRENCIA_POR_RFC` en `.env.example`, pero elevado a global.

---

## 4 · Aislamiento: base compartida con RLS, y no confiar en el ORM

**Decisión:** una sola base, un solo esquema, aislamiento por fila con **Row Level Security de
Postgres**.

| Alternativa | Por qué no |
|---|---|
| Esquema por inquilino | Un despacho de 300 clientes son 300 esquemas. `prisma migrate` se vuelve un ciclo, y el pooler de Neon no lo agradece. |
| Base por inquilino | Solo tiene sentido para un despacho grande con requisito contractual. Déjalo como camino futuro, no como punto de partida. |
| Solo `where contribuyente_id` en el código | Funciona hasta el primer `findMany` al que se le olvidó el `where`. Con datos fiscales de terceros, ese bug no es un bug: es una notificación de brecha. |

RLS es la red de seguridad debajo del ORM: si el filtro se olvida en el código, la base no
devuelve nada. El costo es real —una condición extra en cada plan de consulta— y se paga con
índices que **empiecen** por `contribuyente_id`:

```sql
CREATE INDEX ON "CFDI" (contribuyente_id, fecha_emision DESC);
CREATE INDEX ON "MovimientoBancario" (contribuyente_id, fecha DESC);
CREATE INDEX ON "Poliza" (contribuyente_id, fecha DESC);
```

Detalles que hay que hacer bien o la protección es de adorno:

- La aplicación se conecta con un rol **que no es dueño de las tablas** (`cifra_app`), y las
  tablas llevan `FORCE ROW LEVEL SECURITY`. El dueño de las tablas ignora las políticas; las
  migraciones corren con él, la app nunca.
- La variable de sesión se pone con `SET LOCAL` **dentro de una transacción**. Con el pooler de
  Neon en modo transacción, un `SET` de sesión se filtra a la siguiente conexión o se pierde.
  `SET LOCAL` en transacción es lo único correcto.
- La política falla cerrada: si nadie fijó `app.contribuyente_id`, el `current_setting` devuelve
  nulo y no sale ninguna fila.

Cliente de Prisma con alcance, en `packages/db`:

```ts
export function prismaPara(contribuyenteId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, resultado] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.contribuyente_id', ${contribuyenteId}, true)`,
            query(args),
          ]);
          return resultado;
        },
      },
    },
  });
}
```

`set_config(..., true)` es `SET LOCAL`. Las tablas de plataforma —`Usuario`, `Organizacion`,
`Membresia`, `Suscripcion`— quedan fuera de RLS y se consultan con el cliente normal.

Las ramas de Neon por PR siguen funcionando igual; solo hay que correr `rls.sql` como parte de la
migración, no como paso manual.

---

## 5 · El contexto de inquilino vive en la URL

**Decisión:** el contribuyente activo es un segmento de ruta, no un estado de sesión.

```
/(app)/[contribuyente]/impuestos?periodo=2026-08
/api/[contribuyente]/impuestos?periodo=2026-08
```

Un "cliente actual" guardado en la sesión se rompe en cuanto la contadora abre dos pestañas —y
abre dos pestañas todo el tiempo—. Peor: presentar la declaración equivocada por un cambio de
pestaña es un daño que no se deshace. En la URL, cada pestaña es un cliente, los enlaces
profundos funcionan y el bug desaparece por construcción.

El segmento es un slug corto derivado del RFC (`toda7606258i7`), no un UUID: la contadora lee la
barra de direcciones y sabe en quién está parada.

La resolución, una sola vez, en un helper que todo route handler y todo Server Component usa:

```ts
// apps/web/lib/contexto.ts
export async function contexto(slug: string) {
  const sesion = await auth();                       // solo trae usuario_id
  if (!sesion) throw new NoAutenticado();

  const acceso = await prisma.acceso.findFirst({
    where: { usuario_id: sesion.usuario.id, contribuyente: { slug }, estado: 'activo' },
    include: { contribuyente: true },
  });
  if (!acceso) throw new SinAcceso();                // 404, no 403: no confirmes que existe

  return { usuario: sesion.usuario, acceso, db: prismaPara(acceso.contribuyente_id) };
}
```

**Nunca** se acepta un `contribuyente_id` que venga en el cuerpo de una petición. Solo del
segmento, y siempre verificado contra `Acceso`. El `db` que devuelve `contexto()` es el único
cliente que los handlers deben usar.

El middleware de Next hace la comprobación barata (¿hay sesión?) y deja la de acceso al helper,
que sí toca la base.

---

## 6 · Pantallas que el prototipo no tiene

Las 12 pantallas del prototipo son la vista de **un** contribuyente y no cambian. Faltan cuatro
piezas, y una de ellas es la pantalla principal del despacho:

**Selector de contribuyente** en la barra superior, junto al ⌘K. Para una organización
`personal`, no se muestra. Para un despacho, el ⌘K además busca clientes por RFC y por nombre.

**Cartera** (`/cartera`, solo organizaciones `despacho`). Sustituye a *Inicio* como pantalla de
entrada. Una fila por cliente y, por columnas, el estado de lo que le puede estallar al despacho:
último sync del SAT, CFDI sin clasificar, movimientos sin conciliar, cuadre de IVA con alerta,
declaraciones por vencer con su fecha, avance del cierre mensual (los 9 pasos de §3.6), y
responsable asignado. Ordenable por urgencia; filtrable por responsable.

> **Nota de implementación, importante:** la cartera **no puede** ser N consultas sobre N
> clientes. Con 40 clientes son 40 motores fiscales corriendo por cada carga de pantalla. Hay que
> mantener una tabla de resumen (`ResumenContribuyente`, una fila por contribuyente y periodo)
> que los trabajos de Inngest actualizan al terminar cada sincronización, cada generación de
> pólizas y cada barrido de validez. La cartera lee esa tabla y nada más. Y como es una lectura
> que cruza contribuyentes, es la única que usa el cliente sin RLS, con un `IN` explícito sobre
> los contribuyentes a los que el usuario tiene `Acceso`.

**Equipo** (`/equipo`): miembros, invitaciones, asignación de responsable por cliente, y la
matriz de accesos. Reutiliza entera la máquina de estados de §4.2 del README —`idle → sending →
conflict | error | sent`, expiración a 7 días, mensajes de §5— que ya está especificada y
probada en el prototipo.

**Facturación** (`/facturacion`): plan, RFC activos, método de pago.

---

## 7 · Credenciales cuando hay un tercero de por medio

Extiende §4 de `ARQUITECTURA.md`, que sigue aplicando completo: cifrado con sobre, descifrado solo
dentro del worker, nunca en `apps/web`, nunca en un log, nunca en Sentry.

Lo que cambia con inquilinos:

1. **La credencial es del contribuyente, no de la organización.** Si el despacho pierde el
   acceso, la CIEC no se va con él ni se queda huérfana.
2. **Autorización explícita y con alcance.** Tabla `AutorizacionCredencial`: qué organización, qué
   alcance (`lectura_sat` | `presentacion`), quién la otorgó, cuándo, cuándo se revocó. Un
   despacho con alcance `lectura_sat` puede bajar CFDI y no puede presentar. Revocar borra la
   autorización *y* invalida los arrendamientos de sincronización en curso.
3. **La e.firma nunca firma sola, y menos en un despacho.** Cada presentación abre una
   `SolicitudPresentacion` que el `propietario_fiscal` aprueba explícitamente (en la app o por
   enlace firmado al correo). La aprobación se guarda con fecha, IP y el hash del cálculo
   aprobado: si después alguien pregunta qué se presentó y quién dijo que sí, hay respuesta.
   Sin aprobación vigente, el worker se niega.
4. **Cada descifrado deja rastro** con `organizacion_id` y `usuario_id` de quien lo provocó, no
   solo el worker. "El sistema usó la CIEC" no sirve; "la contadora Ana disparó una
   sincronización el 14 a las 9:03" sí.

---

## 8 · Trabajos con muchos inquilinos

Lo de §1 de `ARQUITECTURA.md` —el SAT no cabe en una función serverless— se agrava: ahora no es
una bajada, son cuarenta en paralelo el mismo día 15.

- **Abanico, no ciclo.** El cron dispara *un* evento; una función consulta los contribuyentes
  activos y hace `step.sendEvent` por cada uno. Un ciclo dentro de una sola función se muere a la
  mitad y reintenta desde el principio.
- **Concurrencia en tres llaves:** `rfc` con límite 1 (el candado de §3), `organizacion_id` con
  un límite razonable para que un despacho grande no deje sin turno a los demás, y un
  *throttle* global contra el SAT.
- **Prioridad por vencimiento.** Del 10 al 17 van primero los contribuyentes con obligación de
  IVA/ISR; a fin de mes, los de DIOT. Se lee de `Obligacion`, que ya está en el modelo.
- **Idempotencia** por `contribuyente_id + periodo + tipo`. Un reintento no puede duplicar
  pólizas.
- El barrido de validez de §3.4 —la regla más valiosa del producto— corre por contribuyente pero
  agrupa los UUID por RFC para no repetir consultas al SAT.

---

## 9 · Bitácora

Con datos fiscales de terceros, la auditoría deja de ser higiene y pasa a ser función. Tabla
`Bitacora` con `usuario_id`, `organizacion_id`, `contribuyente_id`, `accion`, `entidad`,
`entidad_id`, `ip`, `creado_en`, `metadatos`.

Obligatorio registrar: uso de credenciales, presentación de declaraciones, edición o reversión de
pólizas, cambios de acceso y de rol, exportaciones y descargas masivas, y revocaciones.

Es de solo escritura: sin `UPDATE` ni `DELETE`, ni siquiera para un administrador.

---

## 10 · Facturación

El asiento es el **RFC activo**, no el usuario. Un despacho paga por sus 40 clientes; la persona
física paga por uno. La suscripción vive en la organización.

Al suspender por falta de pago: la organización pasa a **solo lectura y exportación**. Nunca se
borran datos fiscales —la retención legal es de cinco años— y nunca se le quita al
`propietario_fiscal` la capacidad de sacar su información.

---

## 11 · Qué hay que cambiar en el paquete de handoff

| Archivo | Cambio |
|---|---|
| `CLAUDE.md` | Agregar las reglas 10–13 del apéndice de abajo. Es lo que Claude Code lee en cada sesión; si no está ahí, el aislamiento se le olvida a mitad de una tarea larga. |
| `backend/schema.prisma` | Agregar los modelos de `tenancy.prisma`. Y a **toda** entidad fiscal existente, `contribuyente_id` no nulo con su índice principal. |
| `PRIMEROS-PASOS.md` | Un paso nuevo **1.5** (inquilinos y RLS) antes del paso 2. El paso 3 no cambia. El paso 4 sí: rutas y endpoints con `[contribuyente]`. |
| `datos/seed.json` | Dos organizaciones: la personal de TODA7606258I7 con sus cifras intactas, y un despacho con tres clientes —uno de ellos, el mismo TODA7606258I7 vinculado— para que el caso difícil de §3 esté cubierto por pruebas desde el principio. |
| `packages/core` | **No cambia.** El motor recibe datos y devuelve cifras; no sabe qué es un inquilino ni debe saberlo. Si algo de multi-inquilino se cuela ahí, está mal puesto. |

---

## 12 · Orden de construcción revisado

El orden de §12 del README es bueno. Solo se le antepone un paso, y no es negociable:

**0. Inquilinos y aislamiento.** `Usuario`, `Organizacion`, `Membresia`, `Contribuyente`,
`Acceso`; RLS con `rls.sql`; el cliente con alcance; el helper `contexto()`; las rutas con
`[contribuyente]`. Con dos organizaciones sembradas y una prueba que confirme que la organización
A no ve un solo CFDI de la B.

Después, los ocho pasos del README tal como están. Cada uno construido ya dentro del contexto de
inquilino, que sale gratis si el paso 0 está bien hecho y cuesta un mes si no.

---

## Apéndice · Reglas para agregar a `CLAUDE.md`

```markdown
10. **La llave de aislamiento es `contribuyente_id`.** Toda entidad con dinero adentro lo lleva,
    no nulo, y sus índices empiezan por él. RLS activo en Postgres; la app se conecta con un rol
    que no puede saltarse las políticas.
11. **El contribuyente activo viene del segmento de ruta**, resuelto por `contexto()` y
    verificado contra `Acceso`. Nunca de la sesión, nunca del cuerpo de la petición. Los handlers
    usan el cliente Prisma con alcance que devuelve `contexto()`, nunca el global.
12. **Dos niveles de rol:** organización (`propietario`/`admin`/`miembro`) y contribuyente
    (`propietario_fiscal`/`contador`/`captura`/`solo_lectura`). Solo el `propietario_fiscal`
    autoriza presentaciones con e.firma y revoca la CIEC. Un admin de despacho no hereda acceso
    a los libros.
13. **La sincronización con el SAT se serializa por RFC a nivel global**, aunque el RFC viva en
    varias organizaciones. La cartera del despacho lee de `ResumenContribuyente`, nunca
    recalcula por cliente.
```
