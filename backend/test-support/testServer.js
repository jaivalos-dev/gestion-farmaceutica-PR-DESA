const { once } = require('node:events');

// https://fetch.spec.whatwg.org/#port-blocking
const blockedPorts = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53,
  69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117,
  119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514,
  515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989,
  990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061,
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);
const maxAttempts = 20;

async function startTestServer(app = require('../src/app').createApp()) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const server = app.listen(0, '127.0.0.1');
    // once rechaza si el servidor emite error mientras espera listening.
    await once(server, 'listening');
    if (!blockedPorts.has(server.address().port)) return server;

    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }

  throw new Error(`No se obtuvo un puerto permitido por Fetch tras ${maxAttempts} intentos`);
}

module.exports = { startTestServer };
