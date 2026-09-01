// La prueba que decide si todo lo demás está construido sobre arena (paso 2 de
// PRIMEROS-PASOS.md, ampliada en el paso 3). Siembra dos organizaciones con Postgres real
// —binario embebido, sin Docker— corre las DOS migraciones (plataforma + fiscal, cada una con
// su propio rls.sql incluido) tal cual correrían en Neon, y confirma que el cliente con alcance
// de una no ve ni una fila de la otra. Cubre tablas de plataforma (resumen_contribuyente,
// acceso) y las dos tablas fiscales a las que el schema de referencia les faltaba
// contribuyente_id (cfdi, asiento).
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
let PrismaClient: typeof import("../src/generated/client").PrismaClient;
let dueno: InstanceType<typeof PrismaClient>;

beforeAll(async () => {
  entorno = await levantarPgEmbebido();

  // El singleton de @cifra/db lee DATABASE_URL al construirse: hay que fijarla ANTES de
  // importar el paquete, y apuntando a cifra_app — el mismo rol con el que se conecta la app.
  process.env.DATABASE_URL = entorno.urlApp;
  process.env.DIRECT_URL = entorno.urlApp;

  ({ prismaPara } = await import("../src/alcance"));
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

  return { organizacion, contribuyente, cuentaContable, poliza, asiento, cfdi };
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
  });
});
