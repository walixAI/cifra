// La carga real de handoff/datos/seed.json. Separado de seed.mjs (que solo orquesta: base de
// datos, migraciones, conexión) para que esta parte se pueda leer de un tirón.
//
// Regla de esta migración: lo que trae el fixture se guarda tal cual, en centavos enteros.
// Donde el fixture no trae un dato que el esquema exige (RFC de receptor en emitidos, UUID de
// los emitidos, fecha/cuenta de tres movimientos bancarios), se dice explícitamente en el
// comentario junto al valor — nada se inventa en silencio.

import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raizRepo = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const datos = JSON.parse(readFileSync(join(raizRepo, "handoff", "datos", "seed.json"), "utf-8"));

const AÑO_MS = 365 * 24 * 60 * 60 * 1000;
const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

// Llave maestra de desarrollo para el cifrado de sobre de la CIEC. En producción viene del
// entorno (CREDENCIALES_LLAVE_MAESTRA, y luego KMS). El formato de cada blob —iv‖tag‖ct con
// AES-256-GCM— tiene que coincidir con apps/trabajos/src/credenciales.ts, que es donde se
// descifra dentro del worker.
const LLAVE_MAESTRA_DEV = "xksp1Ohnd4B+mmu0Udjl7bNe2setcLZwDqMdJIBYUz8=";

function cifrarBlob(llave, textoPlano) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", llave, iv);
  const cuerpo = Buffer.concat([cipher.update(textoPlano), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), cuerpo]);
}

/** Devuelve { material_cifrado, llave_datos_cifrada } para guardar en CredencialFiscal. */
function cifrarCiec(ciecEnClaro) {
  const maestra = Buffer.from(
    process.env.CREDENCIALES_LLAVE_MAESTRA ?? LLAVE_MAESTRA_DEV,
    "base64",
  );
  const llaveDatos = randomBytes(32);
  return {
    material_cifrado: cifrarBlob(llaveDatos, Buffer.from(ciecEnClaro, "utf-8")),
    llave_datos_cifrada: cifrarBlob(maestra, llaveDatos),
  };
}

