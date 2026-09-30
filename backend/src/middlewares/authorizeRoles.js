const AppError = require('../shared/AppError');

function authorizeRoles(...roleIds) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError(401, 'UNAUTHORIZED', 'Autenticación requerida'));
    if (!roleIds.includes(req.user.id_rol)) {
      return next(new AppError(403, 'FORBIDDEN', 'Acceso no autorizado'));
    }
    return next();
  };
}

module.exports = authorizeRoles;
