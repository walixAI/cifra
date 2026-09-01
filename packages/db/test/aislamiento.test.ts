// La prueba que decide si todo lo demás está construido sobre arena (paso 2 de
// PRIMEROS-PASOS.md). Siembra dos organizaciones con Postgres real —binario embebido, sin
// Docker— corre la migración TAL CUAL correría en Neon (rls.sql incluido) y confirma que el
// cliente con alcance de una no ve ni una fila de la otra.
//
// Dos condiciones que la hacen una prueba de la POLÍTICA y no del ORM:
//   1. Todo se hace conectado como `cifra_app`: no es dueño de las tablas ni superusuario, así
//      que no puede saltarse RLS aunque quisiera.
//   2. Una de las consultas es SQL crudo sin WHERE, fuera de Prisma por completo.

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
  return { organizacion, contribuyente };
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
  });
});
