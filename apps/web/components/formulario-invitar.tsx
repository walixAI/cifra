"use client";

// La máquina de estados de §4.1 del README: idle → sending → { conflict | error | sent }.
// Los textos vienen del servidor (MENSAJES_INVITAR / validarEmail en @cifra/core, verbatim del
// prototipo); aquí solo se pinta cada estado y se llama al endpoint. Reutilizable para los dos
// tipos de invitación —organización o contribuyente— con `endpoint` y `roles` distintos.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Estado =
  | { t: "idle"; errorCampo?: string }
  | { t: "sending" }
  | { t: "conflict"; mensaje: string }
  | { t: "error"; mensaje: string }
  | { t: "sent"; toast: string };

export function FormularioInvitar({
  endpoint,
  roles,
  verAccesosHref,
}: {
  endpoint: string;
  roles: { valor: string; etiqueta: string; detalle: string }[];
  verAccesosHref: string;
}) {
  const router = useRouter();
  const [correo, setCorreo] = useState("");
  const [rol, setRol] = useState(roles[0]?.valor ?? "");
  const [estado, setEstado] = useState<Estado>({ t: "idle" });

  async function enviar() {
    if (estado.t === "sending") return;
    setEstado({ t: "sending" });
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ correo, rol }),
      });
    } catch {
      setEstado({ t: "error", mensaje: "No se pudo enviar: falló la conexión. La invitación no se guardó." });
      return;
    }
    const cuerpo = (await res.json().catch(() => ({}))) as {
      estado?: string;
      mensaje?: string;
      correo?: string;
      rol?: string;
    };

    if (cuerpo.estado === "sent") {
      setEstado({ t: "sent", toast: `Invitación enviada a ${cuerpo.correo} con el rol de ${cuerpo.rol}.` });
      setCorreo("");
      setTimeout(() => {
        setEstado({ t: "idle" });
        router.refresh();
      }, 850);
      return;
    }
    if (cuerpo.estado === "validacion") {
      setEstado({ t: "idle", errorCampo: cuerpo.mensaje });
      return;
    }
    if (cuerpo.estado === "conflict") {
      setEstado({ t: "conflict", mensaje: cuerpo.mensaje ?? "Esa persona ya tiene acceso." });
      return;
    }
    setEstado({ t: "error", mensaje: cuerpo.mensaje ?? "No se pudo enviar. La invitación no se guardó." });
  }

  return (
    <div className="rounded-2xl border p-4.5" style={{ background: "var(--panel)", borderColor: "var(--line)" }}>
      <div className="flex items-center gap-2 text-[14px] font-semibold">
        <i className="ph-duotone ph-user-plus" aria-hidden style={{ fontSize: 16, color: "var(--accent-2)" }} />
        Invitar a alguien
      </div>

      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Correo
          </span>
          <input
            value={correo}
            onChange={(e) => {
              setCorreo(e.target.value);
              if (estado.t === "idle" && estado.errorCampo) setEstado({ t: "idle" });
            }}
            placeholder="nombre@despacho.mx"
            className="rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: estado.t === "idle" && estado.errorCampo ? "var(--neg)" : "var(--line)",
              background: "var(--bg)",
            }}
          />
          {estado.t === "idle" && estado.errorCampo && (
            <span className="text-xs" style={{ color: "var(--neg)" }}>
              {estado.errorCampo}
            </span>
          )}
        </label>

        <div>
          <div className="mb-1.5 text-xs" style={{ color: "var(--muted)" }}>
            Rol
          </div>
          <div className="flex flex-col gap-1.5">
            {roles.map((r) => (
              <button
                type="button"
                key={r.valor}
                onClick={() => setRol(r.valor)}
                className="flex items-start gap-2 rounded-lg border px-3 py-2 text-left"
                style={{
                  borderColor: rol === r.valor ? "var(--accent)" : "var(--line)",
                  background: rol === r.valor ? "var(--accent-soft)" : "transparent",
                }}
              >
                <span className="flex-1">
                  <span className="block text-[13px] font-medium">{r.etiqueta}</span>
                  <span className="block text-xs" style={{ color: "var(--muted)" }}>
                    {r.detalle}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {estado.t === "conflict" && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px]" style={{ background: "var(--warn-bg)" }}>
            <i className="ph-duotone ph-info" aria-hidden style={{ fontSize: 15, color: "var(--warn)", marginTop: 1 }} />
            <span className="flex-1">{estado.mensaje}</span>
            <a href={verAccesosHref} className="whitespace-nowrap font-semibold" style={{ color: "var(--warn)" }}>
              Ver accesos
            </a>
          </div>
        )}
        {estado.t === "error" && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px]" style={{ background: "var(--neg-bg)" }}>
            <i className="ph-duotone ph-wifi-slash" aria-hidden style={{ fontSize: 15, color: "var(--neg)", marginTop: 1 }} />
            <span className="flex-1">{estado.mensaje}</span>
            <button type="button" onClick={() => void enviar()} className="whitespace-nowrap font-semibold" style={{ color: "var(--neg)" }}>
              Reintentar
            </button>
          </div>
        )}
        {estado.t === "sent" && (
          <div className="rounded-lg px-3 py-2.5 text-[13px]" style={{ background: "var(--pos-bg)", color: "var(--pos)" }}>
            {estado.toast}
          </div>
        )}

        <button
          type="submit"
          disabled={estado.t === "sending"}
          className="self-start rounded-lg px-4 py-2 text-sm font-semibold"
          style={{ background: "var(--accent)", color: "var(--onaccent)", opacity: estado.t === "sending" ? 0.6 : 1 }}
        >
          {estado.t === "sending" ? "Enviando…" : "Enviar invitación"}
        </button>
      </form>
    </div>
  );
}
