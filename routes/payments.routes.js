const express = require('express');
const router = express.Router();
const { jwtMiddleware } = require('../middleware/auth.middleware');
const paymentService = require('../services/payment.service');

function getErrorMessage(err) {
  if (typeof err?.message === 'string' && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Error al procesar el pago';
}

router.post('/paypal/create', jwtMiddleware, async (req, res) => {
  try {
    const { packageId, frontendUrl } = req.body;
    const userId = req.user.sub;
    const order = await paymentService.createPayPalOrder(userId, packageId, frontendUrl);
    res.json(order);
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

router.post('/paypal/confirm', async (req, res) => {
  try {
    const { orderId } = req.body;
    const result = await paymentService.confirmPayPalOrder(orderId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: getErrorMessage(err) });
  }
});

router.post('/payphone/create', jwtMiddleware, async (req, res) => {
  try {
    const { packageId, frontendUrl } = req.body;
    const userId = req.user.sub;
    const result = await paymentService.createPayPhoneTransaction(userId, packageId, frontendUrl);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: getErrorMessage(err) });
  }
});

router.post('/payphone/confirm', async (req, res) => {
  try {
    const { tx } = req.body;
    const result = await paymentService.confirmPayPhoneTransaction(tx);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: getErrorMessage(err) });
  }
});

module.exports = router;
