// Cliente falso del SAT — desarrollo y CI. Lee de handoff/datos/seed.json (el contribuyente
// ficticio TODA7606258I7) y cumple exactamente la interfaz que tendrá el real. Sabe simular
// error 503 y respuestas lentas; conserva los disparadores de escenariosDePrueba del seed.
//
// No toca la base de datos ni sabe qué es un inquilino: recibe datos, devuelve datos.

import type {
  ClienteSat,
  ConstanciaLeida,
  CredencialSat,
  CfdiDescargado,
  EstadoUuid,
  RangoFechas,
} from "./tipos";
import { RfcNoReconocido, SatNoResponde } from "./tipos";

/** Forma mínima de handoff/datos/seed.json que el cliente falso necesita. */
export interface DatosSeed {
  contribuyente: { rfc: string; nombreCompleto: string };
  constancia: { leidaEn: string; regimenes: string[] };
  obligaciones: Array<{
    clave: string;
    descripcion: string;
    periodicidad: string;
    diaLimite: number | null;
    vigenteDesde: string;
  }>;
  cfdisRecibidos: Array<Record<string, unknown>>;
  cfdisEmitidos: Array<Record<string, unknown>>;
  escenariosDePrueba: {
    rfcNoReconocidoPorSat: string;
    errorSat: { codigo: number; proximoIntentoEn: number };
  };
}

export interface OpcionesClienteFalso {
  /** Latencia artificial por llamada, en ms. Default 0. */
  latenciaMs?: number;
  /** Si está puesto, TODA llamada lanza SatNoResponde con este código. */
  fallarCon?: number;
  /** UUID que el SAT ahora reporta como cancelados, aunque el seed diga que están vigentes.
   *  Es el gancho para la verificación de §3.4: "cancelar un CFDI en el seed". */
  canceladosForzados?: Iterable<string>;
  /** Reloj inyectable para pruebas deterministas. */
  ahora?: () => Date;
}

