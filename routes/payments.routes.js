const express = require('express');
const router = express.Router();
const { jwtMiddleware } = require('../middleware/auth.middleware');
const paymentService = require('../services/payment.service');

function getErrorMessage(err) {
  if (typeof err?.message === 'string' && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Error al procesar el pago';
}

function getFrontendUrl(req) {
  return String(
    req.query.frontendUrl ||
    req.body?.frontendUrl ||
    req.headers['x-frontend-url'] ||
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_APP_URL ||
    'http://localhost:4200'
  ).replace(/\/+$/, '');
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

router.get('/paypal/success', async (req, res) => {
  const orderId = req.query.token;
  const frontendUrl = getFrontendUrl(req);
  try {
    if (!orderId) throw new Error('Order ID no encontrado');
    await paymentService.confirmPayPalOrder(orderId);
    res.redirect(`${frontendUrl}/payment/complete?gateway=paypal&confirmed=1&orderId=${encodeURIComponent(orderId)}`);
  } catch (err) {
    res.redirect(`${frontendUrl}/payment/complete?gateway=paypal&error=${encodeURIComponent(getErrorMessage(err))}`);
  }
});

router.get('/paypal/cancel', (req, res) => {
  const frontendUrl = getFrontendUrl(req);
  res.redirect(`${frontendUrl}/payment/complete?gateway=paypal&canceled=1`);
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

router.get('/payphone/success', async (req, res) => {
  const frontendUrl = getFrontendUrl(req);
  const tx = req.query.tx;
  try {
    if (!tx) throw new Error('Transaction ID no encontrado');
    await paymentService.confirmPayPhoneTransaction(tx);
    res.redirect(`${frontendUrl}/payment/complete?gateway=payphone&confirmed=1&tx=${encodeURIComponent(tx)}`);
  } catch (err) {
    res.redirect(`${frontendUrl}/payment/complete?gateway=payphone&error=${encodeURIComponent(getErrorMessage(err))}`);
  }
});

router.get('/payphone/cancel', (req, res) => {
  const frontendUrl = getFrontendUrl(req);
  res.redirect(`${frontendUrl}/payment/complete?gateway=payphone&canceled=1`);
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

router.post('/paypal/confirm', async (req, res) => {
  try {
    const { orderId } = req.body;
    const result = await paymentService.confirmPayPalOrder(orderId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: getErrorMessage(err) });
  }
});

module.exports = router;
