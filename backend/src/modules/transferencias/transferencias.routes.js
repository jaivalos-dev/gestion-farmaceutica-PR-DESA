const express = require('express');
const controller = require('./transferencias.controller');
const authenticate = require('../../middlewares/authenticate');
const authorizeRoles = require('../../middlewares/authorizeRoles');

const router = express.Router();
router.use(authenticate, authorizeRoles('ENCARGADO'));
router.get('/', controller.list);
router.get('/:id', controller.getById);
router.post('/', controller.create);
router.post('/:id/preparar', controller.preparar);
router.post('/:id/despachar', controller.despachar);
router.post('/:id/recibir', controller.recibir);
router.post('/:id/cancelar', controller.cancelar);

module.exports = router;
