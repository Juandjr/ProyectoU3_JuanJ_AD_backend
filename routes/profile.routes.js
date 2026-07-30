const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profile.controller');
const { jwtMiddleware } = require('../middleware/auth.middleware');

router.get('/profile', jwtMiddleware, profileController.getProfile);

module.exports = router;
