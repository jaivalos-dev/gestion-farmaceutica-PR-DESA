const express = require('express');
const controller = require('./disponibilidad.controller');
const authenticate = require('../../middlewares/authenticate');
const authorizeRoles = require('../../middlewares/authorizeRoles');

const router = express.Router();
router.use(authenticate);
router.get('/', authorizeRoles('ENCARGADO', 'DESPACHO', 'ADMINISTRADOR'), controller.consult);

module.exports = router;
