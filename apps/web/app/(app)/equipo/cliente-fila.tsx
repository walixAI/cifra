"use client";

// Una fila de la matriz de accesos: el cliente, quién tiene Acceso, su responsable (editable) y
// un enlace para invitar a alguien a sus libros.

import { useState, useTransition } from "react";
import Link from "next/link";
import type { AccesoDeCliente, ClienteDelEquipo, Miembro } from "@/lib/equipo";
import { FormularioInvitar } from "@/components/formulario-invitar";
import { asignarResponsable } from "./acciones";

const ROL_ACCESO: Record<string, string> = {
  propietario_fiscal: "propietario fiscal",
  contador: "contador",
  captura: "captura",
  solo_lectura: "solo lectura",
};

function ChipAcceso({ a }: { a: AccesoDeCliente }) {
  const color =
    a.estado === "activo" ? "var(--pos)" : a.estado === "revocado" ? "var(--faint)" : "var(--warn)";
  return (
    <span className="num inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]" style={{ background: "var(--chip)" }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: color, display: "inline-block" }} />
      {a.email}
      <span style={{ color: "var(--faint)" }}>· {ROL_ACCESO[a.rol] ?? a.rol}</span>
      {a.estado !== "activo" && <span style={{ color: "var(--faint)" }}>· {a.estado}</span>}
    </span>
  );
}

export function ClienteFila({
  cliente,
  miembros,
  puedeAdministrar,
}: {
  cliente: ClienteDelEquipo;
  miembros: Miembro[];
  puedeAdministrar: boolean;
}) {
  const [invitarAbierto, setInvitarAbierto] = useState(false);
  const [pendiente, startTransition] = useTransition();

  return (
    <div className="border-t py-4" style={{ borderColor: "var(--line2)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/${cliente.slug}/impuestos`} className="text-[14px] font-medium" style={{ color: "var(--text)" }}>
            {cliente.nombre}
          </Link>
          <span className="num ml-2 text-[12px]" style={{ color: "var(--faint)" }}>
            {cliente.rfc}
          </span>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <span style={{ color: "var(--muted)" }}>Responsable</span>
          <select
            disabled={!puedeAdministrar || pendiente}
            value={cliente.responsableId ?? ""}
            onChange={(e) => {
              const v = e.target.value || null;
              startTransition(() => asignarResponsable(cliente.id, v));
            }}
            className="rounded-md border bg-transparent px-2 py-1"
            style={{ borderColor: "var(--line)", color: "var(--text)" }}
          >
            <option value="">sin asignar</option>
            {miembros.map((m) => (
              <option key={m.usuarioId} value={m.usuarioId}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {cliente.accesos.length === 0 && (
          <span className="text-[12.5px]" style={{ color: "var(--faint)" }}>
            Nadie tiene acceso todavía
          </span>
        )}
        {cliente.accesos.map((a) => (
          <ChipAcceso key={a.email} a={a} />
        ))}
        {puedeAdministrar && (
          <button
            onClick={() => setInvitarAbierto((v) => !v)}
            className="text-[12.5px] font-semibold"
            style={{ color: "var(--accent)" }}
          >
            {invitarAbierto ? "Cancelar" : "+ Invitar a sus libros"}
          </button>
        )}
      </div>

      {invitarAbierto && (
        <div className="mt-3 max-w-md">
          <FormularioInvitar
            endpoint={`/api/${cliente.slug}/accesos`}
            verAccesosHref={`/${cliente.slug}/impuestos`}
            roles={[
              { valor: "contador", etiqueta: "Contador", detalle: "Ve todo y puede preparar declaraciones" },
              { valor: "captura", etiqueta: "Captura", detalle: "Sube facturas y clasifica gastos, sin ver impuestos" },
              { valor: "solo_lectura", etiqueta: "Solo lectura", detalle: "Consulta reportes y estados financieros" },
            ]}
          />
        </div>
      )}
    </div>
  );
}
