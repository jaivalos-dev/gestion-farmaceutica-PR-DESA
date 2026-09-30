const AppError = require('../shared/AppError');

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof AppError) {
    return res.status(error.status).json({
      ok: false, code: error.code, message: error.message,
    });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, code: 'INVALID_JSON', message: 'JSON inválido' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, code: 'PAYLOAD_TOO_LARGE', message: 'Solicitud demasiado grande' });
  }
  console.error('[HTTP] INTERNAL_ERROR');
  return res.status(500).json({
    ok: false, code: 'INTERNAL_ERROR', message: 'Error interno del servidor',
  });
}

module.exports = errorHandler;
