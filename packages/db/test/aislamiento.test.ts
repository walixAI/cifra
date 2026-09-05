// La prueba que decide si todo lo demás está construido sobre arena (paso 2 de
// PRIMEROS-PASOS.md, ampliada en el paso 3). Siembra dos organizaciones con Postgres real
// —binario embebido, sin Docker— corre las DOS migraciones (plataforma + fiscal, cada una con
// su propio rls.sql incluido) tal cual correrían en Neon, y confirma que el cliente con alcance
// de una no ve ni una fila de la otra. Cubre tablas de plataforma (resumen_contribuyente,
// acceso) y las dos tablas fiscales a las que el schema de referencia les faltaba
// contribuyente_id (cfdi, asiento), y mensaje_ia — que ganó contribuyente_id denormalizado con
// FK compuesta a (contribuyente_id, conversacion_id) para poder entrar a rls.sql.
//
// Dos condiciones que la hacen una prueba de la POLÍTICA y no del ORM:
//   1. Todo se hace conectado como `cifra_app`: no es dueño de las tablas ni superusuario, así
//      que no puede saltarse RLS aunque quisiera.
//   2. Varias de las consultas son SQL crudo sin WHERE, fuera de Prisma por completo.

import { Client as ClientePg } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { levantarPgEmbebido, type PgEmbebido } from "./pg-embebido";

let entorno: PgEmbebido;
let prismaPara: typeof import("../src/alcance").prismaPara;
let prismaParaUsuario: typeof import("../src/alcance").prismaParaUsuario;
let prismaSingleton: typeof import("../src/cliente").prisma;
let PrismaClient: typeof import("../src/generated/client").PrismaClient;
let dueno: InstanceType<typeof PrismaClient>;

beforeAll(async () => {
  entorno = await levantarPgEmbebido();

  // El singleton de @cifra/db lee DATABASE_URL al construirse: hay que fijarla ANTES de
  // importar el paquete, y apuntando a cifra_app — el mismo rol con el que se conecta la app.
  process.env.DATABASE_URL = entorno.urlApp;
  process.env.DIRECT_URL = entorno.urlApp;
  // Idem: enciende el evento "query" del singleton ANTES de que se construya, para poder contar
  // consultas reales en la prueba de la cartera (paso 8) — ver src/cliente.ts.
  process.env.PRISMA_LOG_QUERIES = "true";

  ({ prismaPara, prismaParaUsuario } = await import("../src/alcance"));
  ({ prisma: prismaSingleton } = await import("../src/cliente"));
  ({ PrismaClient } = await import("../src/generated/client"));

  // Cliente aparte, como dueño de las tablas (superusuario): solo para sembrar. Con FORCE ROW
  // LEVEL SECURITY hasta el dueño queda sujeto a la política, salvo que sea superusuario —
  // exactamente como correría un seed de desarrollo contra la base real.
  dueno = new PrismaClient({ datasourceUrl: entorno.urlSuperusuario });
}, 180_000);

afterAll(async () => {
  await dueno?.$disconnect();
  const { prisma } = await import("../src/cliente");
  await prisma.$disconnect();
  await entorno?.detener();
}, 60_000);

