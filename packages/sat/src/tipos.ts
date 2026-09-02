// La interfaz del cliente del SAT. La implementación falsa (cliente-falso.ts) y la real
// (pendiente) cumplen exactamente este contrato. El cliente del SAT solo se llama desde
// apps/trabajos, nunca desde apps/web (regla de CLAUDE.md).
//
// La CIEC se pasa por llamada, ya descifrada dentro del worker — el cliente es sin estado
// respecto a los secretos y nunca los guarda ni los registra.

export type EstadoCfdiSat = "vigente" | "cancelado" | "no_encontrado";

export interface CredencialSat {
  rfc: string;
  /** CIEC en claro. Vive en memoria del worker el tiempo de la llamada y nada más. Mientras no
   *  haya UI para capturarla (§7 del documento de inquilinos) llega `""`; el cliente falso no
   *  la usa y el real todavía no existe. */
  ciec: string;
}

export interface RangoFechas {
  desde: Date;
  /** Inclusivo. */
  hasta: Date;
}

// ── Descarga de CFDI ────────────────────────────────────────────────────────

export type TipoCfdiSat = "ingreso" | "egreso" | "nomina" | "pago" | "traslado";
export type DireccionCfdiSat = "emitido" | "recibido";

export interface LineaImpuestoSat {
  impuesto: "IVA" | "ISR" | "IEPS";
  clasificacion: "trasladado" | "retenido";
  tasa: string; // "0.160000"
  importeCentavos: bigint;
}

/** Lo que el SAT devuelve por comprobante. Coincide con lo que el parser saca del XML. */
export interface CfdiDescargado {
  uuid: string;
  tipo: TipoCfdiSat;
  direccion: DireccionCfdiSat;
  serie: string | null;
  folio: string | null;
  emisorRfc: string;
  emisorNombre: string;
  receptorRfc: string;
  receptorNombre: string;
  fechaEmision: Date;
  fechaTimbrado: Date;
  subtotalCentavos: bigint;
  descuentoCentavos: bigint;
  totalCentavos: bigint;
  usoCfdi: string | null;
  metodoPago: string | null; // PUE | PPD
  formaPago: string | null;
  conceptos: Array<{ descripcion: string; importeCentavos: string }>;
  impuestos: LineaImpuestoSat[];
  estadoSat: EstadoCfdiSat;
  canceladoEn: Date | null;
  /** El XML crudo. En el cliente falso va vacío. */
  xml: string;
}

// ── Validación de estado ────────────────────────────────────────────────────

export interface EstadoUuid {
  uuid: string;
  estado: EstadoCfdiSat;
  canceladoEn: Date | null;
}

// ── Constancia de situación fiscal ──────────────────────────────────────────

export interface ObligacionLeida {
  clave: string;
  descripcion: string;
  periodicidad: "mensual" | "bimestral" | "anual";
  diaLimite: number | null;
  vigenteDesde: Date;
}

export interface ConstanciaLeida {
  leidaEn: Date;
  regimenes: string[];
  domicilio: { codigoPostal: string; entidad: string } | null;
  obligaciones: ObligacionLeida[];
}

// ── El cliente ──────────────────────────────────────────────────────────────

export class SatNoResponde extends Error {
  constructor(
    public readonly codigo: number,
    public readonly proximoIntentoEnSegundos: number,
  ) {
    super(`El SAT no respondió (${codigo}).`);
    this.name = "SatNoResponde";
  }
}

export class RfcNoReconocido extends Error {
  constructor(public readonly rfc: string) {
    super(`El SAT no reconoce el RFC ${rfc}.`);
    this.name = "RfcNoReconocido";
  }
}

export interface ClienteSat {
  /** Descarga los CFDI emitidos y recibidos del RFC en el rango dado. */
  descargarCfdi(credencial: CredencialSat, rango: RangoFechas): Promise<CfdiDescargado[]>;

  /** Revalida el estado de una lista de UUID. Se agrupa por RFC río arriba (tenancy §8). */
  validarUuids(credencial: CredencialSat, uuids: readonly string[]): Promise<EstadoUuid[]>;

  /** Lee la constancia de situación fiscal: régimen, obligaciones, domicilio. */
  leerConstancia(credencial: CredencialSat): Promise<ConstanciaLeida>;
}
