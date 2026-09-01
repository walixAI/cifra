# Prefacturas — Cifra

**Sustituye a §5 de `ARQUITECTURA-COMANDOS.md`.** Ahí se planteaba emitir CFDI; se descarta.
Cifra prepara la factura, la valida y se la entrega al usuario; **el usuario la timbra en el
portal del SAT o con su propio PAC.**

Lo que sale del proyecto: CSD, PAC, serie y folio propios, timbrado, cancelación con aceptación
del receptor, y la posibilidad de generarle a alguien una obligación fiscal por un error de
software. La acción irreversible desaparece del sistema.

Lo que entra en su lugar es un problema más chico pero real: **cerrar el ciclo.**

---

## 1 · El ciclo, y dónde se rompe si no se diseña

```
  usuario pide  ──►  Cifra arma      ──►  Cifra valida   ──►  entrega
  (o Cifra                borrador          contra lo que        ficha / XML
   sugiere)                                 el SAT rechaza       sin sellar
                                                                     │
                                                     el usuario timbra fuera
                                                                     │
  póliza  ◄── conciliación ◄── sat-sincronizar trae el CFDI real ◄────┘
              por coincidencia      (hasta 6 h después)
```

El punto frágil es el último tramo. Sin él pasan tres cosas, todas malas: prefacturas que
quedaron timbradas y siguen apareciendo como pendientes; el usuario vuelve a generar la misma y
factura dos veces; y prefacturas que nunca se timbraron y nadie se enteró hasta que la
declaración salió corta.

**La conciliación de prefacturas es el mismo patrón que la conciliación bancaria** que ya está en
el producto (`sugerencia_conciliacion` con `score` y `motivo`, §1 del README). Misma cabeza, mismo
código, misma interfaz mental para el usuario.

---

## 2 · La prefactura no toca el libro mayor

Regla dura: **una prefactura no genera póliza, no mueve IVA, no aparece en Ingresos y no entra en
ninguna cifra fiscal.** Solo cuenta cuando existe el CFDI timbrado.

