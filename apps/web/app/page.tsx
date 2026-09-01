// Placeholder de andamio — no es una pantalla del producto. Se reemplaza en el paso 5 de
// PRIMEROS-PASOS.md (la vertical de Impuestos, de punta a punta).
export default function Page() {
  return (
    <main className="grid min-h-dvh place-items-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold" style={{ letterSpacing: "-0.02em" }}>
          Cifra
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Andamio listo. Las pantallas y los endpoints se construyen a partir del paso 2 de{" "}
          <code>PRIMEROS-PASOS.md</code>.
        </p>
      </div>
    </main>
  );
}
