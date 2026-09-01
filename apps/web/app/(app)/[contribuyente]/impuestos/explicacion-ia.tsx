"use client";

import { useState } from "react";

// El único bloque interactivo de la pantalla: por eso es el único Client Component. Turquesa
// porque es voz de la IA — regla de diseño de CLAUDE.md, el único tono que se lee igual en los
// dos temas.
export function ExplicacionIA({
  explicacionIva,
  explicacionIsr,
  fuentes,
  periodoEtiqueta,
}: {
  explicacionIva: string;
  explicacionIsr: string;
  fuentes: string;
  periodoEtiqueta: string;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <div className="mt-3.5">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-opacity hover:opacity-80"
        style={{
          background: "var(--ia-bg)",
          borderColor: "var(--ia-line)",
          color: "var(--ia)",
        }}
        aria-expanded={abierto}
      >
        <i className="ph-duotone ph-question" aria-hidden style={{ fontSize: 15 }} />
        ¿Cómo se calculó?
      </button>

      {abierto && (
        <div
          className="mt-3.5 rounded-xl border px-4.5 py-4"
          style={{ background: "var(--ia-bg)", borderColor: "var(--ia-line)" }}
        >
          <div
            className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--ia)" }}
          >
            <i className="ph-duotone ph-sparkle" aria-hidden style={{ fontSize: 14 }} />
            Explicación de la IA
          </div>
          <p className="mt-2.5 text-[13.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
            {explicacionIva}
          </p>
          <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
            {explicacionIsr}
          </p>
          <div
            className="mt-3 flex flex-wrap items-center gap-x-4.5 gap-y-2 text-xs"
            style={{ color: "var(--faint)" }}
          >
            <span>{fuentes}</span>
            <span>{periodoEtiqueta}</span>
          </div>
        </div>
      )}
    </div>
  );
}
