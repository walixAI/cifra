-- No hace falta volver a incluir rls.sql aquí: resumen_contribuyente ya tiene la política desde
-- la migración _plataforma. rls.sql solo hay que repetirlo cuando una TABLA nueva gana
-- contribuyente_id por primera vez, no cuando una tabla ya protegida gana columnas.

-- AlterTable
ALTER TABLE "resumen_contribuyente" ADD COLUMN     "deducciones_acumuladas_centavos" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "ingresos_acumulados_centavos" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "isr_pagado_acumulado_centavos" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "isr_retenido_patron_centavos" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "isr_retenido_pm_centavos" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "iva_acreditable_centavos" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "iva_retenido_centavos" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "iva_trasladado_centavos" BIGINT NOT NULL DEFAULT 0;
