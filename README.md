# Cifra

Contabilidad inteligente para contribuyentes mexicanos. Ver `CLAUDE.md` para el contexto del
proyecto y `handoff/README.md` para la especificación completa.

## Andamio

Monorepo con pnpm workspaces.

```
apps/web            Next.js 15 (App Router, TypeScript) — UI + API
packages/core        motor de dominio puro: impuestos, contabilidad, validadores, observadores
packages/db          Prisma: esquema, migraciones, RLS, seed
packages/sat         cliente del SAT, aislado y falseable
packages/cfdi        catálogos versionados + validación de prefacturas
packages/ia          intenciones, acciones, comandos, narrador, pedagogía, hábitos
packages/ui          tokens.css + primitivas
```

`apps/trabajos` (Inngest) se agrega en el paso 7 de `PRIMEROS-PASOS.md`.

## Desarrollo

```bash
pnpm install
pnpm dev         # levanta apps/web en http://localhost:3000
pnpm typecheck   # tsc --noEmit en todos los paquetes
```
