const tokens = require('../shared/tokens');
const AppError = require('../shared/AppError');

function authenticate(req, res, next) {
  const match = /^Bearer ([^\s]+)$/i.exec(req.get('Authorization') ?? '');
  try {
    if (!match) throw new Error('Bearer ausente');
    req.user = tokens.verify(match[1]);
  } catch {
    return next(new AppError(401, 'UNAUTHORIZED', 'Autenticación requerida'));
  }
  return next();
}

module.exports = authenticate;
