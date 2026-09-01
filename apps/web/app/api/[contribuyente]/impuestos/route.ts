// GET /api/[contribuyente]/impuestos?periodo=YYYY-MM  (paso 5 de PRIMEROS-PASOS.md)
//
// Desglose de IVA (§3.1) e ISR (§3.2), el resultado del cuadre (§3.5), las obligaciones con sus
// fechas, las retenciones a favor y el histórico mes por mes con sus deltas. Usa SIEMPRE el
// cliente con alcance que devuelve contexto() — nunca el cliente global de @cifra/db.

import { contexto } from "@/lib/contexto";
import { NoAutenticado, SinAcceso } from "@/lib/errores";
import { obtenerImpuestos } from "@/lib/impuestos";
import { respuestaJsonConBigInt } from "@/lib/json-bigint";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ contribuyente: string }> },
) {
  const { contribuyente: slug } = await params;

  try {
    const ctx = await contexto(slug);
    const periodo = new URL(request.url).searchParams.get("periodo") ?? undefined;

    const resultado = await obtenerImpuestos(ctx.db, ctx.contribuyente.id, periodo);
    return respuestaJsonConBigInt(resultado);
  } catch (error) {
    if (error instanceof NoAutenticado) {
      return respuestaJsonConBigInt({ error: "no_autenticado" }, { status: 401 });
    }
    if (error instanceof SinAcceso) {
      // 404, no 403 — no confirmamos que el contribuyente exista (§5 del documento de inquilinos).
      return respuestaJsonConBigInt({ error: "no_encontrado" }, { status: 404 });
    }
    throw error;
  }
}
