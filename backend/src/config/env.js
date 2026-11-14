
const path = require('node:path');
const dotenv = require('dotenv');

function readConfig(env = process.env) {
  const required = [
    'ORACLE_USER',
    'ORACLE_PASSWORD',
    'ORACLE_CONNECT_STRING',
    'ORACLE_CONFIG_DIR',
    'ORACLE_WALLET_LOCATION',
    'ORACLE_WALLET_PASSWORD',
    'JWT_SECRET',
  ];

  const missing = required.filter((name) => !env[name]?.trim());

  if (missing.length) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  }

  const rawPort = env.PORT ?? '3000';
  const port = Number(rawPort);

  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('PORT debe ser un entero entre 1 y 65535');
  }

  return {
    port,
    jwtSecret: env.JWT_SECRET,

    oracle: {
      user: env.ORACLE_USER.trim(),
      password: env.ORACLE_PASSWORD,
      connectString: env.ORACLE_CONNECT_STRING.trim(),
      configDir: env.ORACLE_CONFIG_DIR.trim(),
      walletLocation: env.ORACLE_WALLET_LOCATION.trim(),
      walletPassword: env.ORACLE_WALLET_PASSWORD,
    },
  };
}

function loadConfig() {
  // Ruta estable incluso cuando se inicia Node desde otro directorio.
  const result = dotenv.config({
    path: path.resolve(__dirname, '../../.env'),
    quiet: true,
  });

  if (result.error && result.error.code !== 'ENOENT') {
    throw new Error('No se pudo leer backend/.env');
  }

  return readConfig();
}

module.exports = { readConfig, loadConfig };
