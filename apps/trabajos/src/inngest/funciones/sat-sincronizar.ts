// sat-sincronizar — primera bajada (hasta 3 años) y luego cada 6 h.
//
// Tres funciones:
//   · el cron dispara UN evento;
//   · el abanico consulta los contribuyentes activos y manda un evento por cada uno (§8:
//     abanico, no ciclo dentro de una función);
//   · la función por contribuyente baja los CFDI, con la concurrencia limitada a 1 por RFC
//     (el candado global de §3) y reintentos.

import { prisma } from "@cifra/db";
import { CandadoRfcOcupado } from "../../servicios/candado-rfc";
import { sincronizarContribuyente } from "../../servicios/sincronizar";
import { clienteSat } from "../cliente-sat";
import { EVENTOS, inngest, type DatosContribuyente } from "../cliente";

export const cronSincronizar = inngest.createFunction(
  { id: "sat-sincronizar-cron", name: "SAT · sincronizar (cron 6h)", triggers: [{ cron: "0 */6 * * *" }] },
  async ({ step }) => {
    await step.sendEvent("solicitar-barrido", { name: EVENTOS.cfdiBarrido, data: { motivo: "cron" } });
  },
);

export const abanicoSincronizar = inngest.createFunction(
  { id: "sat-sincronizar-abanico", name: "SAT · sincronizar (abanico)", triggers: [{ event: EVENTOS.cfdiBarrido }] },
  async ({ step }) => {
    const contribuyentes = await step.run("contribuyentes-activos", () =>
      prisma.contribuyente.findMany({ where: { activo: true }, select: { id: true, rfc: true } }),
    );

    await step.sendEvent(
      "fan-out",
      contribuyentes.map((c) => ({
        name: EVENTOS.cfdiContribuyente,
        data: { contribuyenteId: c.id, rfc: c.rfc, primeraVez: false } satisfies DatosContribuyente,
      })),
    );

    return { encolados: contribuyentes.length };
  },
);

export const sincronizarUno = inngest.createFunction(
  {
    id: "sat-sincronizar-contribuyente",
    name: "SAT · sincronizar un contribuyente",
    // El candado de §3, a nivel Inngest: nunca dos bajadas del mismo RFC a la vez, aunque el
    // RFC viva en varias organizaciones. El candado en SincronizacionRfc es la red de abajo.
    concurrency: [{ key: "event.data.rfc", limit: 1 }],
    retries: 4,
    triggers: [{ event: EVENTOS.cfdiContribuyente }],
  },
  async ({ event, step, runId }) => {
    const datos = event.data as DatosContribuyente;
    return step.run("descargar-y-guardar", async () => {
      try {
        return await sincronizarContribuyente(clienteSat(), {
          contribuyenteId: datos.contribuyenteId,
          workerId: runId,
        });
      } catch (error) {
        // Si otro worker tiene el candado (carrera con la red de abajo), no es un fallo: se
        // deja para el próximo ciclo.
        if (error instanceof CandadoRfcOcupado) {
          return { omitido: true, razon: error.message };
        }
        throw error;
      }
    });
  },
);
