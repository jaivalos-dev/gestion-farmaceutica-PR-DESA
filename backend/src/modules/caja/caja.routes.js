const express = require('express');
const controller = require('./caja.controller');
const authenticate = require('../../middlewares/authenticate');
const authorizeRoles = require('../../middlewares/authorizeRoles');

const router = express.Router();
router.use(authenticate);
const reader = authorizeRoles('ENCARGADO', 'AUDITOR');
router.get('/movimientos', reader, controller.list);
router.get('/movimientos/:id', reader, controller.getById);
router.post('/movimientos', authorizeRoles('ENCARGADO'), controller.create);

module.exports = router;
