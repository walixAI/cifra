import type { Metadata } from "next";
// tokens.css de @cifra/ui es la fuente de verdad del color y la tipografía (día/noche).
import "@cifra/ui/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cifra",
  description: "Contabilidad inteligente para contribuyentes mexicanos.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
