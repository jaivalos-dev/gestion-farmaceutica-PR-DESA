const express = require('express');
const controller = require('./planilla.controller');
const authenticate = require('../../middlewares/authenticate');
const authorizeRoles = require('../../middlewares/authorizeRoles');

const router = express.Router();
router.use(authenticate);
const reader = authorizeRoles('ADMINISTRADOR', 'AUDITOR');
router.get('/gastos', reader, controller.list);
router.get('/gastos/:id', reader, controller.getById);
router.get('/resumen', reader, controller.summary);
router.post('/gastos', authorizeRoles('ADMINISTRADOR'), controller.create);

module.exports = router;
