// La verificación del paso 7:
//
//   1. Con el cliente falso, cancelar un CFDI que ya está en una póliza dispara la notificación
//      `neg`, marca el CFDI y la póliza, deja el resumen en `warning`, y la cifra corregida del
//      cuadre sale sola ($8,721). Nada más se toca: la póliza NO se revierte, los demás CFDI
//      quedan igual.
//   2. Dos organizaciones con el mismo RFC no sincronizan en paralelo: una toma el candado de
//      SincronizacionRfc, la otra recibe CandadoRfcOcupado sin bajar nada.
//   3. Cada uso de la CIEC deja un renglón en Bitácora; sin AutorizacionCredencial vigente, no
//      se descifra.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluarCuadreIva } from "@cifra/core";
import { ClienteSatFalso, type DatosSeed } from "@cifra/sat";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { levantarPgEmbebido, type PgEmbebido } from "../../../packages/db/test/pg-embebido";

process.env.CREDENCIALES_LLAVE_MAESTRA = "xksp1Ohnd4B+mmu0Udjl7bNe2setcLZwDqMdJIBYUz8=";

const seed = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../handoff/datos/seed.json", import.meta.url)), "utf-8"),
) as DatosSeed;

// El caso de §3.4/§3.5 del seed es el CFDI 3B77…A20 (papelería, IVA $301.00), en la póliza
// D-0142: cancelado DESPUÉS de contabilizarse. En el seed ya viene `estadoSat: "cancelado"`
// porque el barrido ya lo encontró; para reproducir el hallazgo desde cero necesitamos verlo
// vigente al contabilizar y forzar la cancelación después, con el cliente falso.
const UUID_PAPELERIA = "3B77…A20";
const seedConPapeleriaVigente: DatosSeed = {
  ...seed,
  cfdisRecibidos: seed.cfdisRecibidos.map((c) =>
    c.uuid === UUID_PAPELERIA ? { ...c, estadoSat: "vigente", canceladoEn: undefined } : c,
  ),
};

let entorno: PgEmbebido;
let prismaModulo: typeof import("@cifra/db");
let sincronizarContribuyente: typeof import("../src/servicios/sincronizar").sincronizarContribuyente;
let barrerValidez: typeof import("../src/servicios/validez").barrerValidez;
let CandadoRfcOcupado: typeof import("../src/servicios/candado-rfc").CandadoRfcOcupado;
let CredencialNoAutorizada: typeof import("../src/credenciales").CredencialNoAutorizada;
let cifrarConSobre: typeof import("../src/credenciales").cifrarConSobre;

beforeAll(async () => {
  entorno = await levantarPgEmbebido();
  // apps/trabajos usa el cliente CON alcance (RLS) igual que apps/web: conecta como cifra_app.
  process.env.DATABASE_URL = entorno.urlApp;
  process.env.DIRECT_URL = entorno.urlApp;

  prismaModulo = await import("@cifra/db");
  ({ sincronizarContribuyente } = await import("../src/servicios/sincronizar"));
  ({ barrerValidez } = await import("../src/servicios/validez"));
  ({ CandadoRfcOcupado } = await import("../src/servicios/candado-rfc"));
  ({ CredencialNoAutorizada, cifrarConSobre } = await import("../src/credenciales"));
}, 180_000);

afterAll(async () => {
  await prismaModulo?.prisma.$disconnect();
  await entorno?.detener();
}, 60_000);

// ── Utilería de siembra (con el dueño de las tablas, como un seed real) ──────

async function clienteDueno() {
  const { PrismaClient } = await import("@cifra/db");
  return new PrismaClient({ datasourceUrl: entorno.urlSuperusuario });
}

interface Escenario {
  organizacionId: string;
  contribuyenteId: string;
  rfc: string;
}

