const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { jwtMiddleware } = require('../middleware/auth.middleware');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/google', authController.google);
router.post('/verify-code', authController.verifyCode);
router.post('/resend-code', authController.resendCode);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// MFA routes (authenticated)
router.get('/mfa/status', jwtMiddleware, authController.mfaStatus);
router.post('/mfa/setup', jwtMiddleware, authController.mfaSetup);
router.post('/mfa/confirm', jwtMiddleware, authController.mfaConfirm);
router.post('/mfa/disable', jwtMiddleware, authController.mfaDisable);

// MFA second-step login (public - no JWT yet)
router.post('/mfa/verify', authController.verifyMfaLogin);
router.post('/refresh', authController.refreshToken);

router.get('/config', (req, res) => {
  res.json({ clientId: process.env.SESSION_CLIENT_ID || '' });
});

module.exports = router;