async function sembrarOrganizacion(nombre: string, sufijoRfc: string) {
  const organizacion = await dueno.organizacion.create({
    data: { nombre, tipo: "despacho" },
  });
  const contribuyente = await dueno.contribuyente.create({
    data: {
      organizacion_id: organizacion.id,
      slug: `cliente-${sufijoRfc.toLowerCase()}`,
      rfc: `AAA010101${sufijoRfc}`,
      nombre: `Cliente ${sufijoRfc}`,
      tipo_persona: "moral",
    },
  });
  await dueno.resumenContribuyente.create({
    data: { contribuyente_id: contribuyente.id, periodo: "2026-08", ingresos_centavos: 100n },
  });
  await dueno.acceso.create({
    data: {
      contribuyente_id: contribuyente.id,
      email: `contador@${sufijoRfc.toLowerCase()}.mx`,
      rol: "contador",
      expira_en: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // Cfdi y Asiento son justo las dos tablas del paso 3 a las que le faltaba contribuyente_id
  // en el schema de referencia — se siembran para probar que la corrección quedó protegida.
  const cuentaContable = await dueno.cuentaContable.create({
    data: {
      contribuyente_id: contribuyente.id,
      codigo: "4100-01",
      nombre: "Ingresos por servicios",
      naturaleza: "acreedora",
    },
  });
  const poliza = await dueno.poliza.create({
    data: {
      contribuyente_id: contribuyente.id,
      folio: "I-0001",
      tipo: "ingresos",
      fecha: new Date("2026-08-01"),
      concepto: "Factura de prueba",
      origen_tipo: "manual",
    },
  });
  const asiento = await dueno.asiento.create({
    data: {
      contribuyente_id: contribuyente.id,
      poliza_id: poliza.id,
      cuenta_contable_id: cuentaContable.id,
      debe: 100n,
      haber: 0n,
    },
  });
  const cfdi = await dueno.cfdi.create({
    data: {
      contribuyente_id: contribuyente.id,
      uuid: `00000000-0000-0000-0000-000000000${sufijoRfc}`,
      tipo: "ingreso",
      direccion: "emitido",
      origen: "sat",
      emisor_rfc: `AAA010101${sufijoRfc}`,
      emisor_nombre: `Cliente ${sufijoRfc}`,
      receptor_rfc: "XAXX010101000",
      receptor_nombre: "Público en general",
      fecha_emision: new Date("2026-08-01"),
      fecha_timbrado: new Date("2026-08-01"),
      subtotal: 100n,
      total: 100n,
      conceptos: [],
    },
  });

  // mensaje_ia — misma corrección que asiento en el paso 7: contribuyente_id denormalizado, y
  // aquí además con FK compuesta a la conversación.
  const conversacion = await dueno.conversacionIA.create({
    data: { contribuyente_id: contribuyente.id },
  });
  const mensajeIa = await dueno.mensajeIA.create({
    data: {
      contribuyente_id: contribuyente.id,
      conversacion_id: conversacion.id,
      rol: "ai",
      texto: `Respuesta para ${sufijoRfc}`,
      fuentes: "cfdi:1",
    },
  });

  return { organizacion, contribuyente, cuentaContable, poliza, asiento, cfdi, conversacion, mensajeIa };
}

describe("aislamiento por contribuyente (RLS)", () => {
  let orgA: Awaited<ReturnType<typeof sembrarOrganizacion>>;
  let orgB: Awaited<ReturnType<typeof sembrarOrganizacion>>;

  beforeAll(async () => {
    orgA = await sembrarOrganizacion("Despacho A", "AA1");
    orgB = await sembrarOrganizacion("Despacho B", "BB2");
  });

  it("cifra_app no es dueño de las tablas ni superusuario", async () => {
    const cliente = new ClientePg({ connectionString: entorno.urlApp });
    await cliente.connect();
    try {
      const rol = await cliente.query(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
      );
      expect(rol.rows[0].rolsuper).toBe(false);
      expect(rol.rows[0].rolbypassrls).toBe(false);

      const tabla = await cliente.query(
        "SELECT tableowner FROM pg_tables WHERE tablename = 'resumen_contribuyente'",
      );
      expect(tabla.rows[0].tableowner).not.toBe("cifra_app");
    } finally {
      await cliente.end();
    }
  });

  it("el cliente con alcance de A no devuelve ni una fila de B, sin WHERE", async () => {
    const dbA = prismaPara(orgA.contribuyente.id);

    const resumenes = await dbA.resumenContribuyente.findMany();
    expect(resumenes).toHaveLength(1);
    expect(resumenes[0]?.contribuyente_id).toBe(orgA.contribuyente.id);

    const accesos = await dbA.acceso.findMany();
    expect(accesos).toHaveLength(1);
    expect(accesos[0]?.contribuyente_id).toBe(orgA.contribuyente.id);
  });

  it("el cliente con alcance de B no devuelve ni una fila de A", async () => {
    const dbB = prismaPara(orgB.contribuyente.id);
    const resumenes = await dbB.resumenContribuyente.findMany();
    expect(resumenes).toHaveLength(1);
    expect(resumenes[0]?.contribuyente_id).toBe(orgB.contribuyente.id);
  });

  it("cfdi y asiento — las dos tablas del paso 3 a las que le faltaba contribuyente_id — quedan aisladas igual que el resto", async () => {
    const dbA = prismaPara(orgA.contribuyente.id);

    const cfdis = await dbA.cfdi.findMany();
    expect(cfdis).toHaveLength(1);
    expect(cfdis[0]?.contribuyente_id).toBe(orgA.contribuyente.id);
    expect(cfdis[0]?.id).toBe(orgA.cfdi.id);

    const asientos = await dbA.asiento.findMany();
    expect(asientos).toHaveLength(1);
    expect(asientos[0]?.contribuyente_id).toBe(orgA.contribuyente.id);
    expect(asientos[0]?.id).toBe(orgA.asiento.id);

    // Confirma también, por SQL crudo y sin WHERE, que asiento —el corazón de la contabilidad—
    // quedó con FORCE ROW LEVEL SECURITY tal como el resto: sin dueño ni GUC de por medio.
    const cliente = new ClientePg({ connectionString: entorno.urlApp });
    await cliente.connect();
    try {
      // forcerowsecurity vive en pg_class (relforcerowsecurity), no en pg_tables.
      const tabla = await cliente.query(`
        SELECT
          c.relrowsecurity AS rowsecurity,
          c.relforcerowsecurity AS forcerowsecurity,
          pg_catalog.pg_get_userbyid(c.relowner) AS tableowner
        FROM pg_class c
        WHERE c.relname = 'asiento' AND c.relkind = 'r'
      `);
      expect(tabla.rows[0].rowsecurity).toBe(true);
      expect(tabla.rows[0].forcerowsecurity).toBe(true);
      expect(tabla.rows[0].tableowner).not.toBe("cifra_app");

      await cliente.query("BEGIN");
      await cliente.query("SELECT set_config('app.contribuyente_id', $1, true)", [
        orgB.contribuyente.id,
      ]);
      const soloB = await cliente.query("SELECT contribuyente_id FROM asiento");
      await cliente.query("COMMIT");
      expect(soloB.rows).toHaveLength(1);
      expect(soloB.rows[0].contribuyente_id).toBe(orgB.contribuyente.id);
    } finally {
      await cliente.end();
    }
  });

  it("mensaje_ia — contribuyente_id denormalizado con FK compuesta a la conversación — queda aislado", async () => {
    const dbA = prismaPara(orgA.contribuyente.id);

    const mensajes = await dbA.mensajeIA.findMany();
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]?.contribuyente_id).toBe(orgA.contribuyente.id);
    expect(mensajes[0]?.id).toBe(orgA.mensajeIa.id);

    const conversaciones = await dbA.conversacionIA.findMany();
    expect(conversaciones).toHaveLength(1);
    expect(conversaciones[0]?.contribuyente_id).toBe(orgA.contribuyente.id);

    // SQL crudo y sin WHERE: mensaje_ia también quedó con FORCE ROW LEVEL SECURITY tras
    // re-correr rls.sql, y sin GUC no devuelve ni una fila.
    const cliente = new ClientePg({ connectionString: entorno.urlApp });
    await cliente.connect();
    try {
      const tabla = await cliente.query(`
        SELECT c.relrowsecurity AS rowsecurity, c.relforcerowsecurity AS forcerowsecurity
        FROM pg_class c
        WHERE c.relname = 'mensaje_ia' AND c.relkind = 'r'
      `);
      expect(tabla.rows[0].rowsecurity).toBe(true);
      expect(tabla.rows[0].forcerowsecurity).toBe(true);

      await cliente.query("BEGIN");
      const sinGuc = await cliente.query("SELECT contribuyente_id FROM mensaje_ia");
      await cliente.query("COMMIT");
      expect(sinGuc.rows).toHaveLength(0);

      await cliente.query("BEGIN");
      await cliente.query("SELECT set_config('app.contribuyente_id', $1, true)", [
        orgB.contribuyente.id,
      ]);
      const soloB = await cliente.query("SELECT contribuyente_id FROM mensaje_ia");
      await cliente.query("COMMIT");
      expect(soloB.rows).toHaveLength(1);
      expect(soloB.rows[0].contribuyente_id).toBe(orgB.contribuyente.id);
    } finally {
      await cliente.end();
    }
  });

  it("SQL crudo sin WHERE, fuera de Prisma: filtra la política, no el ORM", async () => {
    const cliente = new ClientePg({ connectionString: entorno.urlApp });
    await cliente.connect();
    try {
      await cliente.query("BEGIN");
      await cliente.query("SELECT set_config('app.contribuyente_id', $1, true)", [
        orgA.contribuyente.id,
      ]);
      const conGuc = await cliente.query("SELECT contribuyente_id FROM resumen_contribuyente");
      await cliente.query("COMMIT");
      expect(conGuc.rows).toHaveLength(1);
      expect(conGuc.rows[0].contribuyente_id).toBe(orgA.contribuyente.id);

      // Falla cerrada: sin fijar la variable, cero filas — ni siquiera las propias.
      await cliente.query("BEGIN");
      const sinGuc = await cliente.query("SELECT contribuyente_id FROM resumen_contribuyente");
      await cliente.query("COMMIT");
      expect(sinGuc.rows).toHaveLength(0);
    } finally {
      await cliente.end();
    }
  });

  it("el alcance de A no puede escribir una fila con contribuyente_id de B", async () => {
    const dbA = prismaPara(orgA.contribuyente.id);
    await expect(
      dbA.resumenContribuyente.create({
        data: { contribuyente_id: orgB.contribuyente.id, periodo: "2026-09" },
      }),
    ).rejects.toThrow();

    // Mismo WITH CHECK, ahora sobre asiento: tocar la contabilidad de otro contribuyente se
    // rechaza aunque el poliza_id/cuenta_contable_id sean válidos y de A.
    await expect(
      dbA.asiento.create({
        data: {
          contribuyente_id: orgB.contribuyente.id,
          poliza_id: orgA.poliza.id,
          cuenta_contable_id: orgA.cuentaContable.id,
          debe: 1n,
        },
      }),
    ).rejects.toThrow();

    // mensaje_ia: el alcance de A no puede escribir un mensaje con contribuyente_id de B
    // (WITH CHECK de la política).
    await expect(
      dbA.mensajeIA.create({
        data: {
          contribuyente_id: orgB.contribuyente.id,
          conversacion_id: orgB.conversacion.id,
          rol: "user",
          texto: "intruso",
        },
      }),
    ).rejects.toThrow();

    // Y aunque el contribuyente_id sea el propio, la FK compuesta impide colgar el mensaje de
    // una conversación de otro contribuyente: no existe conversacion_ia (A, id-de-conv-de-B).
    await expect(
      dbA.mensajeIA.create({
        data: {
          contribuyente_id: orgA.contribuyente.id,
          conversacion_id: orgB.conversacion.id,
          rol: "user",
          texto: "conversación ajena",
        },
      }),
    ).rejects.toThrow();

    // El camino válido sí funciona: contribuyente propio + conversación propia.
    const ok = await dbA.mensajeIA.create({
      data: {
        contribuyente_id: orgA.contribuyente.id,
        conversacion_id: orgA.conversacion.id,
        rol: "user",
        texto: "pregunta legítima",
      },
    });
    expect(ok.contribuyente_id).toBe(orgA.contribuyente.id);
  });
});

// ── Paso 8 · la cartera del despacho: la autorización la deriva la política, no la app ──────
//
// ARQUITECTURA-MULTIINQUILINO.md §6: "la cartera no puede ser N consultas sobre N clientes []
// es la única que usa un IN explícito sobre los contribuyentes a los que el usuario tiene
// Acceso". Dos políticas nuevas y permisivas hacen esto posible sin que cifra_app deje de estar
// sujeto a RLS — y sin que RLS deje de ser la red de seguridad para esta tabla: acceso_propio
// (¿a cuáles contribuyentes tengo Acceso?, resuelto sin conocer ninguno de antemano) y
// cartera_por_acceso (resumen_contribuyente visible si el usuario de la sesión tiene un Acceso
// activo a ese contribuyente — la subconsulta vive DENTRO de la política, contra `acceso`, no
// contra una lista que la aplicación arma y entrega). El único dato que aporta la app es
// app.usuario_id, vía prismaParaUsuario; qué contribuyentes le tocan lo decide Postgres.
describe("cartera del despacho (paso 8): la autorización se deriva de acceso, no de una lista", () => {
  let contadora: { id: string; email: string };
  let intruso: { id: string; email: string };
  let idsDespacho: string[];
  let contribuyenteAjeno: { id: string };

  beforeAll(async () => {
    const despacho = await dueno.organizacion.create({
      data: { nombre: "Despacho de prueba", tipo: "despacho" },
    });
    contadora = await dueno.usuario.create({
      data: { email: "contadora@despacho-cartera.test", nombre: "Contadora de prueba" },
    });
    intruso = await dueno.usuario.create({
      data: { email: "intruso@fuera.test", nombre: "Sin acceso a nada" },
    });

    const contribuyentes = [];
    for (let i = 0; i < 3; i++) {
      const contribuyente = await dueno.contribuyente.create({
        data: {
          organizacion_id: despacho.id,
          slug: `cliente-cartera-${i}`,
          rfc: `CAR00000${i}XX${i}`,
          nombre: `Cliente cartera ${i}`,
          tipo_persona: "moral",
        },
      });
      await dueno.acceso.create({
        data: {
          contribuyente_id: contribuyente.id,
          usuario_id: contadora.id,
          email: contadora.email,
          rol: "contador",
          estado: "activo",
          expira_en: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });
      await dueno.resumenContribuyente.create({
        data: {
          contribuyente_id: contribuyente.id,
          periodo: "2026-08",
          ingresos_centavos: BigInt(1000 + i),
        },
      });
      contribuyentes.push(contribuyente);
    }
    idsDespacho = contribuyentes.map((c) => c.id);

    // Un cuarto contribuyente, de otro dueño, con su propio resumen — la contadora NO tiene
    // Acceso aquí. Si algo se cuela, es exactamente esta fila.
    contribuyenteAjeno = await dueno.contribuyente.create({
      data: {
        organizacion_id: despacho.id,
        slug: "cliente-ajeno",
        rfc: "AJE000000XX0",
        nombre: "Cliente ajeno",
        tipo_persona: "moral",
      },
    });
    await dueno.resumenContribuyente.create({
      data: { contribuyente_id: contribuyenteAjeno.id, periodo: "2026-08", ingresos_centavos: 999n },
    });
  });

  /** Cuenta los SELECT reales contra una tabla mientras corre `fn` — no a ojo. */
  async function contarConsultas<T>(tabla: string, fn: () => Promise<T>) {
    let cuenta = 0;
    const contador = (evento: { query: string }) => {
      const q = evento.query.trim();
      if (/^select/i.test(q) && q.includes(`"${tabla}"`)) cuenta++;
    };
    (prismaSingleton as unknown as { $on: (e: "query", cb: typeof contador) => void }).$on(
      "query",
      contador,
    );
    const resultado = await fn();
    return { resultado, cuenta };
  }

  it("la cartera trae los 3 clientes de la contadora en exactamente una consulta a acceso y una a resumen_contribuyente", async () => {
    const { resultado: accesos, cuenta: consultasAcceso } = await contarConsultas("acceso", () =>
      prismaParaUsuario(contadora.id).acceso.findMany({
        where: { estado: "activo" },
        select: { contribuyente_id: true },
      }),
    );
    expect(consultasAcceso).toBe(1);
    const ids = accesos.map((a) => a.contribuyente_id);
    expect(ids.sort()).toEqual([...idsDespacho].sort());
    expect(ids).not.toContain(contribuyenteAjeno.id);

    // Una sola llamada, SIN pasarle la lista de ids: la política resuelve sola, contra `acceso`,
    // a cuáles contribuyentes tiene derecho la sesión. El `where` de abajo ni siquiera filtra por
    // contribuyente — si trae solo 3 filas es la política, no el código, quien decide.
    const { resultado: resumenes, cuenta: consultasResumen } = await contarConsultas(
      "resumen_contribuyente",
      () => prismaParaUsuario(contadora.id).resumenContribuyente.findMany({ where: { periodo: "2026-08" } }),
    );
    expect(consultasResumen).toBe(1);
    expect(resumenes).toHaveLength(3);
    expect(resumenes.map((r) => r.contribuyente_id).sort()).toEqual([...idsDespacho].sort());
  });

  it("un usuario sin Acceso no ve ni un contribuyente, y por lo tanto ningún resumen", async () => {
    const accesos = await prismaParaUsuario(intruso.id).acceso.findMany({
      where: { estado: "activo" },
      select: { contribuyente_id: true },
    });
    expect(accesos).toHaveLength(0);

    const resumenes = await prismaParaUsuario(intruso.id).resumenContribuyente.findMany({
      where: { periodo: "2026-08" },
    });
    expect(resumenes).toHaveLength(0);
  });

  it("pedir DIRECTO el contribuyente ajeno no sirve de nada: la política lo bloquea, no el código", async () => {
    // La contadora no tiene Acceso a contribuyenteAjeno. Si el `where` fuera lo único que
    // protegiera, pedirlo explícito por id lo traería. Con cartera_por_acceso resolviendo la
    // autorización dentro de la política (subconsulta contra `acceso`, no una lista que llegó de
    // fuera), la fila no existe para esta sesión aunque el código la pida por su nombre.
    const resumenes = await prismaParaUsuario(contadora.id).resumenContribuyente.findMany({
      where: { contribuyente_id: contribuyenteAjeno.id },
    });
    expect(resumenes).toHaveLength(0);

    // Y sin alcance de ningún tipo (ni contribuyente_id ni usuario_id fijados), la política
    // vieja de siempre sigue fallando cerrado sobre la misma fila.
    const cliente = new ClientePg({ connectionString: entorno.urlApp });
    await cliente.connect();
    try {
      await cliente.query("BEGIN");
      const sinAlcance = await cliente.query(
        "SELECT 1 FROM resumen_contribuyente WHERE contribuyente_id = $1",
        [contribuyenteAjeno.id],
      );
      await cliente.query("COMMIT");
      expect(sinAlcance.rows).toHaveLength(0);
    } finally {
      await cliente.end();
    }
  });
});
