-- ─────────────────────────────────────────────────────────────────────────────
-- Nada del producto borra registros fiscales: una póliza se revierte con otra en
-- contra, un CFDI cancelado se marca, una declaración se sustituye — nunca DELETE.
-- Hasta ahora eso lo sostenía solo la disciplina de quien escribiera el endpoint.
-- Aquí pasa a garantizarlo la base, quitándole el privilegio a `cifra_app` (el rol
-- con el que se conecta la app; las migraciones corren con el dueño).
--
-- Ya aplicado a mano en producción (Neon); esta migración lo lleva a local, CI y
-- los previews. REVOKE es idempotente: re-ejecutarlo donde ya se hizo es un no-op.
--
-- cfdi_impuesto queda FUERA a propósito: los impuestos son propiedad del
-- comprobante y la sincronización del SAT los reemplaza enteros
-- (deleteMany + createMany en apps/trabajos/src/servicios/sincronizar.ts).
--
-- Cuerpo espejo en handoff/backend/rls.sql, junto al REVOKE de bitacora.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE DELETE ON TABLE cfdi, poliza, asiento, declaracion FROM cifra_app;
