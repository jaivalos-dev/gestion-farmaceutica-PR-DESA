const express = require('express');
const controller = require('./entregas.controller');
const authenticate = require('../../middlewares/authenticate');
const authorizeRoles = require('../../middlewares/authorizeRoles');

const router = express.Router();
router.use(authenticate);
const reader = authorizeRoles('ENCARGADO', 'DESPACHO', 'ADMINISTRADOR');
router.get('/', reader, controller.list);
router.get('/:id', reader, controller.getById);
router.post('/', authorizeRoles('ENCARGADO'), controller.create);
router.put('/:id/estado', authorizeRoles('ENCARGADO', 'DESPACHO'), controller.transition);

module.exports = router;