async function sembrarContribuyenteConCiec(
  dueno: Awaited<ReturnType<typeof clienteDueno>>,
  opciones: { rfc: string; slug: string },
): Promise<Escenario> {
  const org = await dueno.organizacion.create({ data: { nombre: `Org ${opciones.slug}`, tipo: "personal" } });
  const usuario = await dueno.usuario.create({
    data: { email: `dueno-${opciones.slug}@cifra.test`, email_verificado_en: new Date() },
  });
  await dueno.membresia.create({ data: { usuario_id: usuario.id, organizacion_id: org.id, rol: "propietario" } });
  const contribuyente = await dueno.contribuyente.create({
    data: {
      organizacion_id: org.id,
      slug: opciones.slug,
      rfc: opciones.rfc,
      nombre: opciones.slug,
      tipo_persona: "fisica",
    },
  });
  await dueno.acceso.create({
    data: {
      contribuyente_id: contribuyente.id,
      usuario_id: usuario.id,
      email: usuario.email,
      rol: "propietario_fiscal",
      estado: "activo",
      expira_en: new Date(Date.now() + 365 * 864e5),
    },
  });
  const sobre = cifrarConSobre("CIEC-DE-PRUEBA-1234");
  await dueno.credencialFiscal.create({
    data: {
      contribuyente_id: contribuyente.id,
      tipo: "ciec",
      material_cifrado: sobre.materialCifrado,
      llave_datos_cifrada: sobre.llaveDatosCifrada,
    },
  });
  await dueno.autorizacionCredencial.create({
    data: {
      contribuyente_id: contribuyente.id,
      organizacion_id: org.id,
      alcance: "lectura_sat",
      otorgada_por: usuario.id,
    },
  });
  return { organizacionId: org.id, contribuyenteId: contribuyente.id, rfc: opciones.rfc };
}

async function limpiar(dueno: Awaited<ReturnType<typeof clienteDueno>>) {
  await dueno.$executeRawUnsafe(`
    TRUNCATE TABLE
      bitacora, resumen_contribuyente, autorizacion_credencial, credencial_fiscal, acceso,
      sincronizacion_sat, sincronizacion_rfc, notificacion, asiento, poliza, cfdi_impuesto,
      cfdi, cuenta_contable, obligacion, constancia, contribuyente, membresia, organizacion, usuario
    RESTART IDENTITY CASCADE
  `);
}

// ── 1 · Cancelar un CFDI contabilizado (§3.4) ───────────────────────────────

