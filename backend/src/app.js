const express = require('express');
const cors = require('cors');
const healthRoutes = require('./modules/health/health.routes');
const authRoutes = require('./modules/auth/auth.routes');
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
  app.use((req, res, next) => next(new AppError(404, 'NOT_FOUND', 'Ruta no encontrada')));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
