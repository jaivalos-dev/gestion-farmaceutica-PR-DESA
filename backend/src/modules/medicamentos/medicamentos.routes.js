const express = require('express');
const controller = require('./medicamentos.controller');
const authenticate = require('../../middlewares/authenticate');
const authorizeRoles = require('../../middlewares/authorizeRoles');

const router = express.Router();
const catalogWriter = authorizeRoles('ADMINISTRADOR', 'ENCARGADO');
router.use(authenticate);
router.get('/', controller.list);
router.get('/:id', controller.getById);
router.post('/', catalogWriter, controller.create);
router.put('/:id', catalogWriter, controller.update);
router.patch('/:id/estado', catalogWriter, controller.setState);

module.exports = router;
