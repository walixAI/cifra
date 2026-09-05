-- ─────────────────────────────────────────────────────────────────────────────
-- Cifra — aislamiento por contribuyente con Row Level Security
--
-- Se corre como parte de la migración (un archivo en prisma/migrations/), no a
-- mano. Es idempotente: puede volver a correrse cuando se agreguen tablas.
--
-- Modelo: la app se conecta con `cifra_app`, que NO es dueño de las tablas y
-- por lo tanto no puede saltarse las políticas. Las migraciones corren con el
-- dueño. Ver ARQUITECTURA-MULTIINQUILINO.md §4.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1 · Rol de aplicación ------------------------------------------------------
-- (en Neon, crear el rol desde la consola y saltarse este bloque)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cifra_app') THEN
    CREATE ROLE cifra_app LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO cifra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cifra_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cifra_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cifra_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cifra_app;

-- La bitácora es de solo escritura y lectura: nadie la edita ni la borra.
REVOKE UPDATE, DELETE ON TABLE bitacora FROM cifra_app;

-- Los registros fiscales no se borran: se revierten con una póliza en contra o se marcan.
-- Que lo garantice la base y no la disciplina de quien escriba el próximo endpoint.
-- (cfdi_impuesto NO va aquí: los impuestos son propiedad del comprobante y la sincronización
-- del SAT los reemplaza enteros con deleteMany + createMany.)
REVOKE DELETE ON TABLE cfdi, poliza, asiento, declaracion FROM cifra_app;

-- 2 · Política de aislamiento ------------------------------------------------
-- Se aplica a TODA tabla que tenga una columna contribuyente_id no nula.
-- Falla cerrada: si nadie fijó app.contribuyente_id, current_setting devuelve
-- NULL y la comparación no deja pasar ninguna fila.

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name  = 'contribuyente_id'
       AND c.is_nullable  = 'NO'
       AND tb.table_type  = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS aislamiento_contribuyente ON public.%I', t);
    EXECUTE format($pol$
      CREATE POLICY aislamiento_contribuyente ON public.%I
        USING      (contribuyente_id = NULLIF(current_setting('app.contribuyente_id', true), '')::uuid)
        WITH CHECK (contribuyente_id = NULLIF(current_setting('app.contribuyente_id', true), '')::uuid)
    $pol$, t);
  END LOOP;
END $$;

-- 2.1 · Cartera del despacho: la autorización se deriva de `acceso`, no de una lista que la
-- app entregue ------------------------------------------------------------------------------
-- Permisivas, se combinan con OR con la política de arriba en cada tabla — nunca la reemplazan.
-- El único dato que aporta la app es app.usuario_id; qué contribuyentes le tocan lo decide la
-- subconsulta contra `acceso`, dentro de la propia política — si eso viviera en una lista
-- armada por la app (una versión anterior de esto lo hacía), RLS dejaría de ser la red de
-- seguridad para esta tabla: bastaría un bug al armar la lista para que la política la
-- aprobara. Cuerpo real en prisma/migrations/20260905050613_auth_cartera/migration.sql (paso 8).
-- DROP IF EXISTS antes de cada CREATE — igual que el loop de arriba — para que este archivo se
-- pueda volver a correr entero sin tronar (lo dice su propio encabezado: es idempotente).

DROP POLICY IF EXISTS acceso_propio ON public.acceso;
CREATE POLICY acceso_propio ON public.acceso
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::uuid);

DROP POLICY IF EXISTS cartera_por_acceso ON public.resumen_contribuyente;
CREATE POLICY cartera_por_acceso ON public.resumen_contribuyente
  USING (contribuyente_id IN (
    SELECT contribuyente_id FROM acceso
    WHERE usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::uuid
      AND estado = 'activo'
  ));

-- 2.2 · Aceptar una invitación por su token ---------------------------------------------------
-- Quien abre el enlace no tiene sesión con alcance a ningún contribuyente. El token (alto en
-- entropía, único) ES la autorización para ver esa fila — como un enlace de recuperación de
-- contraseña. La política deriva el permiso de un hecho que quien pide demuestra, no de una
-- lista. Cuerpo real en prisma/migrations/20260905153614_invitacion_por_token/migration.sql.

DROP POLICY IF EXISTS acceso_por_token ON public.acceso;
CREATE POLICY acceso_por_token ON public.acceso
  USING (token IS NOT NULL AND token = NULLIF(current_setting('app.token_invitacion', true), ''));

-- 3 · Verificación -----------------------------------------------------------
-- Qué tablas quedaron protegidas y cuáles no (revisa la lista: si alguna tabla
-- con dinero adentro no aparece con rowsecurity = true, le falta la columna).

--   SELECT tablename, rowsecurity, forcerowsecurity
--     FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;

-- Prueba manual del aislamiento:
--
--   SET ROLE cifra_app;
--   SELECT set_config('app.contribuyente_id', '<uuid-A>', false);
--   SELECT count(*) FROM cfdi;                    -- solo los de A
--   SELECT set_config('app.contribuyente_id', '', false);
--   SELECT count(*) FROM cfdi;                    -- 0
--   RESET ROLE;
--
-- En la aplicación esto se hace SIEMPRE con set_config(..., true) — es decir
-- SET LOCAL — dentro de una transacción, porque el pooler de Neon opera en
-- modo transacción y una variable de sesión se filtraría a la siguiente
-- conexión.
