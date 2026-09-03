-- mensaje_ia no tenía contribuyente_id y quedaba fuera de rls.sql: un mensaje de la IA de un
-- contribuyente era visible para otro. Se denormaliza contribuyente_id (como en asiento) y la
-- FK a la conversación pasa a ser compuesta sobre (contribuyente_id, conversacion_id) contra
-- conversacion_ia(contribuyente_id, id) — el contribuyente_id del mensaje no puede divergir del
-- de su conversación ni ser inventado.
--
-- La tabla está vacía en todos los entornos (la capa de IA todavía no escribe), así que ADD
-- COLUMN ... NOT NULL sin default es seguro.

-- DropForeignKey
ALTER TABLE "mensaje_ia" DROP CONSTRAINT "mensaje_ia_conversacion_id_fkey";

-- DropIndex
DROP INDEX "mensaje_ia_conversacion_id_creado_en_idx";

-- AlterTable
ALTER TABLE "mensaje_ia" ADD COLUMN     "contribuyente_id" UUID NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "conversacion_ia_contribuyente_id_id_key" ON "conversacion_ia"("contribuyente_id", "id");

-- CreateIndex
CREATE INDEX "mensaje_ia_contribuyente_id_conversacion_id_creado_en_idx" ON "mensaje_ia"("contribuyente_id", "conversacion_id", "creado_en");

-- AddForeignKey
ALTER TABLE "mensaje_ia" ADD CONSTRAINT "mensaje_ia_contribuyente_id_conversacion_id_fkey" FOREIGN KEY ("contribuyente_id", "conversacion_id") REFERENCES "conversacion_ia"("contribuyente_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- rls.sql (§2) — de nuevo, ahora que mensaje_ia gana contribuyente_id no nulo.
-- Idempotente: vuelve a barrer TODA tabla con contribuyente_id NOT NULL y (re)aplica la
-- política. Ver handoff/backend/rls.sql y packages/db/README.md.
-- ─────────────────────────────────────────────────────────────────────────────

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
