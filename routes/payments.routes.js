const express = require('express');
const router = express.Router();
const { jwtMiddleware } = require('../middleware/auth.middleware');
const paymentService = require('../services/payment.service');
const logger = require('../logger');
const db = require('../db');

function getErrorMessage(err) {
  if (typeof err?.message === 'string' && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Error al procesar el pago';
}

// --- PayPal ---
router.post('/paypal/create', jwtMiddleware, async (req, res) => {
  try {
    const { packageId } = req.body;
    const userId = req.user.sub;
    const order = await paymentService.createPayPalOrder(userId, packageId);
    res.json(order); // { orderId, approvalLink }
  } catch (err) {
    res.status(400).json({ error: getErrorMessage(err) });
  }
});

router.post('/paypal/capture', jwtMiddleware, async (req, res) => {
  try {
    const { orderId } = req.body;
    const result = await paymentService.capturePayPalOrder(orderId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: getErrorMessage(err) });
  }
});

// PayPal return / cancel URLs
router.get('/paypal/success', async (req, res) => {
  const orderId = req.query.token; // PayPal passes the order ID as 'token'
  try {
    if (orderId) {
      await paymentService.capturePayPalOrder(orderId);
      logger.info(`PayPal payment captured via redirect for order: ${orderId}`);
    }
    res.send('<html><head><style>body{background:#1a262f;color:#7fffd4;font-family:sans-serif;text-align:center;padding:50px;}</style></head><body><h2>¡Pago con PayPal completado!</h2><p>Tus monedas han sido agregadas exitosamente. Puedes cerrar esta ventana.</p><script>setTimeout(() => window.close(), 3000);</script></body></html>');
  } catch (err) {
    logger.error('Error capturing PayPal via redirect:', err);
    res.send('<html><head><style>body{background:#1a262f;color:#fca5a5;font-family:sans-serif;text-align:center;padding:50px;}</style></head><body><h2>Error procesando el pago.</h2><p>Por favor contacta a soporte.</p><script>setTimeout(() => window.close(), 3000);</script></body></html>');
  }
});

router.get('/paypal/cancel', (req, res) => {
  res.send('<html><head><style>body{background:#1a262f;color:#fca5a5;font-family:sans-serif;text-align:center;padding:50px;}</style></head><body><h2>Pago cancelado.</h2><p>Puedes cerrar esta ventana.</p><script>window.close();</script></body></html>');
});

// --- PayPhone ---
router.post('/payphone/create', jwtMiddleware, async (req, res) => {
  try {
    const { packageId } = req.body;
    const userId = req.user.sub;
    const result = await paymentService.createPayPhoneTransaction(userId, packageId);
    res.json(result); // { paymentId, payWithCard }
  } catch (err) {
    res.status(400).json({ error: getErrorMessage(err) });
  }
});

// PayPhone success redirect (Return URL)
router.get('/payphone/success', async (req, res) => {
  const tx = req.query.tx; // userId_packageId_timestamp
  try {
    if (!tx) throw new Error('Transaction ID no encontrado');

    const parts = tx.split('_');
    const userIdStr = parts[0];
    const timestamp = parts[parts.length - 1];
    const packageId = parts.slice(1, parts.length - 1).join('_');
    const userId = parseInt(userIdStr, 10);

    const pool = db.getPool();
    const pkg = paymentService.COIN_PACKAGES[packageId];
    if (pkg) {
       await pool.query('UPDATE public.users SET coins = coins + $1 WHERE id = $2', [pkg.coins, userId]);
       logger.info(`PayPhone payment successful for ${userId}, added ${pkg.coins} coins.`);
    }
    res.send('<html><head><style>body{background:#1a262f;color:#7fffd4;font-family:sans-serif;text-align:center;padding:50px;}</style></head><body><h2>¡Pago con PayPhone completado!</h2><p>Tus monedas han sido agregadas exitosamente. Puedes cerrar esta ventana.</p><script>setTimeout(() => window.close(), 3000);</script></body></html>');
  } catch (err) {
    logger.error('Error handling PayPhone success:', err);
    res.status(500).send('<html><head><style>body{background:#1a262f;color:#fca5a5;font-family:sans-serif;text-align:center;padding:50px;}</style></head><body><h2>Error procesando el pago.</h2><p>Por favor contacta a soporte.</p><script>setTimeout(() => window.close(), 3000);</script></body></html>');
  }
});

router.get('/payphone/cancel', (req, res) => {
  res.send('<html><head><style>body{background:#1a262f;color:#fca5a5;font-family:sans-serif;text-align:center;padding:50px;}</style></head><body><h2>Pago cancelado.</h2><p>Puedes cerrar esta ventana.</p><script>window.close();</script></body></html>');
});

module.exports = router;
