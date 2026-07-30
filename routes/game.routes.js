const express = require('express');
const router = express.Router();
const { jwtMiddleware } = require('../middleware/auth.middleware');
const scoreboard = require('../controllers/scoreboard.controller');

router.get('/scoreboard', jwtMiddleware, scoreboard.getScoreboard);
router.post('/scoreboard', jwtMiddleware, scoreboard.submitResult);

module.exports = router;
