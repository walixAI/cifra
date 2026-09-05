"use client";

// La tabla de la cartera: ordenable por urgencia (default) o por nombre, filtrable por
// responsable. Todo en el navegador — los datos ya vienen completos del servidor, no se
// re-consulta nada.

import { useMemo, useState } from "react";
import Link from "next/link";
import { urgencia, type FilaCartera } from "@/lib/cartera";

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(iso))
    .replace(".", "");
}

function Cuadre({ estado }: { estado: string }) {
  const map: Record<string, [string, string]> = {
    error: ["var(--neg)", "No cuadra"],
    warning: ["var(--act)", "En duda"],
    ok: ["var(--pos)", "Cuadra"],
  };
  const [color, texto] = map[estado] ?? ["var(--muted)", estado];
  return (
    <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color, background: "var(--chip)" }}>
      {texto}
    </span>
  );
}

export function TablaCartera({ filas }: { filas: FilaCartera[] }) {
  const [orden, setOrden] = useState<"urgencia" | "nombre">("urgencia");
  const [responsable, setResponsable] = useState<string>("");

  const responsables = useMemo(
    () => [...new Set(filas.map((f) => f.responsable).filter((x): x is string => x !== null))].sort(),
    [filas],
  );

  const visibles = useMemo(() => {
    const f = responsable ? filas.filter((x) => x.responsable === responsable) : filas.slice();
    return f.sort(orden === "urgencia" ? (a, b) => urgencia(b) - urgencia(a) : (a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [filas, responsable, orden]);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
        <span style={{ color: "var(--muted)" }}>Ordenar por</span>
        {(["urgencia", "nombre"] as const).map((o) => (
          <button
            key={o}
            onClick={() => setOrden(o)}
            className="rounded-md px-2.5 py-1 font-medium"
            style={
              orden === o
                ? { background: "var(--panel)", color: "var(--text)", boxShadow: "var(--shadow)" }
                : { color: "var(--muted)" }
            }
          >
            {o === "urgencia" ? "Urgencia" : "Nombre"}
          </button>
        ))}
        {responsables.length > 0 && (
          <select
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            className="ml-2 rounded-md border bg-transparent px-2 py-1 text-[13px]"
            style={{ borderColor: "var(--line)", color: "var(--text)" }}
          >
            <option value="">Todos los responsables</option>
            {responsables.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mt-3 overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px]" style={{ color: "var(--faint)" }}>
              <th className="py-2.5 pl-4 pr-3 font-medium">Cliente</th>
              <th className="px-3 py-2.5 font-medium">SAT</th>
              <th className="px-3 py-2.5 text-right font-medium">CFDI s/clasificar</th>
              <th className="px-3 py-2.5 text-right font-medium">Mov. s/conciliar</th>
              <th className="px-3 py-2.5 font-medium">Cuadre IVA</th>
              <th className="px-3 py-2.5 font-medium">Próx. obligación</th>
              <th className="px-3 py-2.5 text-right font-medium">Cierre</th>
              <th className="px-3 py-2.5 pr-4 font-medium">Responsable</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => (
              <tr key={f.slug} className="border-t" style={{ borderColor: "var(--line2)" }}>
                <td className="py-2.5 pl-4 pr-3">
                  <Link href={`/${f.slug}/impuestos`} className="font-medium" style={{ color: "var(--text)" }}>
                    {f.nombre}
                  </Link>
                  <div className="num text-[11px]" style={{ color: "var(--faint)" }}>
                    {f.rfc}
                  </div>
                </td>
                <td className="px-3 py-2.5" style={{ color: f.satStale ? "var(--act)" : "var(--muted)" }}>
                  {f.satStale ? "Sin conexión" : `al ${fechaCorta(f.satCorte)}`}
                </td>
                <td className="num px-3 py-2.5 text-right" style={{ color: f.cfdiSinClasificar ? "var(--text)" : "var(--faint)" }}>
                  {f.cfdiSinClasificar}
                </td>
                <td className="num px-3 py-2.5 text-right" style={{ color: f.movimientosSinConciliar ? "var(--text)" : "var(--faint)" }}>
                  {f.movimientosSinConciliar}
                </td>
                <td className="px-3 py-2.5">
                  <Cuadre estado={f.cuadreEstado} />
                </td>
                <td className="num px-3 py-2.5">{fechaCorta(f.proximaObligacion)}</td>
                <td className="num px-3 py-2.5 text-right" style={{ color: "var(--muted)" }}>
                  {f.cierrePasosCompletos}/9
                </td>
                <td className="px-3 py-2.5 pr-4" style={{ color: f.responsable ? "var(--muted)" : "var(--faint)" }}>
                  {f.responsable ?? "sin asignar"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
