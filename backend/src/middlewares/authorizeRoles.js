const AppError = require('../shared/AppError');

function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError(401, 'UNAUTHORIZED', 'Autenticación requerida'));
    if (!roles.some(role => typeof role === 'number'
      ? role === req.user.id_rol : role === req.user.nombre_rol)) {
      return next(new AppError(403, 'FORBIDDEN', 'Acceso no autorizado'));
    }
    return next();
  };
}

module.exports = authorizeRoles;
