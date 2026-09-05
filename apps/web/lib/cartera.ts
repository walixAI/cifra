// La cartera del despacho (ARQUITECTURA-MULTIINQUILINO.md §6): una fila por cliente con el
// estado de lo que le puede estallar al despacho. Lee SOLO de ResumenContribuyente —los
// trabajos de Inngest la actualizan al terminar—, nunca recalcula por cliente.
//
// Número de consultas CONSTANTE, no una por cliente: prismaParaUsuario resuelve el alcance con
// la política cartera_por_acceso (subconsulta a `acceso` dentro de la propia política), así que
// una sola consulta trae los resúmenes de los N clientes. Otra trae los nombres de los
// responsables. Fin. Probado con un contador de consultas en packages/db/test/aislamiento.test.ts.

import { prisma, prismaParaUsuario } from "@cifra/db";

export interface FilaCartera {
  slug: string;
  nombre: string;
  rfc: string;
  responsable: string | null;
  satStale: boolean;
  satCorte: string | null;
  cfdiSinClasificar: number;
  movimientosSinConciliar: number;
  cuadreEstado: string;
  proximaObligacion: string | null;
  cierrePasosCompletos: number; // de 9
}

export async function obtenerCartera(usuarioId: string, periodo: string): Promise<FilaCartera[]> {
  const resumenes = await prismaParaUsuario(usuarioId).resumenContribuyente.findMany({
    where: { periodo },
    include: {
      contribuyente: { select: { slug: true, nombre: true, rfc: true, responsable_id: true } },
    },
  });

  const responsableIds = [
    ...new Set(
      resumenes
        .map((r) => r.contribuyente.responsable_id)
        .filter((x): x is string => x !== null),
    ),
  ];
  const responsables = responsableIds.length
    ? await prisma.usuario.findMany({
        where: { id: { in: responsableIds } },
        select: { id: true, nombre: true, email: true },
      })
    : [];
  const nombrePorId = new Map(responsables.map((u) => [u.id, u.nombre ?? u.email]));

  return resumenes
    .map((r) => ({
      slug: r.contribuyente.slug,
      nombre: r.contribuyente.nombre,
      rfc: r.contribuyente.rfc,
      responsable: r.contribuyente.responsable_id
        ? nombrePorId.get(r.contribuyente.responsable_id) ?? null
        : null,
      satStale: r.sat_stale,
      satCorte: r.sat_corte ? r.sat_corte.toISOString() : null,
      cfdiSinClasificar: r.cfdi_sin_clasificar,
      movimientosSinConciliar: r.movimientos_sin_conciliar,
      cuadreEstado: r.cuadre_estado,
      proximaObligacion: r.proxima_obligacion ? r.proxima_obligacion.toISOString() : null,
      cierrePasosCompletos: r.cierre_pasos_completos,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Puntaje de urgencia — más alto, más arriba. Lo que le puede estallar al despacho primero. */
export function urgencia(f: FilaCartera): number {
  let p = 0;
  if (f.cuadreEstado === "error") p += 1000;
  if (f.cuadreEstado === "warning") p += 400;
  if (f.proximaObligacion) {
    const dias = (new Date(f.proximaObligacion).getTime() - Date.now()) / 86_400_000;
    if (dias < 0) p += 800;
    else if (dias < 7) p += 500;
    else if (dias < 15) p += 200;
  }
  if (f.satStale) p += 150;
  p += Math.min(f.cfdiSinClasificar, 50) * 3;
  p += Math.min(f.movimientosSinConciliar, 50) * 2;
  p += (9 - f.cierrePasosCompletos) * 10;
  return p;
}
