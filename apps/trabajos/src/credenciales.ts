// CIEC y e.firma: cifrado de sobre y uso dentro del worker.
//
// Reglas de §4 de ARQUITECTURA.md y §7 del documento de inquilinos:
//   · La CIEC se descifra ÚNICAMENTE aquí, en memoria, para una operación concreta. Nunca en
//     apps/web, nunca en un log, nunca en Sentry.
//   · Antes de descifrar se verifica que haya una AutorizacionCredencial vigente para la
//     organización que dispara la operación, con el alcance que corresponde.
//   · Cada descifrado deja un renglón en Bitacora, con quién lo provocó (no solo "el worker").
//   · Revocar borra el material (la fila de CredencialFiscal), no marca un booleano.
//
// Cifrado de sobre con AES-256-GCM (node:crypto, sin dependencias nativas): una llave de datos
// aleatoria por registro, envuelta por la llave maestra. El formato de cada blob es
// iv(12) ‖ tag(16) ‖ ciphertext.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { ClienteConAlcance } from "@cifra/db";
import { llaveMaestra } from "./entorno";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Copia a un Uint8Array respaldado por un ArrayBuffer propio — lo que espera Prisma (Bytes). */
function aBytes(buf: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
}

function cifrar(llave: Uint8Array, textoPlano: Uint8Array): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", llave, iv);
  const cuerpo = Buffer.concat([cipher.update(textoPlano), cipher.final()]);
  return aBytes(Buffer.concat([iv, cipher.getAuthTag(), cuerpo]));
}

function descifrar(llave: Uint8Array, blob: Uint8Array): Buffer {
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const cuerpo = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", llave, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cuerpo), decipher.final()]);
}

export interface Sobre {
  materialCifrado: Uint8Array<ArrayBuffer>;
  llaveDatosCifrada: Uint8Array<ArrayBuffer>;
}

/** Cifra un secreto (la CIEC en claro) para guardarlo en CredencialFiscal. */
export function cifrarConSobre(secreto: string): Sobre {
  const llaveDatos = randomBytes(32);
  return {
    materialCifrado: cifrar(llaveDatos, Buffer.from(secreto, "utf-8")),
    llaveDatosCifrada: cifrar(llaveMaestra(), llaveDatos),
  };
}

function descifrarSobre(sobre: Sobre): string {
  const llaveDatos = descifrar(llaveMaestra(), sobre.llaveDatosCifrada);
  return descifrar(llaveDatos, sobre.materialCifrado).toString("utf-8");
}

export class CredencialNoAutorizada extends Error {
  constructor(contribuyenteId: string, alcance: string) {
    super(`La organización no tiene autorización \`${alcance}\` sobre las credenciales de ${contribuyenteId}.`);
    this.name = "CredencialNoAutorizada";
  }
}

export class CredencialNoRegistrada extends Error {
  constructor(contribuyenteId: string) {
    super(`El contribuyente ${contribuyenteId} no tiene CIEC registrada.`);
    this.name = "CredencialNoRegistrada";
  }
}

export interface ContextoUsoCiec {
  contribuyenteId: string;
  /** La organización que dispara la operación (la del despacho o la personal). */
  organizacionId: string;
  /** Qué usuario la provocó — para que Bitacora diga "Ana disparó esto", no "el sistema". */
  usuarioId: string | null;
  /** `lectura_sat` para bajar CFDI / validar / leer constancia; `presentacion` requiere e.firma. */
  alcance: "lectura_sat" | "presentacion";
  /** Nombre de la operación, para Bitacora: "descarga_cfdi" | "barrido_validez" | ... */
  operacion: string;
  /** IP de origen, si aplica. */
  ip?: string;
}

/**
 * Descifra la CIEC del contribuyente, la entrega a `fn` para una operación concreta, y deja
 * rastro en Bitacora. La CIEC en claro solo vive dentro de `fn`.
 *
 * `db` es el cliente CON alcance del contribuyente (prismaPara). CredencialFiscal y
 * AutorizacionCredencial llevan contribuyente_id no nulo y están bajo RLS: hay que leerlas con
 * el cliente con alcance, igual que todo lo demás. Bitacora tiene contribuyente_id nullable y
 * queda fuera de RLS, pero el cliente con alcance también la escribe sin problema.
 */
export async function usarCiec<T>(
  db: ClienteConAlcance,
  contexto: ContextoUsoCiec,
  fn: (ciec: string) => Promise<T>,
): Promise<T> {
  const autorizacion = await db.autorizacionCredencial.findFirst({
    where: {
      contribuyente_id: contexto.contribuyenteId,
      organizacion_id: contexto.organizacionId,
      alcance: contexto.alcance,
      revocada_en: null,
    },
  });
  if (!autorizacion) {
    throw new CredencialNoAutorizada(contexto.contribuyenteId, contexto.alcance);
  }

  const credencial = await db.credencialFiscal.findUnique({
    where: { contribuyente_id_tipo: { contribuyente_id: contexto.contribuyenteId, tipo: "ciec" } },
  });
  if (!credencial) {
    throw new CredencialNoRegistrada(contexto.contribuyenteId);
  }

  const ciec = descifrarSobre({
    materialCifrado: Buffer.from(credencial.material_cifrado),
    llaveDatosCifrada: Buffer.from(credencial.llave_datos_cifrada),
  });

  await db.bitacora.create({
    data: {
      usuario_id: contexto.usuarioId,
      organizacion_id: contexto.organizacionId,
      contribuyente_id: contexto.contribuyenteId,
      accion: "uso_credencial",
      entidad: "credencial_fiscal",
      entidad_id: credencial.id,
      ip: contexto.ip ?? null,
      metadatos: { operacion: contexto.operacion, alcance: contexto.alcance, tipo: "ciec" },
    },
  });

  try {
    return await fn(ciec);
  } finally {
    // La cadena `ciec` sale de alcance aquí; nada la persiste ni la registra.
  }
}
