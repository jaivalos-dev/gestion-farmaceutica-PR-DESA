const service = require('./health.service');

async function getHealth(req, res) {
  const data = await service.getHealth();
  res.status(200).json({ ok: true, data, message: 'API y Oracle disponibles' });
}

module.exports = { getHealth };
