import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ClienteSatFalso, RfcNoReconocido, SatNoResponde, type DatosSeed } from "../src/index";

const seed = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../handoff/datos/seed.json", import.meta.url)), "utf-8"),
) as DatosSeed;

const CRED = { rfc: seed.contribuyente.rfc, ciec: "ciec-de-prueba" };
const TODO_2026 = { desde: new Date("2026-01-01"), hasta: new Date("2026-12-31") };

describe("ClienteSatFalso — descarga de CFDI", () => {
  it("devuelve los recibidos y los emitidos del seed, con impuestos en centavos BigInt", async () => {
    const sat = new ClienteSatFalso(seed);
    const cfdis = await sat.descargarCfdi(CRED, TODO_2026);

    expect(cfdis).toHaveLength(seed.cfdisRecibidos.length + seed.cfdisEmitidos.length);

    const anahuac = cfdis.find((c) => c.uuid === "3B77…A20")!;
    expect(anahuac.direccion).toBe("recibido");
    expect(anahuac.totalCentavos).toBe(218_000n);
    expect(anahuac.impuestos).toEqual([
      { impuesto: "IVA", clasificacion: "trasladado", tasa: "0.160000", importeCentavos: 30_100n },
    ]);
    // El seed ya lo trae cancelado.
    expect(anahuac.estadoSat).toBe("cancelado");
    expect(anahuac.canceladoEn).toEqual(new Date("2026-08-21"));
  });

  it("los emitidos llevan serie y folio leídos del comprobante (Cifra no los administra)", async () => {
    const sat = new ClienteSatFalso(seed);
    const emitidos = (await sat.descargarCfdi(CRED, TODO_2026)).filter((c) => c.direccion === "emitido");
    const a1042 = emitidos.find((c) => c.folio === "1042")!;
    expect(a1042.serie).toBe("A");
    expect(a1042.tipo).toBe("ingreso");
  });

  it("filtra por rango de fechas", async () => {
    const sat = new ClienteSatFalso(seed);
    const soloAgosto28 = await sat.descargarCfdi(CRED, {
      desde: new Date("2026-08-28"),
      hasta: new Date("2026-08-28"),
    });
    expect(soloAgosto28.every((c) => c.fechaEmision.getTime() === new Date("2026-08-28").getTime())).toBe(true);
    expect(soloAgosto28.length).toBeGreaterThan(0);
  });
});

describe("ClienteSatFalso — validación de estado (§3.4)", () => {
  it("un UUID que el seed trae vigente se puede forzar a cancelado", async () => {
    const sat = new ClienteSatFalso(seed);
    const uuidVigente = "C0A4…19D"; // renta, en póliza D-0147, vigente en el seed

    const antes = await sat.validarUuids(CRED, [uuidVigente]);
    expect(antes[0]?.estado).toBe("vigente");

    sat.forzarCancelado(uuidVigente);

    const despues = await sat.validarUuids(CRED, [uuidVigente]);
    expect(despues[0]?.estado).toBe("cancelado");
    expect(despues[0]?.canceladoEn).toBeInstanceOf(Date);
  });

  it("un UUID que no existe se reporta como no_encontrado", async () => {
    const sat = new ClienteSatFalso(seed);
    const [r] = await sat.validarUuids(CRED, ["no-existe-este-uuid"]);
    expect(r?.estado).toBe("no_encontrado");
  });

  it("canceladosForzados por constructor también aplica", async () => {
    const sat = new ClienteSatFalso(seed, { canceladosForzados: ["8F2A…C41"] });
    const [r] = await sat.validarUuids(CRED, ["8F2A…C41"]);
    expect(r?.estado).toBe("cancelado");
  });
});

describe("ClienteSatFalso — constancia", () => {
  it("devuelve régimen y obligaciones del seed", async () => {
    const sat = new ClienteSatFalso(seed);
    const c = await sat.leerConstancia(CRED);
    expect(c.regimenes).toContain("Actividad empresarial y profesional");
    expect(c.obligaciones.map((o) => o.clave)).toContain("diot");
    const diot = c.obligaciones.find((o) => o.clave === "diot")!;
    expect(diot.diaLimite).toBeNull(); // último día del mes siguiente
  });
});

describe("ClienteSatFalso — fallas simuladas", () => {
  it("fallarCon lanza SatNoResponde con el código y el próximo intento", async () => {
    const sat = new ClienteSatFalso(seed, { fallarCon: 503 });
    await expect(sat.descargarCfdi(CRED, TODO_2026)).rejects.toBeInstanceOf(SatNoResponde);
    await sat.validarUuids(CRED, []).catch((e: SatNoResponde) => {
      expect(e.codigo).toBe(503);
      expect(e.proximoIntentoEnSegundos).toBe(seed.escenariosDePrueba.errorSat.proximoIntentoEn);
    });
  });

  it("el RFC de escenariosDePrueba.rfcNoReconocidoPorSat lanza RfcNoReconocido", async () => {
    const sat = new ClienteSatFalso(seed);
    await expect(
      sat.leerConstancia({ rfc: seed.escenariosDePrueba.rfcNoReconocidoPorSat, ciec: "x" }),
    ).rejects.toBeInstanceOf(RfcNoReconocido);
  });

  it("latenciaMs retrasa la respuesta", async () => {
    const sat = new ClienteSatFalso(seed, { latenciaMs: 40 });
    const t0 = Date.now();
    await sat.validarUuids(CRED, []);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
  });
});