describe("barrerValidez — cancelar un CFDI que ya está en una póliza", () => {
  let dueno: Awaited<ReturnType<typeof clienteDueno>>;
  let esc: Escenario;
  let db: ReturnType<typeof prismaModulo.prismaPara>;
  let sat: ClienteSatFalso;

  beforeAll(async () => {
    dueno = await clienteDueno();
  });
  afterAll(async () => {
    await dueno.$disconnect();
  });

  beforeEach(async () => {
    await limpiar(dueno);
    esc = await sembrarContribuyenteConCiec(dueno, { rfc: seed.contribuyente.rfc, slug: "toda-validez" });
    db = prismaModulo.prismaPara(esc.contribuyenteId);
    sat = new ClienteSatFalso(seedConPapeleriaVigente);

    // Baja los CFDI del seed y arma la póliza + resumen del periodo de agosto.
    await sincronizarContribuyente(sat, { contribuyenteId: esc.contribuyenteId, workerId: "test-sync" });

    // Póliza D-0142 desde el CFDI de papelería (3B77…A20), vigente al contabilizar.
    // Asientos del seed: gasto $1,879.00 + IVA acreditable $301.00 = banco $2,180.00.
    const papeleriaCfdi = await db.cfdi.findFirstOrThrow({ where: { uuid: UUID_PAPELERIA } });
    const gasto = await db.cuentaContable.create({
      data: { contribuyente_id: esc.contribuyenteId, codigo: "6100-09", nombre: "Papelería", naturaleza: "deudora" },
    });
    const ivaAcreditable = await db.cuentaContable.create({
      data: { contribuyente_id: esc.contribuyenteId, codigo: "1180-01", nombre: "IVA acreditable", naturaleza: "deudora" },
    });
    const banco = await db.cuentaContable.create({
      data: { contribuyente_id: esc.contribuyenteId, codigo: "1120-01", nombre: "Bancos", naturaleza: "deudora" },
    });
    const poliza = await db.poliza.create({
      data: {
        contribuyente_id: esc.contribuyenteId,
        folio: "D-0142",
        tipo: "diario",
        fecha: new Date("2026-08-19"),
        concepto: "Papelería y consumibles",
        origen_tipo: "cfdi",
        origen_cfdi_id: papeleriaCfdi.id,
      },
    });
    await db.asiento.createMany({
      data: [
        { contribuyente_id: esc.contribuyenteId, poliza_id: poliza.id, cuenta_contable_id: gasto.id, debe: 187_900n, orden: 0 },
        { contribuyente_id: esc.contribuyenteId, poliza_id: poliza.id, cuenta_contable_id: ivaAcreditable.id, debe: 30_100n, orden: 1 },
        { contribuyente_id: esc.contribuyenteId, poliza_id: poliza.id, cuenta_contable_id: banco.id, haber: 218_000n, orden: 2 },
      ],
    });
    await db.resumenContribuyente.create({
      data: {
        contribuyente_id: esc.contribuyenteId,
        periodo: "2026-08",
        iva_centavos: 842_000n,
        iva_trasladado_centavos: 2_450_000n,
        iva_acreditable_centavos: 1_188_500n,
        iva_retenido_centavos: 419_500n,
        cuadre_estado: "ok",
      },
    });
  });

  it("dispara la notificación neg, marca el CFDI y la póliza, y deja el resumen en warning", async () => {
    // El SAT ahora reporta ese CFDI como cancelado.
    sat.forzarCancelado(UUID_PAPELERIA);

    const resultado = await barrerValidez(sat, { contribuyenteId: esc.contribuyenteId });

    expect(resultado.detecciones).toHaveLength(1);
    expect(resultado.detecciones[0]).toMatchObject({
      uuid: UUID_PAPELERIA,
      polizaFolio: "D-0142",
      ivaAcreditableCentavos: 30_100n,
    });

    const cfdi = await db.cfdi.findFirstOrThrow({ where: { uuid: UUID_PAPELERIA } });
    expect(cfdi.estado_sat).toBe("cancelado");
    expect(cfdi.cancelado_en).toBeInstanceOf(Date);

    const poliza = await db.poliza.findFirstOrThrow({ where: { folio: "D-0142" } });
    expect(poliza.alerta).toContain("cancelado en el SAT");
    // La póliza NO se revierte — es acción del usuario.
    expect(poliza.revertida_por_id).toBeNull();

    const notifs = await db.notificacion.findMany({ where: { tipo: "cfdi_cancelado_contabilizado" } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.severidad).toBe("neg");
    expect(notifs[0]?.pantalla_destino).toBe("contabilidad");
    expect(notifs[0]?.entidad_id).toBe(poliza.id);

    const resumen = await db.resumenContribuyente.findFirstOrThrow({ where: { periodo: "2026-08" } });
    expect(resumen.cuadre_estado).toBe("warning");
  });

  it("la cifra corregida del cuadre pasa a $8,721 sin que el barrido la calcule", async () => {
    sat.forzarCancelado(UUID_PAPELERIA);
    await barrerValidez(sat, { contribuyenteId: esc.contribuyenteId });

    // Lo que hace obtenerImpuestos en apps/web: junta los CFDI cancelados que siguen en póliza
    // y se lo pasa a evaluarCuadreIva. No lo calcula el barrido.
    const cancelados = await db.cfdi.findMany({
      where: { estado_sat: "cancelado", polizas: { some: {} } },
      include: {
        polizas: { select: { id: true, folio: true } },
        impuestos: { where: { impuesto: "IVA", clasificacion: "trasladado" } },
      },
    });
    const cuadre = evaluarCuadreIva(
      { trasladadoCentavos: 2_450_000n, acreditableCentavos: 1_188_500n, retenidoCentavos: 419_500n },
      { porPagarCentavos: 842_000n },
      cancelados.map((c) => ({
        cfdiId: c.uuid,
        emisorNombre: c.emisor_nombre,
        polizaId: c.polizas[0]?.id ?? null,
        polizaFolio: c.polizas[0]?.folio ?? null,
        ivaAcreditableCentavos: c.impuestos.reduce((s, i) => s + i.importe_centavos, 0n),
      })),
    );
    expect(cuadre.estado).toBe("warning");
    expect(cuadre.porPagarCorregidoCentavos).toBe(872_100n); // $8,721.00
  });

  it("no toca los demás CFDI ni sus impuestos", async () => {
    const antes = await db.cfdi.findMany({ where: { uuid: { not: UUID_PAPELERIA } }, select: { uuid: true, estado_sat: true } });
    sat.forzarCancelado(UUID_PAPELERIA);
    await barrerValidez(sat, { contribuyenteId: esc.contribuyenteId });
    const despues = await db.cfdi.findMany({ where: { uuid: { not: UUID_PAPELERIA } }, select: { uuid: true, estado_sat: true } });
    expect(despues).toEqual(antes);
  });

  it("cada uso de la CIEC deja un renglón en Bitácora", async () => {
    sat.forzarCancelado(UUID_PAPELERIA);
    await barrerValidez(sat, { contribuyenteId: esc.contribuyenteId });
    const usos = await db.bitacora.findMany({ where: { accion: "uso_credencial" } });
    // uno de la sincronización del beforeEach + uno del barrido
    expect(usos.length).toBeGreaterThanOrEqual(2);
    expect(usos.every((u) => u.contribuyente_id === esc.contribuyenteId)).toBe(true);
    const opsBarrido = usos.map((u) => (u.metadatos as { operacion: string }).operacion);
    expect(opsBarrido).toContain("barrido_validez");
    expect(opsBarrido).toContain("descarga_cfdi");
  });

  it("sin AutorizacionCredencial vigente, no descifra", async () => {
    await dueno.autorizacionCredencial.updateMany({
      where: { contribuyente_id: esc.contribuyenteId },
      data: { revocada_en: new Date() },
    });
    await expect(barrerValidez(sat, { contribuyenteId: esc.contribuyenteId })).rejects.toBeInstanceOf(
      CredencialNoAutorizada,
    );
  });

  it("aún sin CIEC capturada corre — todavía no hay UI (§7 inquilinos)", async () => {
    // El seam de descifrado queda escrito, pero mientras no exista la captura tolera que no
    // haya CredencialFiscal: entrega "" y lo anota en Bitácora.
    await dueno.credencialFiscal.deleteMany({ where: { contribuyente_id: esc.contribuyenteId } });

    sat.forzarCancelado(UUID_PAPELERIA);
    const resultado = await barrerValidez(sat, { contribuyenteId: esc.contribuyenteId });
    expect(resultado.detecciones).toHaveLength(1);

    const usos = await db.bitacora.findMany({
      where: { accion: "uso_credencial" },
      orderBy: { creado_en: "desc" },
    });
    const barrido = usos.find((u) => (u.metadatos as { operacion: string }).operacion === "barrido_validez");
    expect((barrido?.metadatos as { credencial_capturada: boolean }).credencial_capturada).toBe(false);
    expect(barrido?.entidad_id).toBeNull();
  });
});

// ── 2 · Dos organizaciones, mismo RFC, sin sincronizar en paralelo ──────────

describe("candado por RFC — dos organizaciones con el mismo RFC", () => {
  let dueno: Awaited<ReturnType<typeof clienteDueno>>;

  beforeAll(async () => {
    dueno = await clienteDueno();
  });
  afterAll(async () => {
    await dueno.$disconnect();
  });

  it("una toma el candado, la otra recibe CandadoRfcOcupado sin bajar nada", async () => {
    await limpiar(dueno);
    const rfc = "AAAA010101AAA";
    const a = await sembrarContribuyenteConCiec(dueno, { rfc, slug: "org-a" });
    const b = await sembrarContribuyenteConCiec(dueno, { rfc, slug: "org-b" });

    // Cliente falso lento, para garantizar el traslape.
    const sat = new ClienteSatFalso({ ...seed, contribuyente: { ...seed.contribuyente, rfc } }, { latenciaMs: 300 });

    const [r1, r2] = await Promise.allSettled([
      sincronizarContribuyente(sat, { contribuyenteId: a.contribuyenteId, workerId: "worker-a" }),
      sincronizarContribuyente(sat, { contribuyenteId: b.contribuyenteId, workerId: "worker-b" }),
    ]);

    const exitos = [r1, r2].filter((r) => r.status === "fulfilled");
    const rechazos = [r1, r2].filter((r) => r.status === "rejected");
    expect(exitos).toHaveLength(1);
    expect(rechazos).toHaveLength(1);
    expect((rechazos[0] as PromiseRejectedResult).reason).toBeInstanceOf(CandadoRfcOcupado);

    // El candado quedó liberado al terminar.
    const fila = await dueno.sincronizacionRfc.findUnique({ where: { rfc } });
    expect(fila?.arrendamiento_hasta).toBeNull();
    expect(fila?.worker_id).toBeNull();
    expect(fila?.cursor).toBeInstanceOf(Date); // el que sí corrió avanzó el cursor
  });

  it("después de soltarlo, el otro contribuyente sí puede sincronizar", async () => {
    await limpiar(dueno);
    const rfc = "BBBB020202BBB";
    const a = await sembrarContribuyenteConCiec(dueno, { rfc, slug: "org-a2" });
    const b = await sembrarContribuyenteConCiec(dueno, { rfc, slug: "org-b2" });
    const sat = new ClienteSatFalso({ ...seed, contribuyente: { ...seed.contribuyente, rfc } });

    await sincronizarContribuyente(sat, { contribuyenteId: a.contribuyenteId, workerId: "w1" });
    // Secuencial: ya no hay traslape, el candado está libre.
    const segundo = await sincronizarContribuyente(sat, { contribuyenteId: b.contribuyenteId, workerId: "w2" });
    expect(segundo.corte).toBeInstanceOf(Date);
  });
});
