const { loadConfig } = require('./config/env');
const database = require('./database/pool');
const { createApp } = require('./app');

async function start() {
  // Un error de configuración impide iniciar; no expone valores sensibles.
  const config = loadConfig();
  await database.initializePool(config.oracle);
  let server;
  try {
    server = createApp().listen(config.port);
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  } catch {
    await database.closePool();
    throw new Error('No se pudo iniciar el servidor HTTP');
  }
  console.info(`API escuchando en puerto ${config.port}`);

  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    console.info('Cerrando servidor HTTP y pool Oracle');
    // Acotar peticiones pendientes antes de drenar el pool.
    const deadline = setTimeout(() => server.closeAllConnections(), 10000);
    try {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    } finally {
      clearTimeout(deadline);
      await database.closePool();
    }
  }
  const onSignal = () => {
    shutdown().catch(() => {
      console.error('No se pudo completar el cierre ordenado');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}

if (require.main === module) {
  start().catch((error) => {
    // Solo los errores de configuración contienen mensajes propios y seguros.
    const configError = /^(Faltan variables de entorno:|PORT debe ser|No se pudo leer backend\/\.env)/.test(error.message);
    console.error(configError ? error.message : 'No se pudo iniciar el backend; revise configuración, puerto y pool Oracle');
    process.exitCode = 1;
  });
}

module.exports = { start };
