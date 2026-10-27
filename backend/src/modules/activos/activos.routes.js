const express = require('express');
const controller = require('./activos.controller');
const authenticate = require('../../middlewares/authenticate');
const authorizeRoles = require('../../middlewares/authorizeRoles');

const router = express.Router();
router.use(authenticate);
const reader = authorizeRoles('ADMINISTRADOR', 'AUDITOR');
const writer = authorizeRoles('ADMINISTRADOR');
router.get('/', reader, controller.list);
router.get('/:id', reader, controller.getById);
router.post('/', writer, controller.create);
router.put('/:id', writer, controller.update);

module.exports = router;
