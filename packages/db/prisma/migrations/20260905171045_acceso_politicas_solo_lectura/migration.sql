-- ─────────────────────────────────────────────────────────────────────────────
-- Paso 8 — cerrar un hueco de escritura en las políticas nuevas de `acceso`.
--
-- acceso_propio y acceso_por_token se crearon con `CREATE POLICY ... USING (...)` a secas, que
-- es FOR ALL y sin WITH CHECK: la escritura hereda el USING y no valida nada. Como son
-- permisivas (OR), eso dejaba que:
--   · un usuario autenticado hiciera UPDATE de su propia fila de `acceso` — incluido `rol`
--     (un solo_lectura podría subirse a contador);
--   · quien conociera un token de invitación escribiera esa fila ENTERA, no solo leerla.
-- Hoy ningún endpoint lo hace, pero la política tiene que aguantar el que alguien escriba
-- después.
--
-- acceso_propio y cartera_por_acceso solo se usan para LEER (la cartera del despacho) → FOR
-- SELECT. acceso_por_token necesita, además de leer la invitación, poder ACEPTARLA: pasar de
-- `invitado` a `activo` y fijar `usuario_id`, y NADA más. Eso son dos piezas:
--   · una política FOR UPDATE con USING (solo filas todavía `invitado`) y WITH CHECK (el
--     resultado tiene que quedar `activo` con `usuario_id`);
--   · un trigger BEFORE UPDATE que, cuando la sesión actúa por token de invitación (y no por
--     contribuyente), rechaza cualquier cambio a `rol`, `contribuyente_id`, `email` o `token`.
--     WITH CHECK por sí solo no puede: RLS no ve el valor viejo de la fila, solo el nuevo.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1 · acceso_propio: solo lectura (la cartera lee los Acceso propios del usuario; nadie escribe
--     su propia fila "porque es suya").
DROP POLICY IF EXISTS acceso_propio ON public.acceso;
CREATE POLICY acceso_propio ON public.acceso
  FOR SELECT
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::uuid);

-- 2 · cartera_por_acceso: solo lectura (la cartera del despacho solo lee resumen_contribuyente;
--     los trabajos lo escriben por app.contribuyente_id, vía aislamiento_contribuyente).
DROP POLICY IF EXISTS cartera_por_acceso ON public.resumen_contribuyente;
CREATE POLICY cartera_por_acceso ON public.resumen_contribuyente
  FOR SELECT
  USING (contribuyente_id IN (
    SELECT contribuyente_id FROM acceso
    WHERE usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::uuid
      AND estado = 'activo'
  ));

-- 3 · acceso_por_token: leer la invitación …
DROP POLICY IF EXISTS acceso_por_token ON public.acceso;
CREATE POLICY acceso_por_token ON public.acceso
  FOR SELECT
  USING (token IS NOT NULL AND token = NULLIF(current_setting('app.token_invitacion', true), ''));

-- … y aceptarla: solo filas todavía `invitado`, y el resultado tiene que quedar `activo` con
--     usuario_id. La inmutabilidad de rol/contribuyente_id/email/token la pone el trigger de
--     abajo (WITH CHECK no ve el valor viejo).
CREATE POLICY acceso_por_token_activar ON public.acceso
  FOR UPDATE
  USING (
    token IS NOT NULL
    AND token = NULLIF(current_setting('app.token_invitacion', true), '')
    AND estado = 'invitado'
  )
  WITH CHECK (
    token = NULLIF(current_setting('app.token_invitacion', true), '')
    AND estado = 'activo'
    AND usuario_id IS NOT NULL
  );

-- 4 · Trigger: cuando la sesión actúa por token de invitación (y no por contribuyente), un
--     UPDATE de `acceso` solo puede tocar `estado` (invitado → activo) y `usuario_id`.
CREATE OR REPLACE FUNCTION public.acceso_token_solo_activa() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NULLIF(current_setting('app.token_invitacion', true), '') IS NOT NULL
     AND NULLIF(current_setting('app.contribuyente_id', true), '') IS NULL THEN
    IF NEW.rol IS DISTINCT FROM OLD.rol
       OR NEW.contribuyente_id IS DISTINCT FROM OLD.contribuyente_id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.token IS DISTINCT FROM OLD.token
       OR NEW.invitado_en IS DISTINCT FROM OLD.invitado_en
       OR NEW.expira_en IS DISTINCT FROM OLD.expira_en THEN
      RAISE EXCEPTION 'aceptar una invitación por token solo puede fijar estado=activo y usuario_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS acceso_token_solo_activa ON public.acceso;
CREATE TRIGGER acceso_token_solo_activa
  BEFORE UPDATE ON public.acceso
  FOR EACH ROW EXECUTE FUNCTION public.acceso_token_solo_activa();
