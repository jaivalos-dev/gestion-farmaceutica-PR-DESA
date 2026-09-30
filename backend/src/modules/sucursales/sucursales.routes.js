const express = require('express');
const controller = require('./sucursales.controller');
const authenticate = require('../../middlewares/authenticate');
const authorizeRoles = require('../../middlewares/authorizeRoles');

const router = express.Router();
const administrator = authorizeRoles('ADMINISTRADOR');
router.use(authenticate);
router.get('/', controller.list);
router.get('/:id', controller.getById);
router.post('/', administrator, controller.create);
router.put('/:id', administrator, controller.update);
router.patch('/:id/estado', administrator, controller.setState);

module.exports = router;
