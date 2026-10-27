const express = require('express');
const cors = require('cors');
const healthRoutes = require('./modules/health/health.routes');
const authRoutes = require('./modules/auth/auth.routes');
const sucursalesRoutes = require('./modules/sucursales/sucursales.routes');
const medicamentosRoutes = require('./modules/medicamentos/medicamentos.routes');
const inventarioRoutes = require('./modules/inventario/inventario.routes');
const transferenciasRoutes = require('./modules/transferencias/transferencias.routes');
const ventasRoutes = require('./modules/ventas/ventas.routes');
const cajaRoutes = require('./modules/caja/caja.routes');
const activosRoutes = require('./modules/activos/activos.routes');
const planillaRoutes = require('./modules/planilla/planilla.routes');
const errorHandler = require('./middlewares/errorHandler');
const AppError = require('./shared/AppError');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Sin frontend todavía: no habilitar orígenes externos por defecto.
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/sucursales', sucursalesRoutes);
  app.use('/api/medicamentos', medicamentosRoutes);
  app.use('/api/inventario', inventarioRoutes);
  app.use('/api/transferencias', transferenciasRoutes);
  app.use('/api/ventas', ventasRoutes);
  app.use('/api/caja', cajaRoutes);
  app.use('/api/activos', activosRoutes);
  app.use('/api/planilla', planillaRoutes);
  app.use((req, res, next) => next(new AppError(404, 'NOT_FOUND', 'Ruta no encontrada')));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