export async function sembrarDatos(prisma) {
  // ── Organización personal + TODA7606258I7 ──────────────────────────────────
  console.log("→ Organización personal + TODA7606258I7…");

  const orgPersonal = await prisma.organizacion.create({
    data: { nombre: datos.contribuyente.nombreCompleto, tipo: "personal" },
  });

  const jose = await prisma.usuario.create({
    data: {
      email: "jose.torres@cifra.test",
      nombre: datos.contribuyente.nombreCompleto,
      email_verificado_en: new Date(),
    },
  });
  await prisma.membresia.create({
    data: { usuario_id: jose.id, organizacion_id: orgPersonal.id, rol: "propietario" },
  });

  const toda = await prisma.contribuyente.create({
    data: {
      organizacion_id: orgPersonal.id,
      slug: datos.contribuyente.rfc.toLowerCase(),
      rfc: datos.contribuyente.rfc,
      nombre: datos.contribuyente.nombre,
      nombre_completo: datos.contribuyente.nombreCompleto,
      tipo_persona: datos.contribuyente.tipoPersona,
      plan: datos.contribuyente.plan,
      regimenes: datos.constancia.regimenes,
    },
  });

  await prisma.acceso.create({
    data: {
      contribuyente_id: toda.id,
      usuario_id: jose.id,
      email: jose.email,
      rol: "propietario_fiscal",
      estado: "activo",
      expira_en: new Date(Date.now() + AÑO_MS),
    },
  });

  await prisma.constancia.create({
    data: {
      contribuyente_id: toda.id,
      leida_en: new Date(datos.constancia.leidaEn),
      regimenes: datos.constancia.regimenes,
    },
  });

  // CIEC cifrada con sobre. El valor en claro es de mentira; lo que importa es que
  // apps/trabajos pueda descifrarlo dentro del worker. La organización personal tiene
  // autorización `lectura_sat` (bajar CFDI, validar, leer constancia), otorgada por el
  // propietario_fiscal.
  console.log("→ CIEC + autorización de la organización personal…");
  await prisma.credencialFiscal.create({
    data: {
      contribuyente_id: toda.id,
      tipo: "ciec",
      ...cifrarCiec("CIEC-DE-PRUEBA-TODA760625"),
      huella: "••••25",
    },
  });
  await prisma.autorizacionCredencial.create({
    data: {
      contribuyente_id: toda.id,
      organizacion_id: orgPersonal.id,
      alcance: "lectura_sat",
      otorgada_por: jose.id,
    },
  });

  for (const o of datos.obligaciones) {
    await prisma.obligacion.create({
      data: {
        contribuyente_id: toda.id,
        clave: o.clave,
        descripcion: o.descripcion,
        periodicidad: o.periodicidad,
        dia_limite: o.diaLimite ?? null,
        vigente_desde: new Date(o.vigenteDesde),
      },
    });
  }

  // ── Catálogo de cuentas y cuentas bancarias ─────────────────────────────────
  console.log("→ Catálogo de cuentas y cuentas bancarias…");

  const cuentaPorCodigo = new Map();
  for (const c of datos.cuentasContables) {
    const cuenta = await prisma.cuentaContable.create({
      data: { contribuyente_id: toda.id, codigo: c.codigo, nombre: c.nombre, naturaleza: c.naturaleza },
    });
    cuentaPorCodigo.set(c.codigo, cuenta.id);
  }

  const cuentaBancoPorInstitucion = new Map();
  for (const b of datos.cuentasBancarias) {
    const cuenta = await prisma.cuentaBancaria.create({
      data: {
        contribuyente_id: toda.id,
        institucion: b.institucion,
        mascara: b.mascara,
        tipo: b.tipo,
        origen: b.origen,
        estado: b.estado,
        ultimo_sync: b.ultimoSync ? new Date(b.ultimoSync) : null,
      },
    });
    cuentaBancoPorInstitucion.set(b.institucion, cuenta.id);
  }

  // ── CFDI recibidos (gastos) ──────────────────────────────────────────────────
  console.log("→ CFDI recibidos…");

  const cfdiRecibidoPorUuid = new Map();
  for (const c of datos.cfdisRecibidos) {
    const cfdi = await prisma.cfdi.create({
      data: {
        contribuyente_id: toda.id,
        uuid: c.uuid, // tal cual del fixture (viene truncado con "…", solo para lectura humana)
        tipo: "egreso",
        direccion: "recibido",
        origen: "sat",
        emisor_rfc: c.emisorRfc,
        emisor_nombre: c.emisorNombre,
        receptor_rfc: datos.contribuyente.rfc,
        receptor_nombre: datos.contribuyente.nombreCompleto,
        fecha_emision: new Date(c.fechaEmision),
        // El fixture no distingue fecha de timbrado de fecha de emisión para los recibidos.
        fecha_timbrado: new Date(c.fechaEmision),
        subtotal: BigInt(c.subtotal),
        total: BigInt(c.total),
        uso_cfdi: c.usoCfdi,
        metodo_pago: c.metodoPago,
        conceptos: [{ descripcion: c.concepto, importe_centavos: String(c.subtotal) }],
        estado_sat: c.estadoSat,
        cancelado_en: c.canceladoEn ? new Date(c.canceladoEn) : null,
        estado_interno: c.estadoInterno,
        cuenta_contable_id: c.cuentaContable ? (cuentaPorCodigo.get(c.cuentaContable) ?? null) : null,
        cuenta_sugerida_por_ia: c.cuentaSugeridaPorIa ?? false,
        liquidado: c.liquidado,
        fecha_liquidacion: c.fechaLiquidacion ? new Date(c.fechaLiquidacion) : null,
      },
    });
    cfdiRecibidoPorUuid.set(c.uuid, cfdi);

    if (typeof c.iva === "number") {
      await prisma.cfdiImpuesto.create({
        data: {
          contribuyente_id: toda.id,
          cfdi_id: cfdi.id,
          impuesto: "IVA",
          clasificacion: "trasladado",
          tasa: "0.16",
          importe_centavos: BigInt(c.iva),
        },
      });
    }
  }

  // ── CFDI emitidos (ingresos) ─────────────────────────────────────────────────
  console.log("→ CFDI emitidos…");

  // El fixture no trae RFC del receptor en emitidos. GMA010315AB2 es el mismo RFC que usa el
  // ejemplo de "Grupo Médico Anáhuac" en ARQUITECTURA-COMANDOS.md §2 — no hay uno real que
  // tomar del fixture, así que se reutiliza el que ya aparece documentado en el proyecto.
  const receptorPorNombre = {
    "Grupo Médico Anáhuac": "GMA010315AB2",
    "Tecnologías Ruvalcaba": "TRU150822LK5", // inventado: no aparece en ningún otro documento
  };

  const cfdiEmitidoPorFolio = new Map();
  for (const c of datos.cfdisEmitidos) {
    const [serie, folio] = c.folio.split("-");
    // El fixture no da subtotal para A-1040 (solo total): se usa el total como subtotal en vez
    // de inventar un desglose de IVA que no está en la fuente. No se crea CfdiImpuesto para él.
    const subtotal = c.subtotal ?? c.total;

    const cfdi = await prisma.cfdi.create({
      data: {
        contribuyente_id: toda.id,
        // El fixture no trae UUID para emitidos (solo folio) — se deriva uno legible y estable.
        uuid: `${datos.contribuyente.rfc}-${c.folio}`,
        tipo: "ingreso",
        direccion: "emitido",
        origen: "sat",
        serie,
        folio,
        emisor_rfc: datos.contribuyente.rfc,
        emisor_nombre: datos.contribuyente.nombreCompleto,
        receptor_rfc: receptorPorNombre[c.receptorNombre] ?? "XAXX010101000",
        receptor_nombre: c.receptorNombre,
        fecha_emision: new Date(c.fechaEmision),
        fecha_timbrado: new Date(c.fechaEmision),
        subtotal: BigInt(subtotal),
        total: BigInt(c.total),
        conceptos: [{ descripcion: "Servicios profesionales", importe_centavos: String(subtotal) }],
        liquidado: c.liquidado,
        fecha_liquidacion: c.fechaLiquidacion ? new Date(c.fechaLiquidacion) : null,
      },
    });
    cfdiEmitidoPorFolio.set(c.folio, cfdi);

    if (typeof c.iva === "number") {
      await prisma.cfdiImpuesto.create({
        data: {
          contribuyente_id: toda.id,
          cfdi_id: cfdi.id,
          impuesto: "IVA",
          clasificacion: "trasladado",
          tasa: "0.16",
          importe_centavos: BigInt(c.iva),
        },
      });
    }
  }

  // ── Pólizas y asientos ────────────────────────────────────────────────────────
  console.log("→ Pólizas y asientos…");

  for (const p of datos.polizas) {
    let origenCfdiId = null;
    if (p.origenCfdi) {
      origenCfdiId = cfdiRecibidoPorUuid.get(p.origenCfdi)?.id ?? null;
    } else if (p.folio === "D-0148") {
      // El fixture no trae `origenCfdi` en esta póliza, pero el concepto ("Factura A-1042 ·
      // Grupo Médico Anáhuac") no deja duda de cuál es.
      origenCfdiId = cfdiEmitidoPorFolio.get("A-1042")?.id ?? null;
    }

    const poliza = await prisma.poliza.create({
      data: {
        contribuyente_id: toda.id,
        folio: p.folio,
        tipo: p.tipo,
        fecha: new Date(p.fecha),
        concepto: p.concepto,
        origen_tipo: p.origenTipo,
        origen_cfdi_id: origenCfdiId,
        origen_texto: p.origenTexto ?? null,
        alerta: p.alerta ?? null,
      },
    });

    let orden = 0;
    for (const a of p.asientos) {
      await prisma.asiento.create({
        data: {
          contribuyente_id: toda.id,
          poliza_id: poliza.id,
          cuenta_contable_id: cuentaPorCodigo.get(a.cuenta),
          debe: BigInt(a.debe),
          haber: BigInt(a.haber),
          orden: orden++,
        },
      });
    }
  }

  // ── Movimientos bancarios por conciliar ─────────────────────────────────────
  console.log("→ Movimientos bancarios por conciliar…");

  const bbva = cuentaBancoPorInstitucion.get("BBVA");
  const banorte = cuentaBancoPorInstitucion.get("Banorte");
  const efectivo = cuentaBancoPorInstitucion.get("Efectivo");

  // Los primeros 5 se cruzan con el campo `movimiento` de cada CFDI recibido, que sí trae fecha
  // y cuenta ("Cargo Banorte ·8802, 16 ago") — de ahí sale este mapeo, no está inventado.
  const conCruce = [
    { indice: 0, cuenta: banorte, fecha: "2026-08-27" }, // 44A2…C09 · Nube Cortés
    { indice: 1, cuenta: banorte, fecha: "2026-08-16" }, // 5E31…B88 · Combustibles del Valle
    { indice: 2, cuenta: bbva, fecha: "2026-08-14" }, // A8D6…70C · Despacho Aguilar
    { indice: 3, cuenta: bbva, fecha: "2026-09-02" }, // D71E…5B4 · Publicidad Meridiano
    { indice: 4, cuenta: bbva, fecha: "2026-08-22" }, // 8F2A…C41 · Teléfonos de México
  ];
  for (const { indice, cuenta, fecha } of conCruce) {
    const m = datos.movimientosPorConciliar[indice];
    const cfdi = cfdiRecibidoPorUuid.get(m.sugerencia.cfdi);
    await prisma.movimientoBancario.create({
      data: {
        contribuyente_id: toda.id,
        cuenta_bancaria_id: cuenta,
        fecha: new Date(fecha),
        descripcion_banco: m.descripcionBanco,
        monto: BigInt(m.monto),
        conciliado: false,
        // score/motivo no vienen en el fixture (solo qué CFDI); son la única pieza sintetizada
        // de esta sección, con forma de sugerencia real (§1 del README).
        sugerencia: cfdi ? { cfdi_id: cfdi.id, score: 0.95, motivo: "mismo importe y proveedor" } : null,
      },
    });
  }

  const deposito = datos.movimientosPorConciliar[5];
  await prisma.movimientoBancario.create({
    data: {
      contribuyente_id: toda.id,
      cuenta_bancaria_id: efectivo,
      fecha: new Date(deposito.fecha), // este sí trae fecha explícita en el fixture
      descripcion_banco: deposito.descripcionBanco,
      monto: BigInt(deposito.monto),
      conciliado: false,
    },
  });

  // Los dos últimos (retiro de cajero, comisión bancaria) no traen fecha ni cuenta en el
  // fixture: es lo único de todo el seed que se infiere sin una referencia cruzada — fin de
  // agosto, cuenta principal.
  for (const indice of [6, 7]) {
    const m = datos.movimientosPorConciliar[indice];
    await prisma.movimientoBancario.create({
      data: {
        contribuyente_id: toda.id,
        cuenta_bancaria_id: bbva,
        fecha: new Date("2026-08-30"),
        descripcion_banco: m.descripcionBanco,
        monto: BigInt(m.monto),
        conciliado: false,
      },
    });
  }

  // ── Notificaciones ────────────────────────────────────────────────────────────
  console.log("→ Notificaciones…");

  const tipoPorFragmento = [
    { contiene: "cancelado en el SAT", tipo: "cfdi_cancelado_contabilizado" },
    { contiene: "Faltan 18 días", tipo: "obligacion_proxima" },
    { contiene: "Clasifiqué 14 gastos", tipo: "clasificacion_ia" },
    { contiene: "conciliaron 12 movimientos", tipo: "conciliacion_automatica" },
    { contiene: "34 días vencida", tipo: "factura_vencida" },
  ];
  for (const n of datos.notificaciones) {
    const match = tipoPorFragmento.find((t) => n.texto.includes(t.contiene));
    await prisma.notificacion.create({
      data: {
        contribuyente_id: toda.id,
        tipo: match?.tipo ?? "general",
        severidad: n.severidad,
        texto: n.texto,
        pantalla_destino: n.pantallaDestino,
      },
    });
  }

  // ── Declaraciones (histórico) ────────────────────────────────────────────────
  console.log("→ Declaraciones…");

  // historicoImpuestos ya trae el ISR de cada mes recalculado con la tarifa real 2026 (ver
  // _nota_isr en seed.json y §3.7 del README): mayo–julio son lo que se presentó, agosto es la
  // estimación de Cifra. Se guardan tal cual — la pantalla de Impuestos lee de aquí.
  for (const h of datos.historicoImpuestos) {
    const estado = h.estado === "presentada" ? "presentada" : "estimada";
    const fecha_limite = new Date(`${h.periodo}-17`);

    await prisma.declaracion.create({
      data: {
        contribuyente_id: toda.id,
        periodo: h.periodo,
        tipo: "iva_definitivo",
        estado,
        calculo: { por_pagar_centavos: String(h.iva) },
        fecha_limite,
      },
    });
    await prisma.declaracion.create({
      data: {
        contribuyente_id: toda.id,
        periodo: h.periodo,
        tipo: "isr_provisional",
        estado,
        calculo: { del_periodo_centavos: String(h.isr) },
        fecha_limite,
      },
    });
  }

  // ── Resumen precalculado (lo que lee la Cartera) ────────────────────────────
  console.log("→ Resumen precalculado…");

  const pasosListos = datos.cierreMensual.pasos.filter((p) => p.estado === "listo").length;
  const cfdiSinClasificar = datos.cfdisRecibidos.filter((c) => c.estadoInterno === "sin_clasificar").length;
  await prisma.resumenContribuyente.create({
    data: {
      contribuyente_id: toda.id,
      periodo: "2026-08",
      ingresos_centavos: BigInt(datos.periodos.mes.ingresos),
      gastos_centavos: BigInt(datos.periodos.mes.gastos),
      iva_centavos: BigInt(datos.periodos.mes.iva), // $8,420 — aritmética pura, coincide con el fixture
      isr_centavos: BigInt(datos.calculoIsrAgosto.isrDelPeriodo), // $26,543.71 — tarifa real 2026, Art. 106 completo

      // Desglose de IVA (calculoIvaAgosto): esto es lo que la vertical de Impuestos (paso 5) le
      // pasa directo a evaluarCuadreIva — no se recalcula sumando el ledger de una muestra de
      // 11 CFDI ilustrativos, que nunca representó los 246 reales del periodo.
      iva_trasladado_centavos: BigInt(datos.calculoIvaAgosto.trasladado),
      iva_acreditable_centavos: BigInt(datos.calculoIvaAgosto.acreditable),
      iva_retenido_centavos: BigInt(datos.calculoIvaAgosto.retenidoPorClientes),

      // Insumos del ISR acumulado (calculoIsrAgosto): se le pasan tal cual a impuestos/isr.ts.
      // pagos previos = CumPago real a julio ($162,771.95), no el número ficticio del fixture.
      ingresos_acumulados_centavos: BigInt(datos.calculoIsrAgosto.ingresosAcumulados),
      deducciones_acumuladas_centavos: BigInt(datos.calculoIsrAgosto.deduccionesAcumuladas),
      isr_pagado_acumulado_centavos: BigInt(datos.calculoIsrAgosto.pagosProvisionalesAnteriores),

      // Retención del 10% que ya reduce el pago provisional (línea 6 de §3.2). NO es saldo a
      // favor — la pantalla la muestra como "ya aplicada", no como pendiente.
      isr_retenido_pm_centavos: BigInt(datos.calculoIsrAgosto.retencionesPersonasMorales),
      isr_retenido_patron_centavos: BigInt(datos.retencionesAFavor.isrPorPatron),

      cfdi_sin_clasificar: cfdiSinClasificar,
      movimientos_sin_conciliar: datos.totales.movimientosSinCfdi,
      // §3.5: cuadra aritméticamente, pero con acreditable de un CFDI ya cancelado — warning.
      cuadre_estado: "warning",
      cierre_pasos_completos: pasosListos,
      proxima_obligacion: new Date(datos.calculoIvaAgosto.fechaLimite),
    },
  });

  // ── Sincronización con el SAT (contrato de datos rancios, §7 del README) ────
  console.log("→ Historial de sincronización con el SAT…");

  // Igual que escenariosDePrueba.errSat de este mismo archivo: la última bajada buena fue ayer
  // 19:40, y el intento de hoy a las 10:42 falló con 503. Es la situación que muestra el
  // prototipo por default — la pantalla de Impuestos (paso 5) la lee de aquí, no de un query
  // param de prueba.
  await prisma.sincronizacionSat.create({
    data: {
      contribuyente_id: toda.id,
      tipo: "cfdi",
      estado: "ok",
      iniciada_en: new Date("2026-08-29T19:35:00-06:00"),
      terminada_en: new Date("2026-08-29T19:40:00-06:00"),
      corte: new Date("2026-08-29T19:40:00-06:00"),
      cfdi_nuevos: 6,
    },
  });
  await prisma.sincronizacionSat.create({
    data: {
      contribuyente_id: toda.id,
      tipo: "cfdi",
      estado: "error",
      iniciada_en: new Date("2026-08-30T10:42:00-06:00"),
      terminada_en: null,
      corte: null, // sin corte nuevo: se sigue sirviendo el de la sincronización anterior
      codigo_error: "503",
      mensaje_error: "El SAT no respondió (503).",
      intentos: 3,
    },
  });

  // ── Organización despacho: el caso difícil de la §3 ─────────────────────────
  console.log("→ Organización despacho + vinculación con TODA7606258I7…");

  const orgDespacho = await prisma.organizacion.create({
    // El nombre coincide a propósito con el emisor de honorarios contables en cfdisRecibidos:
    // en la ficción del fixture, es el mismo despacho que ya le lleva la contabilidad a TODA.
    data: { nombre: "Despacho Aguilar y Asociados", tipo: "despacho" },
  });

  const ana = await prisma.usuario.create({
    data: { email: "ana@despachoaguilar.test", nombre: "Ana Aguilar", email_verificado_en: new Date() },
  });
  await prisma.membresia.create({
    data: { usuario_id: ana.id, organizacion_id: orgDespacho.id, rol: "propietario" },
  });

  // El caso difícil: el MISMO registro de Contribuyente (organizacion_id sigue siendo el de la
  // personal), vinculado con un Acceso nuevo — nunca un segundo Contribuyente para el mismo RFC.
  await prisma.acceso.create({
    data: {
      contribuyente_id: toda.id,
      usuario_id: ana.id,
      email: ana.email,
      rol: "contador",
      estado: "activo",
      expira_en: new Date(Date.now() + AÑO_MS),
    },
  });

  // El despacho también tiene autorización `lectura_sat` sobre la CIEC de TODA (el propietario
  // fiscal se la otorgó al contratar). Con esto, dos organizaciones pueden pedir sincronizar el
  // MISMO RFC — y el candado de SincronizacionRfc es lo que impide que lo hagan en paralelo.
  await prisma.autorizacionCredencial.create({
    data: {
      contribuyente_id: toda.id,
      organizacion_id: orgDespacho.id,
      alcance: "lectura_sat",
      otorgada_por: jose.id, // solo el propietario_fiscal puede otorgarla
    },
  });

  const clientesPropiosDelDespacho = [
    { nombre: "Consultoría Bravo, S.C.", rfc: "CBR180512KL4", tipoPersona: "moral" },
    { nombre: "Laura Ponce Medina", rfc: "POML850214RF8", tipoPersona: "fisica" },
  ];
  for (const c of clientesPropiosDelDespacho) {
    const contribuyente = await prisma.contribuyente.create({
      data: {
        organizacion_id: orgDespacho.id,
        slug: c.rfc.toLowerCase(),
        rfc: c.rfc,
        nombre: c.nombre,
        tipo_persona: c.tipoPersona,
        regimenes: ["Actividad empresarial y profesional"],
      },
    });
    // Recién dado de alta por el despacho (§3, "registro independiente"): invitación al dueño
    // real del RFC, todavía sin aceptar — nadie ha iniciado sesión como este contribuyente.
    await prisma.acceso.create({
      data: {
        contribuyente_id: contribuyente.id,
        email: `contacto@${c.rfc.toLowerCase()}.test`,
        rol: "propietario_fiscal",
        estado: "invitado",
        expira_en: new Date(Date.now() + SEMANA_MS),
        token: randomUUID(),
      },
    });
  }

  return { orgPersonal, toda, orgDespacho };
}
