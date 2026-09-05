// /(app)/[contribuyente]/impuestos — paso 5 de PRIMEROS-PASOS.md. Sigue el prototipo
// (handoff/Cifra v2.dc.html, pantalla "Impuestos") y la semántica de color de CLAUDE.md:
// "¿Cómo se calculó?" en turquesa (voz de la IA), presión de fecha y DIOT en naranja quemado,
// histórico comparativo en violeta. Tres presentaciones: normal, primer uso y sin conexión al
// SAT — esta última es una franja sobre datos reales, nunca una pantalla en blanco (§7 del
// README).

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { contexto } from "@/lib/contexto";
import { formatearDelta, formatearPesos, formatearPesosRedondo } from "@/lib/dinero";
import { NoAutenticado, SinAcceso } from "@/lib/errores";
import {
  obtenerImpuestos,
  type EstadoSat,
  type FilaHistorico,
  type ImpuestosResultado,
  type ObligacionImpuestos,
  type Retenciones,
} from "@/lib/impuestos";
import { ExplicacionIA } from "./explicacion-ia";

export default async function PaginaImpuestos({
  params,
  searchParams,
}: {
  params: Promise<{ contribuyente: string }>;
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { contribuyente: slug } = await params;
  const { periodo } = await searchParams;

  let ctx: Awaited<ReturnType<typeof contexto>>;
  try {
    ctx = await contexto(slug);
  } catch (error) {
    // SinAcceso es un 404 real (§5 del documento de inquilinos: nunca confirmar que existe).
    // NoAutenticado, con Auth.js ya puesto (paso 8), es un redirect a /login — el middleware ya
    // debería haber atajado esto antes de llegar aquí; esto es el respaldo si no lo hizo.
    if (error instanceof SinAcceso) notFound();
    if (error instanceof NoAutenticado) redirect(`/login?callbackUrl=/${slug}/impuestos`);
    throw error;
  }

  const resultado = await obtenerImpuestos(ctx.db, ctx.contribuyente.id, periodo);

  return (
    <main className="mx-auto max-w-6xl px-5 py-6">
      <Encabezado slug={slug} resultado={resultado} />
      {resultado.tipo === "datos" && resultado.sat.stale && <BannerSat sat={resultado.sat} />}
      {resultado.tipo === "vacio" ? <EstadoVacio /> : <Contenido slug={slug} r={resultado} />}
    </main>
  );
}

function Encabezado({ slug, resultado }: { slug: string; resultado: ImpuestosResultado }) {
  const periodos = ["2026-05", "2026-06", "2026-07", "2026-08"];
  const etiquetas: Record<string, string> = { "2026-05": "Mayo", "2026-06": "Junio", "2026-07": "Julio", "2026-08": "Agosto" };

  return (
    <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <i className="ph-duotone ph-receipt" aria-hidden style={{ fontSize: 22, color: "var(--accent-2)" }} />
          <h1 className="m-0 text-[22px] font-semibold tracking-tight">Impuestos</h1>
        </div>
        <div className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
          {resultado.tipo === "datos"
            ? `IVA e ISR de ${resultado.etiqueta.toLowerCase()}${resultado.fechaLimite ? ` · se presentan el ${formatearFecha(resultado.fechaLimite)}` : ""}`
            : "Sin datos todavía · conecta tu RFC para empezar"}
        </div>
      </div>
      {resultado.tipo === "datos" && (
        <div className="flex rounded-lg p-0.5" style={{ background: "var(--chip)" }}>
          {periodos.map((p) => {
            const activo = p === resultado.periodo;
            return (
              <Link
                key={p}
                href={`/${slug}/impuestos?periodo=${p}`}
                className="rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors"
                style={
                  activo
                    ? { background: "var(--panel)", color: "var(--text)", boxShadow: "var(--shadow)" }
                    : { color: "var(--muted)" }
                }
              >
                {etiquetas[p]}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BannerSat({ sat }: { sat: EstadoSat }) {
  return (
    <div
      className="mt-4.5 flex items-start gap-3 rounded-xl px-4 py-3.5"
      style={{ background: "var(--act-bg)" }}
    >
      <i
        className="ph-duotone ph-cloud-warning"
        aria-hidden
        style={{ fontSize: 21, color: "var(--act)", marginTop: 1, flex: "0 0 21px" }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold">
          No pude conectarme al SAT
          {sat.ultimoIntento ? ` desde las ${formatearHora(sat.ultimoIntento)}` : ""}
        </div>
        <div className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Todo lo que ves es el corte de {sat.corte ? formatearFechaHora(sat.corte) : "la última sincronización buena"}.
          Reintento solo cada {sat.proximoIntentoEnSegundos ? Math.round(sat.proximoIntentoEnSegundos / 60) : 15}{" "}
          minutos y te aviso lo que cambie.
          {sat.error ? ` Último intento ${sat.ultimoIntento ? formatearHora(sat.ultimoIntento) : ""} · error ${sat.error}.` : ""}
        </div>
      </div>
      <span
        className="flex-none self-center whitespace-nowrap rounded-lg border px-3.5 py-2 text-[13px] font-semibold"
        style={{ borderColor: "var(--act)", color: "var(--act)" }}
      >
        Reintentar ahora
      </span>
    </div>
  );
}

function EstadoVacio() {
  return (
    <section className="mx-auto mt-9 max-w-[820px]">
      <div
        className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl border"
        style={{ background: "var(--accent-soft)", borderColor: "var(--accent-line)" }}
      >
        <i className="ph-duotone ph-receipt" aria-hidden style={{ fontSize: 26, color: "var(--accent)" }} />
      </div>
      <h2 className="mt-4.5 text-2xl font-semibold tracking-tight">Todavía no puedo calcular tus impuestos</h2>
      <p className="mt-2 max-w-[58ch] text-[15px] leading-relaxed" style={{ color: "var(--muted)" }}>
        Necesito tus CFDI del periodo y tus obligaciones de la constancia para estimar el IVA y el
        ISR que te toca pagar.
      </p>
      <button
        type="button"
        disabled
        className="mt-5 rounded-lg px-4 py-2.5 text-sm font-semibold"
        style={{ background: "var(--accent)", color: "var(--onaccent)", opacity: 0.9 }}
      >
        Empezar la configuración
      </button>
      <p className="mt-3 text-xs" style={{ color: "var(--faint)" }}>
        Nunca presento nada sin que tú lo autorices.
      </p>
    </section>
  );
}

function Contenido({ slug, r }: { slug: string; r: Extract<ImpuestosResultado, { tipo: "datos" }> }) {
  const colorCuadre =
    r.cuadre.estado === "error" ? "var(--neg)" : r.cuadre.estado === "warning" ? "var(--act)" : "var(--pos)";
  const fondoCuadre =
    r.cuadre.estado === "error" ? "var(--neg-bg)" : r.cuadre.estado === "warning" ? "var(--act-bg)" : "var(--pos-bg)";
  const iconoCuadre =
    r.cuadre.estado === "error" ? "ph-x-circle" : r.cuadre.estado === "warning" ? "ph-warning-octagon" : "ph-check-circle";
  const tituloCuadre =
    r.cuadre.estado === "error"
      ? "La suma del IVA no cuadra"
      : r.cuadre.estado === "warning"
        ? `La suma cuadra, pero hay ${formatearPesos(r.cuadre.porPagarCorregidoCentavos - r.cuadre.porPagarCalculadoCentavos)} de acreditable en duda`
        : "La suma del IVA cuadra";

  const diasRestantes = r.fechaLimite ? diasHasta(r.fechaLimite) : null;

  return (
    <div className="mt-3.5 grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[1.3fr_1fr]">
      <div className="flex flex-col gap-3.5">
        <div
          className="rounded-2xl border p-5"
          style={{ background: "var(--panel)", borderColor: "var(--line)", boxShadow: "var(--shadow)" }}
        >
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            <i className="ph-duotone ph-calculator" aria-hidden style={{ fontSize: 17, color: "var(--accent-2)" }} />
            ¿Cuánto pagaré este periodo?
          </div>
          <div className="mt-3.5 flex items-baseline gap-3">
            <span className="num text-[46px] font-semibold tracking-tight">
              {formatearPesosRedondo(r.totalImpuestosCentavos)}
            </span>
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px]"
              style={{ background: "var(--chip)", color: "var(--muted)" }}
            >
              Estimación
            </span>
          </div>
          <p className="mt-3 max-w-[62ch] text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Es la suma de tu IVA definitivo de {r.etiqueta.toLowerCase()} y tu pago provisional de
            ISR
            {r.fechaLimite && (
              <>
                ; se presentan juntos a más tardar el{" "}
                <strong className="font-semibold" style={{ color: "var(--text)" }}>
                  {formatearFecha(r.fechaLimite)}
                </strong>
              </>
            )}
            . Se calculó con tus CFDI y movimientos de hoy y debe validarse antes de declarar.
          </p>

          <div className="mt-4.5 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <DesgloseCard
              icono="ph-percent"
              titulo="IVA · pago definitivo"
              filas={[
                ["Trasladado (cobrado)", r.iva.trasladadoCentavos, false],
                ["Acreditable (pagado)", r.iva.acreditableCentavos, true],
                ["Retenido por clientes", r.iva.retenidoCentavos, true],
              ]}
              total={["IVA por pagar", r.iva.porPagarCentavos]}
            />
            <DesgloseCard
              icono="ph-scales"
              titulo="ISR · pago provisional"
              filas={
                r.isr.isrAcumuladoCentavos > 0n
                  ? [
                      [`Base gravable ene–${mesCorto(r.periodo)}`, r.isr.baseCentavos, false],
                      ["ISR de la tarifa (art. 96)", r.isr.isrAcumuladoCentavos, false],
                      ["Pagos provisionales previos", r.isr.pagosProvisionalesAnterioresCentavos, true],
                      ["Retenido 10% por clientes", r.isr.retencionesPersonasMoralesCentavos, true],
                    ]
                  : [["Presentado", r.isr.isrDelPeriodoCentavos, false]]
              }
              total={["ISR del periodo", r.isr.isrDelPeriodoCentavos]}
            />
          </div>

          <div
            className="mt-4 flex items-start gap-2.5 rounded-xl px-3.5 py-3"
            style={{ background: fondoCuadre }}
          >
            <i className={`ph-duotone ${iconoCuadre}`} aria-hidden style={{ fontSize: 18, marginTop: 1, color: colorCuadre }} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">{tituloCuadre}</div>
              <div className="mt-0.5 text-[12.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
                {r.cuadre.mensaje}
              </div>
            </div>
            {r.cuadre.cfdisCanceladosAcreditando.length > 0 && (
              <Link
                href={`/${slug}/contabilidad`}
                className="self-center whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
                style={{ borderColor: colorCuadre, color: colorCuadre }}
              >
                Corregir {r.cuadre.cfdisCanceladosAcreditando[0]?.polizaFolio}
              </Link>
            )}
          </div>

          {diasRestantes !== null && (
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <span
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold"
                style={{ background: "var(--act-bg)", color: "var(--act)" }}
              >
                <i className="ph-duotone ph-clock-countdown" aria-hidden style={{ fontSize: 15 }} />
                Faltan {diasRestantes} días
              </span>
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] font-semibold"
                style={{ background: "var(--accent)", borderColor: "var(--accent)", color: "var(--onaccent)", opacity: 0.55 }}
                title="Presentar declaración: paso 13 (comandos y prefacturas)"
              >
                <i className="ph-duotone ph-paper-plane-tilt" aria-hidden style={{ fontSize: 15 }} />
                Presentar declaración
              </button>
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] font-semibold"
                style={{ borderColor: "var(--act)", color: "var(--act)", opacity: 0.55 }}
                title="Preparar la DIOT: paso 9 (las demás pantallas)"
              >
                <i className="ph-duotone ph-warning-octagon" aria-hidden style={{ fontSize: 15 }} />
                Preparar la DIOT
              </button>
            </div>
          )}

          <ExplicacionIA
            explicacionIva={r.explicacionIva}
            explicacionIsr={r.explicacionIsr}
            fuentes={r.fuentes}
            periodoEtiqueta={r.etiqueta}
          />
        </div>

        <Historico historico={r.historico} />
      </div>

      <div className="flex flex-col gap-3.5">
        <Obligaciones obligaciones={r.obligaciones} slug={slug} />
        <Retenciones r={r.retenciones} />
      </div>
    </div>
  );
}

function DesgloseCard({
  icono,
  titulo,
  filas,
  total,
}: {
  icono: string;
  titulo: string;
  filas: [string, bigint, boolean][];
  total: [string, bigint];
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--accent)" }}>
        <i className={`ph-duotone ${icono}`} aria-hidden style={{ fontSize: 14 }} />
        {titulo}
      </div>
      <div className="mt-2 text-[13px]">
        {filas.map(([etiqueta, centavos, negativo]) => (
          <div
            key={etiqueta}
            className="flex justify-between border-b py-1.5"
            style={{ borderColor: "var(--line2)" }}
          >
            <span style={{ color: "var(--muted)" }}>{etiqueta}</span>
            <span className="num">
              {negativo ? "−" : ""}
              {formatearPesosRedondo(centavos)}
            </span>
          </div>
        ))}
        <div className="flex justify-between py-2 text-sm font-semibold">
          <span>{total[0]}</span>
          <span className="num">{formatearPesosRedondo(total[1])}</span>
        </div>
      </div>
    </div>
  );
}

function Historico({ historico }: { historico: FilaHistorico[] }) {
  return (
    <div
      className="rounded-2xl border p-4.5"
      style={{ background: "var(--panel)", borderColor: "var(--line)", boxShadow: "var(--shadow)" }}
    >
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        <i className="ph-duotone ph-calendar-dots" aria-hidden style={{ fontSize: 17, color: "var(--data)" }} />
        Impuestos del año, mes por mes
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px]" style={{ color: "var(--faint)" }}>
              <th className="py-2 pr-3 font-medium">Periodo</th>
              <th className="px-3 py-2 text-right font-medium">IVA</th>
              <th className="px-3 py-2 text-right font-medium">ISR</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-right font-medium">vs. mes previo</th>
              <th className="py-2 pl-3 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {historico.map((fila) => (
              <tr key={fila.periodo} className="border-t" style={{ borderColor: "var(--line2)", fontWeight: fila.esPeriodoActual ? 600 : 400 }}>
                <td className="py-2.5 pr-3">{fila.etiqueta}</td>
                <td className="num px-3 py-2.5 text-right">{formatearPesosRedondo(fila.ivaCentavos)}</td>
                <td className="num px-3 py-2.5 text-right">{formatearPesosRedondo(fila.isrCentavos)}</td>
                <td className="num px-3 py-2.5 text-right">{formatearPesosRedondo(fila.totalCentavos)}</td>
                <td className="num px-3 py-2.5 text-right" style={{ color: fila.deltaPorcentaje === null ? "var(--faint)" : "var(--data)" }}>
                  {formatearDelta(fila.deltaPorcentaje)}
                </td>
                <td className="py-2.5 pl-3">
                  <EstadoChip estado={fila.estado} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EstadoChip({ estado }: { estado: string }) {
  const esPresentada = estado === "presentada" || estado === "pagada";
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px]"
      style={
        esPresentada
          ? { background: "var(--pos-bg)", color: "var(--pos)" }
          : { background: "var(--warn-bg)", color: "var(--warn)" }
      }
    >
      {esPresentada ? "Presentado" : "Por presentar"}
    </span>
  );
}

function Obligaciones({
  obligaciones,
  slug,
}: {
  obligaciones: ObligacionImpuestos[];
  slug: string;
}) {
  return (
    <div
      className="rounded-2xl border p-4.5"
      style={{ background: "var(--panel)", borderColor: "var(--line)", boxShadow: "var(--shadow)" }}
    >
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        <i className="ph-duotone ph-list-checks" aria-hidden style={{ fontSize: 17, color: "var(--accent-2)" }} />
        Tus obligaciones
      </div>
      <div className="mt-1 text-xs" style={{ color: "var(--faint)" }}>
        Según tu constancia de situación fiscal
      </div>
      <div className="mt-3 flex flex-col gap-3">
        {obligaciones.map((o) => (
          <div key={o.clave} className="flex items-start justify-between gap-2.5">
            <div className="flex-1">
              <div className="text-[13.5px] font-medium">{o.descripcion}</div>
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                {o.detalle}
              </div>
              {o.accionable && (
                <Link
                  href={`/${slug}/reportes`}
                  className="mt-1.5 flex w-fit items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold"
                  style={{ borderColor: "var(--act)", color: "var(--act)" }}
                >
                  <i className="ph-duotone ph-arrow-right" aria-hidden style={{ fontSize: 13 }} />
                  Preparar ahora
                </Link>
              )}
            </div>
            <span
              className="num flex-none whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px]"
              style={{ background: o.accionable ? "var(--act-bg)" : "var(--chip)", color: o.accionable ? "var(--act)" : "var(--muted)" }}
            >
              {formatearFechaCorta(o.fechaLimite)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Retenciones({ r }: { r: Retenciones }) {
  const { aplicadasEstePeriodo: aplicadas, aFavorParaLaAnual: aFavor } = r;
  const hayAplicadas =
    aplicadas.isrPersonasMoralesCentavos > 0n || aplicadas.ivaPersonasMoralesCentavos > 0n;

  return (
    <div
      className="rounded-2xl border p-4.5"
      style={{ background: "var(--panel)", borderColor: "var(--line)", boxShadow: "var(--shadow)" }}
    >
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        <i className="ph-duotone ph-arrow-u-down-left" aria-hidden style={{ fontSize: 17, color: "var(--accent-2)" }} />
        Retenciones
      </div>

      {hayAplicadas && (
        <>
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--faint)" }}>
            Ya aplicadas a tu pago de este periodo
          </div>
          <div className="mt-1.5 text-[13px]">
            <div className="flex justify-between border-b py-2" style={{ borderColor: "var(--line2)" }}>
              <span style={{ color: "var(--muted)" }}>ISR retenido por personas morales</span>
              <span className="num">−{formatearPesosRedondo(aplicadas.isrPersonasMoralesCentavos)}</span>
            </div>
            <div className="flex justify-between py-2">
              <span style={{ color: "var(--muted)" }}>IVA retenido por personas morales</span>
              <span className="num">−{formatearPesosRedondo(aplicadas.ivaPersonasMoralesCentavos)}</span>
            </div>
          </div>
        </>
      )}

      <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--faint)" }}>
        A favor para tu declaración anual
      </div>
      <div className="mt-1.5 text-[13px]">
        <div className="flex justify-between py-2">
          <span style={{ color: "var(--muted)" }}>ISR retenido por tu patrón</span>
          <span className="num">{formatearPesosRedondo(aFavor.isrPatronCentavos)}</span>
        </div>
      </div>

      <div
        className="mt-3 flex gap-2.5 rounded-xl px-3.5 py-3"
        style={{ background: "var(--ia-bg)", border: "1px solid var(--ia-line)" }}
      >
        <i className="ph-duotone ph-sparkle" aria-hidden style={{ fontSize: 16, marginTop: 1, color: "var(--ia)" }} />
        <div className="text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Lo que te retienen tus clientes personas morales ya baja tu pago de este mes. Solo lo
          que te retuvo tu patrón queda a favor para abril, cuando se juntan tus dos fuentes de
          ingreso.
        </div>
      </div>
    </div>
  );
}

// ── Formato de fechas — la única prosa de calendario que necesita esta pantalla ──
//
// Las fechas límite son fechas de calendario (el "17 de septiembre"), no instantes: se guardan
// y se calculan como medianoche UTC del día que representan, y se formatean en UTC — si se
// formatean en hora del centro, la medianoche UTC cae en el día anterior y se muestra el 16.
// Las horas del SAT (último intento, corte) sí son instantes reales: esas van en hora del centro.

function formatearFecha(fecha: Date): string {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(fecha);
}
function formatearFechaCorta(fecha: Date): string {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }).format(fecha).replace(".", "");
}
function formatearHora(fecha: Date): string {
  return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Mexico_City" }).format(fecha);
}
function formatearFechaHora(fecha: Date): string {
  const dia = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" }).format(fecha).replace(".", "");
  return `${dia} a las ${formatearHora(fecha)}`;
}
function mesCorto(periodo: string): string {
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const mes = Number(periodo.split("-")[1]) - 1;
  return meses[mes] ?? periodo;
}
function diasHasta(fecha: Date): number {
  const ahora = new Date("2026-08-30T10:42:00-06:00"); // "hoy" del escenario sembrado
  return Math.max(0, Math.ceil((fecha.getTime() - ahora.getTime()) / (1000 * 60 * 60 * 24)));
}
