const express = require('express');
const controller = require('./auditoria.controller');
const authenticate = require('../../middlewares/authenticate');
const authorizeRoles = require('../../middlewares/authorizeRoles');

const router = express.Router();
router.use(authenticate);
router.get('/', authorizeRoles('ADMINISTRADOR', 'AUDITOR'), controller.list);

module.exports = router;
