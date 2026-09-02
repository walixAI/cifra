// sat-constancia — lee la constancia de situación fiscal y reconcilia régimen y obligaciones.

import { prisma } from "@cifra/db";
import { sincronizarConstancia } from "../../servicios/constancia";
import { clienteSat } from "../cliente-sat";
import { EVENTOS, inngest, type DatosContribuyente } from "../cliente";

export const cronConstancia = inngest.createFunction(
  { id: "sat-constancia-cron", name: "SAT · constancia (cron semanal)", triggers: [{ cron: "0 6 * * 1" }] },
  async ({ step }) => {
    await step.sendEvent("solicitar-barrido", { name: EVENTOS.constanciaBarrido, data: { motivo: "cron" } });
  },
);

export const abanicoConstancia = inngest.createFunction(
  {
    id: "sat-constancia-abanico",
    name: "SAT · constancia (abanico)",
    triggers: [{ event: EVENTOS.constanciaBarrido }],
  },
  async ({ step }) => {
    const contribuyentes = await step.run("contribuyentes-activos", () =>
      prisma.contribuyente.findMany({ where: { activo: true }, select: { id: true, rfc: true } }),
    );
    await step.sendEvent(
      "fan-out",
      contribuyentes.map((c) => ({
        name: EVENTOS.constanciaContribuyente,
        data: { contribuyenteId: c.id, rfc: c.rfc } satisfies DatosContribuyente,
      })),
    );
    return { encolados: contribuyentes.length };
  },
);

export const constanciaUno = inngest.createFunction(
  {
    id: "sat-constancia-contribuyente",
    name: "SAT · constancia de un contribuyente",
    concurrency: [{ key: "event.data.rfc", limit: 1 }],
    retries: 3,
    triggers: [{ event: EVENTOS.constanciaContribuyente }],
  },
  async ({ event, step }) => {
    const datos = event.data as DatosContribuyente;
    return step.run("leer-constancia", () =>
      sincronizarConstancia(clienteSat(), { contribuyenteId: datos.contribuyenteId }),
    );
  },
);
