// El servidor de apps/trabajos: expone las funciones de Inngest en /api/inngest.
//
// En local: `pnpm --filter @cifra/trabajos dev` levanta esto en el puerto 3100 y, aparte,
// `npx inngest-cli@latest dev -u http://localhost:3100/api/inngest` corre el runner de Inngest.
// En producción va como un servicio Node aparte de apps/web (Railway/Render/Fly), sincronizado
// con Inngest Cloud — ver §4 de handoff/DESPLIEGUE.md.

import { serve as serveNode } from "@hono/node-server";
import { Hono } from "hono";
import { serve } from "inngest/hono";
import { inngest } from "./inngest/cliente";
import { funciones } from "./inngest/indice";

const app = new Hono();

app.get("/salud", (c) => c.json({ ok: true, funciones: funciones.length }));
app.on(["GET", "POST", "PUT"], "/api/inngest", serve({ client: inngest, functions: funciones }));

const puerto = Number(process.env.PUERTO_TRABAJOS ?? 3100);
serveNode({ fetch: app.fetch, port: puerto }, (info) => {
  console.log(`apps/trabajos escuchando en http://localhost:${info.port}  (${funciones.length} funciones)`);
});
