const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profile.controller');
const { jwtMiddleware } = require('../middleware/auth.middleware');
const profileAvatarRoutes = require('./profile-avatar.routes');

router.get('/profile', jwtMiddleware, profileController.getProfile);
router.use(profileAvatarRoutes);

module.exports = router;