Vive en su propia bandeja, con su propio contador ("3 prefacturas pendientes de timbrar,
$52,400"). Mezclarla con las cifras reales, aunque sea como proyección, rompe la promesa central
del producto: que lo que ves es lo que el SAT tiene.

---

## 3 · Validar es el producto

Aquí está el valor entero de la función. Cifra no timbra, pero puede garantizar que **cuando el
usuario timbre, no le rebote**. Todo lo que el SAT rechaza, revisado antes:

- **Receptor contra su constancia.** CFDI 4.0 compara nombre, código postal y régimen fiscal, y
  exige coincidencia exacta. Es el rechazo número uno.
- **RFC del receptor** válido estructuralmente (§5 del README, ya implementado) y existente.
- **Uso de CFDI compatible con el régimen del receptor.** No todos los usos aplican a todos los
  regímenes.
- **Coherencia de método y forma de pago.** `PPD` va con forma `99 · Por definir`; `PUE` con la
  forma real. Es un error clásico y el usuario no lo entiende cuando el portal lo escupe.
- **Claves de catálogo vigentes:** producto/servicio, unidad, uso, forma, método, régimen.
- **Aritmética e impuestos:** redondeo del IVA por concepto, retenciones cuando el receptor es
  persona moral (§3.1), suma de conceptos contra el total.

Cada error se explica en el idioma del usuario y con el arreglo, no con el código del SAT.

Los catálogos son **datos versionados**, igual que las tarifas de ISR: `packages/cfdi/catalogos/`,
por vigencia. La misma regla 6 de `CLAUDE.md`.

---

## 4 · Cómo se entrega

Tres formatos, porque el usuario timbra en tres lugares distintos:

| Formato | Para quién | Qué es |
|---|---|---|
| **Ficha de captura** | El que usa *"Genera tu factura"* del SAT | Los campos en el orden y con los nombres exactos del portal, cada uno con botón de copiar. Nada de un PDF bonito que hay que traducir mentalmente. |
| **XML sin sellar** | El que ya tiene PAC | El comprobante armado, sin `Sello` ni `Certificado`. No es un documento fiscal: es la entrada estándar del timbrado. Cifra no firma nada. |
| **CSV / JSON** | El que usa un PAC con importación | Mapeo por PAC, en `packages/cfdi/formatos/`. |

Al entregar, la prefactura pasa a `entregada` y arranca el reloj de la conciliación.

---

## 5 · Cerrar el ciclo: conciliación con el CFDI real

Cuando `sat-sincronizar` trae comprobantes emitidos, un detector busca prefacturas abiertas que
coincidan:

- **Llaves:** RFC del receptor, total, y fecha dentro de una ventana (7 días desde la entrega).
- **Refuerzo:** conceptos y forma de pago.
- **Coincidencia alta** → se enlaza sola, se marca `timbrada`, se genera la póliza desde el CFDI
  real (nunca desde la prefactura) y se avisa.
- **Coincidencia media** → sugerencia con `score` y `motivo`, el usuario confirma. Idéntico al
  flujo bancario.
- **Coincide con diferencias** (el usuario cambió el monto al timbrar) → se enlaza pero se
  **muestra la diferencia**. Nunca se acepta en silencio: esa diferencia suele ser un descuento
  que el usuario acordó por teléfono y que nadie más va a registrar.

Y los dos casos que hay que atrapar:

- **Entregada y sin timbrar a los 5 días** → `Observacion` de familia oportunidad, con el impacto
  en pesos. Es dinero que el usuario cree facturado y no está.
- **Prefactura duplicada:** antes de crear una nueva, se revisa si ya hay otra abierta con el
  mismo receptor y monto, o un CFDI timbrado que la cubre. Se avisa en la vista previa del plan,
  antes de confirmar.

---

## 6 · Plantillas y recurrencia

*"Genera una factura idéntica a la del mes pasado"* es, en realidad, una plantilla. Vale la pena
tratarla así:

- Una `PlantillaFactura` se deriva de un CFDI anterior o se define a mano.
- **Nunca es copia literal.** Al usarla se revalida el receptor contra su constancia (§3), se
  recalculan fechas y se avisa si algo cambió desde la última vez.
- Los hábitos del documento de IA aplican directo: si el usuario factura a Anáhuac el día 1 de
  cada mes, la prefactura del mes siguiente se propone sola, lista para revisar. Es de las pocas
  sugerencias proactivas que se ganan la interrupción.

---

## 7 · Qué cambia en los documentos anteriores

| Documento | Cambio |
|---|---|
| `ARQUITECTURA-COMANDOS.md` §5 | Se reemplaza por este archivo. |
| `comandos.prisma` | **Se eliminan** `SelloDigital`, `SerieFolio` y `EmisionCFDI`. Entran los modelos de `prefacturas.prisma`. |
| Tabla de autoridad (§4 de comandos) | `crear_prefactura` es **reversible**, rol `captura`, confirmación normal sin advertencia destacada. Ya no existe ninguna acción irreversible en el registro salvo presentar declaración. |
| Regla 23 de `CLAUDE.md` | Se sustituye por la de abajo. |
| Orden de construcción | Prefacturas ya no tiene que esperar a que Impuestos esté completo. Depende de la sincronización con el SAT (para conciliar) y de los catálogos, nada más. |

---

## Apéndice · Regla 23 corregida para `CLAUDE.md`

```markdown
23. **Cifra no timbra.** Prepara prefacturas: las arma, las valida contra todo lo que el SAT
    rechaza (receptor contra su constancia — CFDI 4.0 exige nombre, CP y régimen exactos —,
    catálogos vigentes, coherencia de método/forma de pago, aritmética de impuestos) y las
    entrega como ficha de captura, XML sin sellar o CSV. El usuario timbra fuera. Cifra no maneja
    CSD, ni PAC, ni folios, ni cancelaciones.
    Una prefactura **no toca el libro mayor**: no genera póliza, no mueve IVA y no entra en
    ninguna cifra fiscal hasta que se concilia con el CFDI timbrado que llega por la
    sincronización del SAT. Esa conciliación usa el mismo patrón de score y confirmación que la
    bancaria, y una prefactura entregada y sin timbrar a los 5 días genera observación.
```
