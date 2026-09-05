-- CreateTable
CREATE TABLE "token_verificacion" (
    "identificador" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expira_en" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "token_verificacion_token_key" ON "token_verificacion"("token");

-- CreateIndex
CREATE UNIQUE INDEX "token_verificacion_identificador_token_key" ON "token_verificacion"("identificador", "token");

-- ─────────────────────────────────────────────────────────────────────────────
-- Paso 8 — dos políticas nuevas, permisivas (se combinan con OR con la que ya existe en cada
-- tabla, nunca la reemplazan). cifra_app nunca deja de estar sujeto a RLS.
--
-- La autorización se deriva DE LA BASE, nunca de un dato que la app arme y entregue por GUC.
-- El único dato que aporta la aplicación es la identidad del usuario (app.usuario_id); qué
-- contribuyentes le tocan lo decide Postgres consultando `acceso`, dentro de la propia política.
-- Una versión anterior de esta migración fijaba una lista de contribuyente_id por sesión
-- (app.contribuyente_ids) y la política solo comprobaba membresía en esa lista — eso apaga la
-- red de seguridad de RLS para esta tabla: si el código arma mal la lista, la política la
-- aprueba igual, exactamente el modelo de confianza del que RLS existe para proteger (regla #7
-- de CLAUDE.md: "la app se conecta con un rol que no puede saltarse las políticas" — sin
-- excepción para la cartera). Se corrige antes de pushear nada.
--
-- 1) acceso: además de "es el contribuyente activo" (la política de siempre), una fila también
--    es visible si su usuario_id es la sesión actual — sin conocer de antemano ningún
--    contribuyente_id. Hace falta para que la subconsulta de (2) pueda leer `acceso` sin
--    fijar antes un contribuyente_id.
-- 2) resumen_contribuyente: visible si el usuario de la sesión tiene un Acceso activo a ese
--    contribuyente — el IN explícito que pide ARQUITECTURA-MULTIINQUILINO.md §6, pero resuelto
--    dentro de la política contra la tabla de autorización real, no contra una lista que llegó
--    de fuera. Una sola llamada de la app (prismaParaUsuario) alcanza: Postgres resuelve la
--    subconsulta como parte del mismo plan, no como una segunda ida y vuelta de la aplicación.
-- Cuerpo espejo en handoff/backend/rls.sql.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY acceso_propio ON public.acceso
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::uuid);

CREATE POLICY cartera_por_acceso ON public.resumen_contribuyente
  USING (contribuyente_id IN (
    SELECT contribuyente_id FROM acceso
    WHERE usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::uuid
      AND estado = 'activo'
  ));
