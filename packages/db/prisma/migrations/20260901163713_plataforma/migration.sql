-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TipoOrganizacion" AS ENUM ('personal', 'despacho');

-- CreateEnum
CREATE TYPE "RolOrganizacion" AS ENUM ('propietario', 'admin', 'miembro');

-- CreateEnum
CREATE TYPE "RolAcceso" AS ENUM ('propietario_fiscal', 'contador', 'captura', 'solo_lectura');

-- CreateEnum
CREATE TYPE "EstadoAcceso" AS ENUM ('invitado', 'activo', 'revocado');

-- CreateEnum
CREATE TYPE "TipoCredencial" AS ENUM ('ciec', 'efirma');

-- CreateEnum
CREATE TYPE "AlcanceCredencial" AS ENUM ('lectura_sat', 'presentacion');

-- CreateEnum
CREATE TYPE "EstadoSolicitud" AS ENUM ('pendiente', 'aprobada', 'rechazada', 'expirada', 'presentada');

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT,
    "email_verificado_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizacion" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoOrganizacion" NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membresia" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "rol" "RolOrganizacion" NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membresia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribuyente" (
    "id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "rfc" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "nombre_completo" TEXT,
    "tipo_persona" TEXT NOT NULL,
    "regimenes" JSONB NOT NULL DEFAULT '[]',
    "plan" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "responsable_id" UUID,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contribuyente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acceso" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "usuario_id" UUID,
    "email" TEXT NOT NULL,
    "rol" "RolAcceso" NOT NULL,
    "estado" "EstadoAcceso" NOT NULL DEFAULT 'invitado',
    "invitado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "token" TEXT,
    "revocado_en" TIMESTAMP(3),

    CONSTRAINT "acceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitacion" (
    "id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "rol" "RolOrganizacion" NOT NULL,
    "token" TEXT NOT NULL,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "aceptada_en" TIMESTAMP(3),

    CONSTRAINT "invitacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credencial_fiscal" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "tipo" "TipoCredencial" NOT NULL,
    "material_cifrado" BYTEA NOT NULL,
    "llave_datos_cifrada" BYTEA NOT NULL,
    "kms_key_id" TEXT,
    "huella" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credencial_fiscal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autorizacion_credencial" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "alcance" "AlcanceCredencial" NOT NULL,
    "otorgada_por" UUID NOT NULL,
    "otorgada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocada_en" TIMESTAMP(3),

    CONSTRAINT "autorizacion_credencial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitud_presentacion" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "declaracion_id" UUID NOT NULL,
    "solicitada_por" UUID NOT NULL,
    "solicitada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" "EstadoSolicitud" NOT NULL DEFAULT 'pendiente',
    "hash_calculo" TEXT NOT NULL,
    "aprobada_por" UUID,
    "aprobada_en" TIMESTAMP(3),
    "aprobada_ip" TEXT,
    "expira_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitud_presentacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sincronizacion_rfc" (
    "rfc" TEXT NOT NULL,
    "arrendamiento_hasta" TIMESTAMP(3),
    "worker_id" TEXT,
    "cursor" TIMESTAMP(3),
    "ultimo_intento" TIMESTAMP(3),
    "ultimo_error" TEXT,
    "proximo_intento_en" TIMESTAMP(3),

    CONSTRAINT "sincronizacion_rfc_pkey" PRIMARY KEY ("rfc")
);

-- CreateTable
CREATE TABLE "resumen_contribuyente" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "periodo" TEXT NOT NULL,
    "ingresos_centavos" BIGINT NOT NULL DEFAULT 0,
    "gastos_centavos" BIGINT NOT NULL DEFAULT 0,
    "iva_centavos" BIGINT NOT NULL DEFAULT 0,
    "isr_centavos" BIGINT NOT NULL DEFAULT 0,
    "cfdi_sin_clasificar" INTEGER NOT NULL DEFAULT 0,
    "movimientos_sin_conciliar" INTEGER NOT NULL DEFAULT 0,
    "cuadre_estado" TEXT NOT NULL DEFAULT 'ok',
    "cierre_pasos_completos" INTEGER NOT NULL DEFAULT 0,
    "proxima_obligacion" TIMESTAMP(3),
    "sat_stale" BOOLEAN NOT NULL DEFAULT false,
    "sat_corte" TIMESTAMP(3),
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resumen_contribuyente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bitacora" (
    "id" UUID NOT NULL,
    "usuario_id" UUID,
    "organizacion_id" UUID,
    "contribuyente_id" UUID,
    "accion" TEXT NOT NULL,
    "entidad" TEXT,
    "entidad_id" TEXT,
    "ip" TEXT,
    "metadatos" JSONB,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bitacora_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suscripcion" (
    "id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "plan" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "rfc_incluidos" INTEGER NOT NULL,
    "periodo_fin" TIMESTAMP(3),
    "proveedor_id" TEXT,

    CONSTRAINT "suscripcion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE INDEX "membresia_organizacion_id_idx" ON "membresia"("organizacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "membresia_usuario_id_organizacion_id_key" ON "membresia"("usuario_id", "organizacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "contribuyente_slug_key" ON "contribuyente"("slug");

-- CreateIndex
CREATE INDEX "contribuyente_organizacion_id_activo_idx" ON "contribuyente"("organizacion_id", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "contribuyente_organizacion_id_rfc_key" ON "contribuyente"("organizacion_id", "rfc");

-- CreateIndex
CREATE UNIQUE INDEX "acceso_token_key" ON "acceso"("token");

-- CreateIndex
CREATE INDEX "acceso_usuario_id_estado_idx" ON "acceso"("usuario_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "acceso_contribuyente_id_email_key" ON "acceso"("contribuyente_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "invitacion_token_key" ON "invitacion"("token");

-- CreateIndex
CREATE UNIQUE INDEX "invitacion_organizacion_id_email_key" ON "invitacion"("organizacion_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "credencial_fiscal_contribuyente_id_tipo_key" ON "credencial_fiscal"("contribuyente_id", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "autorizacion_credencial_contribuyente_id_organizacion_id_al_key" ON "autorizacion_credencial"("contribuyente_id", "organizacion_id", "alcance");

-- CreateIndex
CREATE INDEX "solicitud_presentacion_contribuyente_id_estado_idx" ON "solicitud_presentacion"("contribuyente_id", "estado");

-- CreateIndex
CREATE INDEX "resumen_contribuyente_periodo_proxima_obligacion_idx" ON "resumen_contribuyente"("periodo", "proxima_obligacion");

-- CreateIndex
CREATE UNIQUE INDEX "resumen_contribuyente_contribuyente_id_periodo_key" ON "resumen_contribuyente"("contribuyente_id", "periodo");

-- CreateIndex
CREATE INDEX "bitacora_contribuyente_id_creado_en_idx" ON "bitacora"("contribuyente_id", "creado_en");

-- CreateIndex
CREATE INDEX "bitacora_organizacion_id_creado_en_idx" ON "bitacora"("organizacion_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "suscripcion_organizacion_id_key" ON "suscripcion"("organizacion_id");

-- AddForeignKey
ALTER TABLE "membresia" ADD CONSTRAINT "membresia_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membresia" ADD CONSTRAINT "membresia_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribuyente" ADD CONSTRAINT "contribuyente_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acceso" ADD CONSTRAINT "acceso_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acceso" ADD CONSTRAINT "acceso_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitacion" ADD CONSTRAINT "invitacion_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credencial_fiscal" ADD CONSTRAINT "credencial_fiscal_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autorizacion_credencial" ADD CONSTRAINT "autorizacion_credencial_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autorizacion_credencial" ADD CONSTRAINT "autorizacion_credencial_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_presentacion" ADD CONSTRAINT "solicitud_presentacion_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resumen_contribuyente" ADD CONSTRAINT "resumen_contribuyente_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bitacora" ADD CONSTRAINT "bitacora_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suscripcion" ADD CONSTRAINT "suscripcion_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por contribuyente con Row Level Security.
-- Contenido de handoff/backend/rls.sql, incluido en la migración (no a mano).
-- Es idempotente: cuando el paso 3 agregue tablas fiscales, una migración nueva
-- volverá a incluir este mismo bloque para aplicarles la política.
-- ─────────────────────────────────────────────────────────────────────────

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
