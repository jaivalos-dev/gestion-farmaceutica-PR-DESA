-- 03_indexes.sql
-- Oracle crea indices para PK/UNIQUE, pero no para todas las FK.
-- Estos indices apoyan joins, filtros por sucursal/fecha y auditoria.

CREATE INDEX ix_usuario_sucursal ON USUARIO (id_sucursal);
CREATE INDEX ix_inv_medicamento ON INVENTARIO (id_medicamento);
CREATE INDEX ix_mov_inv_usuario_fecha ON MOVIMIENTO_INVENTARIO (id_usuario, fecha);

CREATE INDEX ix_trans_origen_estado ON TRANSFERENCIA (id_sucursal_origen, estado);
CREATE INDEX ix_trans_destino_estado ON TRANSFERENCIA (id_sucursal_destino, estado);
CREATE INDEX ix_det_trans_med ON DETALLE_TRANSFERENCIA (id_medicamento);

CREATE INDEX ix_venta_sucursal_fecha ON VENTA (id_sucursal, fecha);
CREATE INDEX ix_det_venta_med ON DETALLE_VENTA (id_medicamento);

CREATE INDEX ix_caja_sucursal_fecha ON MOVIMIENTO_CAJA (id_sucursal, fecha);
CREATE INDEX ix_activo_sucursal_estado ON ACTIVO_FIJO (id_sucursal, estado);
CREATE INDEX ix_plan_sucursal_periodo ON GASTO_PLANILLA (id_sucursal, periodo);
CREATE INDEX ix_entrega_sucursal_estado ON ENTREGA (id_sucursal, estado);

CREATE INDEX ix_aud_fecha ON AUDITORIA (fecha_hora);
CREATE INDEX ix_aud_sucursal_fecha ON AUDITORIA (id_sucursal, fecha_hora);
CREATE INDEX ix_aud_usuario_fecha ON AUDITORIA (id_usuario, fecha_hora);
CREATE INDEX ix_aud_modulo_accion ON AUDITORIA (modulo, accion);
