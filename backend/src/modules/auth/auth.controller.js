const service = require('./auth.service');
const AppError = require('../../shared/AppError');

async function login(req, res) {
  const { correo, password } = req.body ?? {};
  if (typeof correo !== 'string' || correo.trim().length > 120 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim()) ||
      typeof password !== 'string' || !password.length ||
      Buffer.byteLength(password, 'utf8') > 72) {
    throw new AppError(400, 'INVALID_INPUT', 'Correo o contraseña con formato inválido');
  }
  const data = await service.login(correo.trim(), password);
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, data, message: 'Autenticación exitosa' });
}

module.exports = { login };
