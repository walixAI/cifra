// Un solo camino de envío de correo para todo apps/web: el magic link de Auth.js (lib/auth.ts)
// y el correo de invitación (lib/invitaciones.ts, paso 8) pasan por aquí. Resend por SMTP —
// EMAIL_SERVER/EMAIL_FROM ya lo asumen así en .env.example y en handoff/DESPLIEGUE.md.
//
// Sin EMAIL_SERVER configurado:
//   - en desarrollo, se simula: el enlace queda impreso en consola con una etiqueta que no deja
//     dudas de que no se mandó nada de verdad — nunca debe parecer que funcionó.
//   - en producción o preview, es un error explícito, no una simulación silenciosa. Un envío que
//     "funciona" pero no manda nada es peor que uno que avisa que falta configurar Resend: se
//     vuelve el estado `error` de la máquina de invitar (README §4.1), nunca un `sent` falso.

import nodemailer from "nodemailer";

export interface CorreoAEnviar {
  para: string;
  asunto: string;
  texto: string;
  html: string;
}

export class CorreoNoConfigurado extends Error {
  constructor() {
    super("EMAIL_SERVER no está configurado. En producción esto no se simula — hay que ponerlo.");
    this.name = "CorreoNoConfigurado";
  }
}

export async function enviarCorreo(correo: CorreoAEnviar): Promise<{ simulado: boolean }> {
  const servidor = process.env.EMAIL_SERVER;

  if (!servidor) {
    if (process.env.NODE_ENV === "production") throw new CorreoNoConfigurado();

    console.log(
      `\n✉️  [correo simulado — falta EMAIL_SERVER, nada se mandó de verdad]\n` +
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
  const transportador = nodemailer.createTransport(servidor);
  await transportador.sendMail({
    to: correo.para,
    from: de,
    subject: correo.asunto,
    text: correo.texto,
    html: correo.html,
  });
  return { simulado: false };
}
