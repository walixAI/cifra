// Un solo camino de envío de correo para todo apps/web: el magic link de Auth.js (lib/auth.ts)
// y el correo de invitación (lib/invitaciones.ts, paso 8) pasan por aquí.
//
// API HTTP de Resend, no SMTP: las funciones serverless de Vercel no manejan bien SMTP —
// bloqueo de puertos y un handshake con conexión persistente que encaja mal con un runtime
// efímero (el "Greeting never received" clásico). Una petición HTTP y ya.
//
// Sin AUTH_RESEND_KEY:
//   - en desarrollo, se simula: el enlace queda impreso en consola con una etiqueta que no deja
//     dudas de que no se mandó nada de verdad.
//   - en producción o preview, es un error explícito, no una simulación silenciosa. Un envío que
//     "funciona" pero no manda nada es peor que uno que avisa que falta configurar Resend: se
//     vuelve el estado `error` de la máquina de invitar (README §4.1), nunca un `sent` falso.

export interface CorreoAEnviar {
  para: string;
  asunto: string;
  texto: string;
  html: string;
}

export class CorreoNoConfigurado extends Error {
  constructor() {
    super("AUTH_RESEND_KEY no está configurado. En producción esto no se simula — hay que ponerlo.");
    this.name = "CorreoNoConfigurado";
  }
}

export async function enviarCorreo(correo: CorreoAEnviar): Promise<{ simulado: boolean }> {
  const apiKey = process.env.AUTH_RESEND_KEY;

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") throw new CorreoNoConfigurado();

    console.log(
      `\n✉️  [correo simulado — falta AUTH_RESEND_KEY, nada se mandó de verdad]\n` +
        `    para:    ${correo.para}\n` +
        `    asunto:  ${correo.asunto}\n` +
        `${correo.texto
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n")}\n`,
    );
    return { simulado: true };
  }

  const de = process.env.EMAIL_FROM ?? "Cifra <hola@cifra.mx>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: de,
      to: correo.para,
      subject: correo.asunto,
      html: correo.html,
      text: correo.texto,
    }),
  });

  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`Resend rechazó el envío (${res.status}): ${detalle}`);
  }
  return { simulado: false };
}
