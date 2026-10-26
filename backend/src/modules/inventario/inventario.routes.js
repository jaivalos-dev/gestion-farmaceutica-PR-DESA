const express = require('express');
const controller = require('./inventario.controller');
const authenticate = require('../../middlewares/authenticate');
const authorizeRoles = require('../../middlewares/authorizeRoles');

const router = express.Router();
router.use(authenticate);
const reader = authorizeRoles('ADMINISTRADOR', 'ENCARGADO', 'AUDITOR');
router.get('/', reader, controller.list);
router.get('/:id', reader, controller.getById);
router.get('/:id/movimientos', reader, controller.movements);
router.post('/ajustes', authorizeRoles('ADMINISTRADOR', 'ENCARGADO'), controller.adjust);

module.exports = router;
