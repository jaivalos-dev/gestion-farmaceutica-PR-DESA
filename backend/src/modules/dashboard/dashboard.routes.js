const express = require('express');
const controller = require('./dashboard.controller');
const authenticate = require('../../middlewares/authenticate');
const authorizeRoles = require('../../middlewares/authorizeRoles');

const router = express.Router();
router.use(authenticate);
router.get('/resumen', authorizeRoles('ADMINISTRADOR', 'AUDITOR'), controller.summary);

module.exports = router;