const CENTAVOS = (n: unknown): bigint => BigInt(Math.round(Number(n ?? 0)));

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class ClienteSatFalso implements ClienteSat {
  private readonly latenciaMs: number;
  private readonly fallarCon: number | undefined;
  private readonly cancelados: Set<string>;
  private readonly ahora: () => Date;

  constructor(
    private readonly datos: DatosSeed,
    opciones: OpcionesClienteFalso = {},
  ) {
    this.latenciaMs = opciones.latenciaMs ?? 0;
    this.fallarCon = opciones.fallarCon;
    this.cancelados = new Set(opciones.canceladosForzados ?? []);
    this.ahora = opciones.ahora ?? (() => new Date());
  }

  /** Marca un UUID como cancelado en el SAT desde este momento (sin reconstruir el cliente). */
  forzarCancelado(uuid: string): void {
    this.cancelados.add(uuid);
  }

  // Solo mira `credencial.rfc`. La CIEC no se usa (ni hace falta que venga): el seed no tiene
  // secretos y todavía no hay UI para capturarla — §7 del documento de inquilinos.
  private async preludio(credencial: CredencialSat): Promise<void> {
    if (this.latenciaMs > 0) await dormir(this.latenciaMs);
    if (this.fallarCon !== undefined) {
      throw new SatNoResponde(this.fallarCon, this.datos.escenariosDePrueba.errorSat.proximoIntentoEn);
    }
    if (credencial.rfc === this.datos.escenariosDePrueba.rfcNoReconocidoPorSat) {
      throw new RfcNoReconocido(credencial.rfc);
    }
  }

  private estadoDe(uuid: string, estadoSeed: string): EstadoUuid["estado"] {
    if (this.cancelados.has(uuid)) return "cancelado";
    return estadoSeed === "cancelado" ? "cancelado" : "vigente";
  }

  async descargarCfdi(credencial: CredencialSat, rango: RangoFechas): Promise<CfdiDescargado[]> {
    await this.preludio(credencial);
    const rfc = this.datos.contribuyente.rfc;
    const nombre = this.datos.contribuyente.nombreCompleto;

    const recibidos = this.datos.cfdisRecibidos.map((c): CfdiDescargado => {
      const uuid = String(c.uuid);
      const estadoSeed = String(c.estadoSat ?? "vigente");
      const estado = this.estadoDe(uuid, estadoSeed);
      const iva = CENTAVOS(c.iva);
      return {
        uuid,
        tipo: "egreso",
        direccion: "recibido",
        serie: null,
        folio: null,
        emisorRfc: String(c.emisorRfc),
        emisorNombre: String(c.emisorNombre),
        receptorRfc: rfc,
        receptorNombre: nombre,
        fechaEmision: new Date(String(c.fechaEmision)),
        fechaTimbrado: new Date(String(c.fechaEmision)),
        subtotalCentavos: CENTAVOS(c.subtotal),
        descuentoCentavos: 0n,
        totalCentavos: CENTAVOS(c.total),
        usoCfdi: (c.usoCfdi as string) ?? null,
        metodoPago: (c.metodoPago as string) ?? null,
        formaPago: null,
        conceptos: [{ descripcion: String(c.concepto ?? ""), importeCentavos: String(c.subtotal ?? 0) }],
        impuestos:
          iva > 0n
            ? [{ impuesto: "IVA", clasificacion: "trasladado", tasa: "0.160000", importeCentavos: iva }]
            : [],
        estadoSat: estado,
        canceladoEn:
          estado === "cancelado"
            ? c.canceladoEn
              ? new Date(String(c.canceladoEn))
              : this.ahora()
            : null,
        xml: "",
      };
    });

    const emitidos = this.datos.cfdisEmitidos.map((c): CfdiDescargado => {
      const folio = String(c.folio);
      const uuid = `${rfc}-${folio}`;
      const estado = this.estadoDe(uuid, "vigente");
      const iva = CENTAVOS(c.iva);
      const [serie, num] = folio.split("-");
      const subtotal = CENTAVOS(c.subtotal ?? c.total);
      return {
        uuid,
        tipo: "ingreso",
        direccion: "emitido",
        serie: num ? serie ?? null : null,
        folio: num ?? folio,
        emisorRfc: rfc,
        emisorNombre: nombre,
        receptorRfc: "XAXX010101000",
        receptorNombre: String(c.receptorNombre ?? ""),
        fechaEmision: new Date(String(c.fechaEmision)),
        fechaTimbrado: new Date(String(c.fechaEmision)),
        subtotalCentavos: subtotal,
        descuentoCentavos: 0n,
        totalCentavos: CENTAVOS(c.total),
        usoCfdi: null,
        metodoPago: null,
        formaPago: null,
        conceptos: [{ descripcion: "Servicios profesionales", importeCentavos: String(subtotal) }],
        impuestos:
          iva > 0n
            ? [{ impuesto: "IVA", clasificacion: "trasladado", tasa: "0.160000", importeCentavos: iva }]
            : [],
        estadoSat: estado,
        canceladoEn: estado === "cancelado" ? this.ahora() : null,
        xml: "",
      };
    });

    return [...recibidos, ...emitidos].filter(
      (c) => c.fechaEmision >= rango.desde && c.fechaEmision <= rango.hasta,
    );
  }

  async validarUuids(credencial: CredencialSat, uuids: readonly string[]): Promise<EstadoUuid[]> {
    await this.preludio(credencial);

    const porUuid = new Map<string, string>();
    for (const c of this.datos.cfdisRecibidos) porUuid.set(String(c.uuid), String(c.estadoSat ?? "vigente"));
    for (const c of this.datos.cfdisEmitidos) {
      porUuid.set(`${this.datos.contribuyente.rfc}-${String(c.folio)}`, "vigente");
    }

    return uuids.map((uuid): EstadoUuid => {
      const estadoSeed = porUuid.get(uuid);
      if (estadoSeed === undefined && !this.cancelados.has(uuid)) {
        return { uuid, estado: "no_encontrado", canceladoEn: null };
      }
      const estado = this.estadoDe(uuid, estadoSeed ?? "vigente");
      return { uuid, estado, canceladoEn: estado === "cancelado" ? this.ahora() : null };
    });
  }

  async leerConstancia(credencial: CredencialSat): Promise<ConstanciaLeida> {
    await this.preludio(credencial);
    return {
      leidaEn: new Date(this.datos.constancia.leidaEn),
      regimenes: [...this.datos.constancia.regimenes],
      domicilio: { codigoPostal: "64000", entidad: "Nuevo León" },
      obligaciones: this.datos.obligaciones.map((o) => ({
        clave: o.clave,
        descripcion: o.descripcion,
        periodicidad: o.periodicidad as ObligacionLeidaPeriodicidad,
        diaLimite: o.diaLimite,
        vigenteDesde: new Date(o.vigenteDesde),
      })),
    };
  }
}

type ObligacionLeidaPeriodicidad = "mensual" | "bimestral" | "anual";
