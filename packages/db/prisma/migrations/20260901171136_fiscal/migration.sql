-- CreateEnum
CREATE TYPE "Periodicidad" AS ENUM ('mensual', 'bimestral', 'anual');

-- CreateEnum
CREATE TYPE "TipoCfdi" AS ENUM ('ingreso', 'egreso', 'nomina', 'pago', 'traslado');

-- CreateEnum
CREATE TYPE "DireccionCfdi" AS ENUM ('emitido', 'recibido');

-- CreateEnum
CREATE TYPE "EstadoSat" AS ENUM ('vigente', 'cancelado');

-- CreateEnum
CREATE TYPE "EstadoInternoCfdi" AS ENUM ('sin_clasificar', 'clasificado', 'revisar_deduccion');

-- CreateEnum
CREATE TYPE "OrigenCfdi" AS ENUM ('sat', 'xml_subido', 'prefactura_conciliada');

-- CreateEnum
CREATE TYPE "TipoImpuesto" AS ENUM ('IVA', 'ISR', 'IEPS');

-- CreateEnum
CREATE TYPE "ClasificacionImpuesto" AS ENUM ('trasladado', 'retenido');

-- CreateEnum
CREATE TYPE "OrigenCuenta" AS ENUM ('agregacion', 'estado_de_cuenta', 'manual');

-- CreateEnum
CREATE TYPE "EstadoCuenta" AS ENUM ('conectada', 'requiere_reautorizacion', 'error');

-- CreateEnum
CREATE TYPE "Naturaleza" AS ENUM ('deudora', 'acreedora');

-- CreateEnum
CREATE TYPE "TipoPoliza" AS ENUM ('diario', 'ingresos', 'egresos');

-- CreateEnum
CREATE TYPE "OrigenPoliza" AS ENUM ('cfdi', 'banco', 'manual');

-- CreateEnum
CREATE TYPE "TipoDeclaracion" AS ENUM ('iva_definitivo', 'isr_provisional', 'diot', 'anual');

-- CreateEnum
CREATE TYPE "EstadoDeclaracion" AS ENUM ('estimada', 'preparada', 'presentada', 'pagada');

-- CreateEnum
CREATE TYPE "EstadoSincronizacion" AS ENUM ('corriendo', 'ok', 'error');

