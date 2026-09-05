"use client";

// Selector de contribuyente en la barra superior. Oculto si la organización es `personal`
// (ARQUITECTURA-MULTIINQUILINO.md §6) — eso lo decide quien lo monta, aquí solo se pinta.
// Al cambiar, conserva la sub-ruta actual: de /a/impuestos a /b/impuestos.

import { usePathname, useRouter } from "next/navigation";

export function SelectorContribuyente({
  contribuyentes,
}: {
  contribuyentes: { slug: string; nombre: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  // /{slug}/{resto...} — el primer segmento es el contribuyente activo, si lo hay.
  const segmentos = pathname.split("/").filter(Boolean);
  const slugActivo = contribuyentes.some((c) => c.slug === segmentos[0]) ? segmentos[0] : "";
  const subRuta = segmentos.slice(1).join("/") || "impuestos";

  return (
    <label className="flex items-center gap-1.5">
      <i className="ph-duotone ph-buildings" aria-hidden style={{ fontSize: 15, color: "var(--muted)" }} />
      <select
        value={slugActivo}
        onChange={(e) => {
          const s = e.target.value;
          if (s) router.push(`/${s}/${subRuta}`);
        }}
        className="num rounded-md border bg-transparent px-2 py-1 text-[13px]"
        style={{ borderColor: "var(--line)", color: "var(--text)" }}
      >
        {slugActivo === "" && <option value="">Elige un cliente…</option>}
        {contribuyentes.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}
