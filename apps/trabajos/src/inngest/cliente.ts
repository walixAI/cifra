import { Inngest } from "inngest";

// Eventos de la tubería del SAT. El cron dispara `*.barrido.solicitado`; el abanico manda un
// `*.contribuyente` por cada contribuyente activo (nunca un ciclo dentro de una función — §8
// del documento de inquilinos). Los datos se validan con estos tipos en cada handler.

export interface DatosBarridoSolicitado {
  motivo: "cron" | "manual";
}

export interface DatosContribuyente {
  contribuyenteId: string;
  rfc: string;
  primeraVez?: boolean;
}

export const EVENTOS = {
  cfdiBarrido: "sat/cfdi.barrido.solicitado",
  cfdiContribuyente: "sat/cfdi.contribuyente",
  validezBarrido: "sat/validez.barrido.solicitado",
  validezContribuyente: "sat/validez.contribuyente",
  constanciaBarrido: "sat/constancia.barrido.solicitado",
  constanciaContribuyente: "sat/constancia.contribuyente",
} as const;

export const inngest = new Inngest({ id: "cifra-trabajos" });