-- CreateTable
CREATE TABLE "constancia" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "leida_en" TIMESTAMP(3) NOT NULL,
    "regimenes" TEXT[],
    "domicilio" JSONB,
    "archivo_url" TEXT,

    CONSTRAINT "constancia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligacion" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "clave" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "periodicidad" "Periodicidad" NOT NULL,
    "dia_limite" INTEGER,
    "vigente_desde" TIMESTAMP(3) NOT NULL,
    "vigente_hasta" TIMESTAMP(3),

    CONSTRAINT "obligacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cfdi" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "uuid" TEXT NOT NULL,
    "tipo" "TipoCfdi" NOT NULL,
    "direccion" "DireccionCfdi" NOT NULL,
    "origen" "OrigenCfdi" NOT NULL,
    "serie" TEXT,
    "folio" TEXT,
    "emisor_rfc" TEXT NOT NULL,
    "emisor_nombre" TEXT NOT NULL,
    "receptor_rfc" TEXT NOT NULL,
    "receptor_nombre" TEXT NOT NULL,
    "fecha_emision" TIMESTAMP(3) NOT NULL,
    "fecha_timbrado" TIMESTAMP(3) NOT NULL,
    "subtotal" BIGINT NOT NULL,
    "descuento" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL,
    "uso_cfdi" TEXT,
    "metodo_pago" TEXT,
    "forma_pago" TEXT,
    "conceptos" JSONB NOT NULL,
    "estado_sat" "EstadoSat" NOT NULL DEFAULT 'vigente',
    "cancelado_en" TIMESTAMP(3),
    "motivo_cancelacion" TEXT,
    "estado_interno" "EstadoInternoCfdi" NOT NULL DEFAULT 'sin_clasificar',
    "cuenta_contable_id" UUID,
    "cuenta_sugerida_por_ia" BOOLEAN NOT NULL DEFAULT false,
    "confianza_sugerencia" DOUBLE PRECISION,
    "liquidado" BOOLEAN NOT NULL DEFAULT false,
    "fecha_liquidacion" TIMESTAMP(3),
    "xml_url" TEXT,
    "pdf_url" TEXT,

    CONSTRAINT "cfdi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cfdi_impuesto" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "cfdi_id" UUID NOT NULL,
    "impuesto" "TipoImpuesto" NOT NULL,
    "clasificacion" "ClasificacionImpuesto" NOT NULL,
    "tasa" DECIMAL(7,4) NOT NULL,
    "importe_centavos" BIGINT NOT NULL,

    CONSTRAINT "cfdi_impuesto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuenta_bancaria" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "institucion" TEXT NOT NULL,
    "mascara" TEXT,
    "tipo" TEXT NOT NULL,
    "origen" "OrigenCuenta" NOT NULL,
    "estado" "EstadoCuenta" NOT NULL DEFAULT 'conectada',
    "saldo" BIGINT NOT NULL DEFAULT 0,
    "ultimo_sync" TIMESTAMP(3),

    CONSTRAINT "cuenta_bancaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimiento_bancario" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "cuenta_bancaria_id" UUID NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "descripcion_banco" TEXT NOT NULL,
    "monto" BIGINT NOT NULL,
    "saldo" BIGINT,
    "conciliado" BOOLEAN NOT NULL DEFAULT false,
    "cfdi_id" UUID,
    "poliza_id" UUID,
    "sugerencia" JSONB,

    CONSTRAINT "movimiento_bancario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuenta_contable" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "naturaleza" "Naturaleza" NOT NULL,
    "nivel" INTEGER NOT NULL DEFAULT 1,
    "padre_id" UUID,
    "codigo_agrupador_sat" TEXT,

    CONSTRAINT "cuenta_contable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poliza" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "folio" TEXT NOT NULL,
    "tipo" "TipoPoliza" NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "concepto" TEXT NOT NULL,
    "origen_tipo" "OrigenPoliza" NOT NULL,
    "origen_cfdi_id" UUID,
    "origen_texto" TEXT,
    "generada_por" TEXT NOT NULL DEFAULT 'cifra',
    "alerta" TEXT,
    "revertida_por_id" UUID,

    CONSTRAINT "poliza_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asiento" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "poliza_id" UUID NOT NULL,
    "cuenta_contable_id" UUID NOT NULL,
    "debe" BIGINT NOT NULL DEFAULT 0,
    "haber" BIGINT NOT NULL DEFAULT 0,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "cfdi_id" UUID,

    CONSTRAINT "asiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "declaracion" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "periodo" TEXT NOT NULL,
    "tipo" "TipoDeclaracion" NOT NULL,
    "estado" "EstadoDeclaracion" NOT NULL DEFAULT 'estimada',
    "calculo" JSONB NOT NULL,
    "fecha_limite" TIMESTAMP(3) NOT NULL,
    "presentada_en" TIMESTAMP(3),
    "acuse_url" TEXT,
    "linea_captura" TEXT,

    CONSTRAINT "declaracion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tarifa_isr" (
    "id" UUID NOT NULL,
    "ejercicio" INTEGER NOT NULL,
    "tramos" JSONB NOT NULL,
    "fuente" TEXT,

    CONSTRAINT "tarifa_isr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacion" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "severidad" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "pantalla_destino" TEXT,
    "entidad_tipo" TEXT,
    "entidad_id" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leida_en" TIMESTAMP(3),

    CONSTRAINT "notificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversacion_ia" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversacion_ia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensaje_ia" (
    "id" UUID NOT NULL,
    "conversacion_id" UUID NOT NULL,
    "rol" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "fuentes" TEXT,
    "referencias" JSONB,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensaje_ia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sincronizacion_sat" (
    "id" UUID NOT NULL,
    "contribuyente_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "estado" "EstadoSincronizacion" NOT NULL,
    "iniciada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminada_en" TIMESTAMP(3),
    "corte" TIMESTAMP(3),
    "codigo_error" TEXT,
    "mensaje_error" TEXT,
    "cfdi_nuevos" INTEGER NOT NULL DEFAULT 0,
    "intentos" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sincronizacion_sat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "constancia_contribuyente_id_leida_en_idx" ON "constancia"("contribuyente_id", "leida_en");

-- CreateIndex
CREATE INDEX "obligacion_contribuyente_id_idx" ON "obligacion"("contribuyente_id");

-- CreateIndex
CREATE INDEX "cfdi_uuid_idx" ON "cfdi"("uuid");

-- CreateIndex
CREATE INDEX "cfdi_contribuyente_id_fecha_emision_idx" ON "cfdi"("contribuyente_id", "fecha_emision");

-- CreateIndex
CREATE INDEX "cfdi_contribuyente_id_estado_sat_idx" ON "cfdi"("contribuyente_id", "estado_sat");

-- CreateIndex
CREATE INDEX "cfdi_contribuyente_id_estado_interno_idx" ON "cfdi"("contribuyente_id", "estado_interno");

-- CreateIndex
CREATE INDEX "cfdi_contribuyente_id_tipo_direccion_idx" ON "cfdi"("contribuyente_id", "tipo", "direccion");

-- CreateIndex
CREATE UNIQUE INDEX "cfdi_contribuyente_id_uuid_key" ON "cfdi"("contribuyente_id", "uuid");

-- CreateIndex
CREATE INDEX "cfdi_impuesto_contribuyente_id_impuesto_clasificacion_idx" ON "cfdi_impuesto"("contribuyente_id", "impuesto", "clasificacion");

-- CreateIndex
CREATE INDEX "cfdi_impuesto_cfdi_id_idx" ON "cfdi_impuesto"("cfdi_id");

-- CreateIndex
CREATE INDEX "cuenta_bancaria_contribuyente_id_idx" ON "cuenta_bancaria"("contribuyente_id");

-- CreateIndex
CREATE INDEX "movimiento_bancario_contribuyente_id_fecha_idx" ON "movimiento_bancario"("contribuyente_id", "fecha");

-- CreateIndex
CREATE INDEX "movimiento_bancario_cuenta_bancaria_id_fecha_idx" ON "movimiento_bancario"("cuenta_bancaria_id", "fecha");

-- CreateIndex
CREATE INDEX "movimiento_bancario_contribuyente_id_conciliado_idx" ON "movimiento_bancario"("contribuyente_id", "conciliado");

-- CreateIndex
CREATE UNIQUE INDEX "cuenta_contable_contribuyente_id_codigo_key" ON "cuenta_contable"("contribuyente_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "poliza_revertida_por_id_key" ON "poliza"("revertida_por_id");

-- CreateIndex
CREATE INDEX "poliza_contribuyente_id_fecha_idx" ON "poliza"("contribuyente_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "poliza_contribuyente_id_folio_key" ON "poliza"("contribuyente_id", "folio");

-- CreateIndex
CREATE INDEX "asiento_contribuyente_id_poliza_id_idx" ON "asiento"("contribuyente_id", "poliza_id");

-- CreateIndex
CREATE UNIQUE INDEX "declaracion_contribuyente_id_periodo_tipo_key" ON "declaracion"("contribuyente_id", "periodo", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "tarifa_isr_ejercicio_key" ON "tarifa_isr"("ejercicio");

-- CreateIndex
CREATE INDEX "notificacion_contribuyente_id_leida_en_creado_en_idx" ON "notificacion"("contribuyente_id", "leida_en", "creado_en");

-- CreateIndex
CREATE INDEX "conversacion_ia_contribuyente_id_creado_en_idx" ON "conversacion_ia"("contribuyente_id", "creado_en");

-- CreateIndex
CREATE INDEX "mensaje_ia_conversacion_id_creado_en_idx" ON "mensaje_ia"("conversacion_id", "creado_en");

-- CreateIndex
CREATE INDEX "sincronizacion_sat_contribuyente_id_tipo_iniciada_en_idx" ON "sincronizacion_sat"("contribuyente_id", "tipo", "iniciada_en");

-- AddForeignKey
ALTER TABLE "constancia" ADD CONSTRAINT "constancia_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligacion" ADD CONSTRAINT "obligacion_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cfdi" ADD CONSTRAINT "cfdi_cuenta_contable_id_fkey" FOREIGN KEY ("cuenta_contable_id") REFERENCES "cuenta_contable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cfdi" ADD CONSTRAINT "cfdi_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cfdi_impuesto" ADD CONSTRAINT "cfdi_impuesto_cfdi_id_fkey" FOREIGN KEY ("cfdi_id") REFERENCES "cfdi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cfdi_impuesto" ADD CONSTRAINT "cfdi_impuesto_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuenta_bancaria" ADD CONSTRAINT "cuenta_bancaria_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_bancario" ADD CONSTRAINT "movimiento_bancario_cfdi_id_fkey" FOREIGN KEY ("cfdi_id") REFERENCES "cfdi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_bancario" ADD CONSTRAINT "movimiento_bancario_poliza_id_fkey" FOREIGN KEY ("poliza_id") REFERENCES "poliza"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_bancario" ADD CONSTRAINT "movimiento_bancario_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_bancario" ADD CONSTRAINT "movimiento_bancario_cuenta_bancaria_id_fkey" FOREIGN KEY ("cuenta_bancaria_id") REFERENCES "cuenta_bancaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuenta_contable" ADD CONSTRAINT "cuenta_contable_padre_id_fkey" FOREIGN KEY ("padre_id") REFERENCES "cuenta_contable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuenta_contable" ADD CONSTRAINT "cuenta_contable_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poliza" ADD CONSTRAINT "poliza_origen_cfdi_id_fkey" FOREIGN KEY ("origen_cfdi_id") REFERENCES "cfdi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poliza" ADD CONSTRAINT "poliza_revertida_por_id_fkey" FOREIGN KEY ("revertida_por_id") REFERENCES "poliza"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poliza" ADD CONSTRAINT "poliza_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asiento" ADD CONSTRAINT "asiento_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asiento" ADD CONSTRAINT "asiento_poliza_id_fkey" FOREIGN KEY ("poliza_id") REFERENCES "poliza"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asiento" ADD CONSTRAINT "asiento_cuenta_contable_id_fkey" FOREIGN KEY ("cuenta_contable_id") REFERENCES "cuenta_contable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asiento" ADD CONSTRAINT "asiento_cfdi_id_fkey" FOREIGN KEY ("cfdi_id") REFERENCES "cfdi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaracion" ADD CONSTRAINT "declaracion_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversacion_ia" ADD CONSTRAINT "conversacion_ia_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensaje_ia" ADD CONSTRAINT "mensaje_ia_conversacion_id_fkey" FOREIGN KEY ("conversacion_id") REFERENCES "conversacion_ia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sincronizacion_sat" ADD CONSTRAINT "sincronizacion_sat_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Vuelve a correr rls.sql: idempotente, aplica la política de aislamiento a
-- las tablas fiscales nuevas que arriba quedaron con contribuyente_id no nulo.
-- Contenido de handoff/backend/rls.sql, tal cual — no se aplica a mano.
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
