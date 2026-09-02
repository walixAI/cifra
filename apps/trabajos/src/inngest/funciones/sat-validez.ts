// sat-validez — el barrido de UUID cancelados (§3.4). Corre por contribuyente, pero el servicio
// agrupa los UUID por RFC río abajo para no repetir consultas al SAT (§8).

import { prisma } from "@cifra/db";
import { barrerValidez } from "../../servicios/validez";
import { clienteSat } from "../cliente-sat";
import { EVENTOS, inngest, type DatosContribuyente } from "../cliente";

export const cronValidez = inngest.createFunction(
  { id: "sat-validez-cron", name: "SAT · barrido de validez (cron diario)", triggers: [{ cron: "0 7 * * *" }] },
  async ({ step }) => {
    await step.sendEvent("solicitar-barrido", { name: EVENTOS.validezBarrido, data: { motivo: "cron" } });
  },
);

export const abanicoValidez = inngest.createFunction(
  {
    id: "sat-validez-abanico",
    name: "SAT · barrido de validez (abanico)",
    triggers: [{ event: EVENTOS.validezBarrido }],
  },
  async ({ step }) => {
    const contribuyentes = await step.run("contribuyentes-activos", () =>
      prisma.contribuyente.findMany({ where: { activo: true }, select: { id: true, rfc: true } }),
    );
    await step.sendEvent(
      "fan-out",
      contribuyentes.map((c) => ({
        name: EVENTOS.validezContribuyente,
        data: { contribuyenteId: c.id, rfc: c.rfc } satisfies DatosContribuyente,
      })),
    );
    return { encolados: contribuyentes.length };
  },
);

export const validezUno = inngest.createFunction(
  {
    id: "sat-validez-contribuyente",
    name: "SAT · barrido de validez de un contribuyente",
    concurrency: [{ key: "event.data.rfc", limit: 1 }],
    retries: 4,
    triggers: [{ event: EVENTOS.validezContribuyente }],
  },
  async ({ event, step }) => {
    const datos = event.data as DatosContribuyente;
    return step.run("barrer", () => barrerValidez(clienteSat(), { contribuyenteId: datos.contribuyenteId }));
  },
);
