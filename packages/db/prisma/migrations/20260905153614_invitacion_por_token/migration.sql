-- creada_en: Invitacion no lo tenía, y el estado `conflict` de §4.1 ("ya está en tu equipo
-- desde el {fecha}") necesita una fecha. Default now() para las filas que ya existan (no hay,
-- pero por si acaso).
ALTER TABLE "invitacion" ADD COLUMN "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ─────────────────────────────────────────────────────────────────────────────
-- Paso 8 (fase 3) — aceptar una invitación por su token.
--
-- `acceso` está bajo RLS por contribuyente_id, pero quien abre el enlace de invitación todavía
-- no tiene sesión con alcance a ningún contribuyente — ni debería tener que adivinarlo. El
-- token de la invitación (Acceso.token, UUID de alta entropía) ES la autorización para ver esa
-- fila, igual que un enlace de recuperación de contraseña: la política deriva el permiso de un
-- hecho que quien pide demuestra (conocer el token), comparado contra la columna de la propia
-- fila — no de una lista que la app arme.
--
-- Permisiva, se combina con OR con las que ya existen sobre `acceso`. Solo una fila a la vez:
-- el token es único.
-- Cuerpo espejo en handoff/backend/rls.sql.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY acceso_por_token ON public.acceso
  USING (token IS NOT NULL AND token = NULLIF(current_setting('app.token_invitacion', true), ''));
