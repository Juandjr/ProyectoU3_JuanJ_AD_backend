const axios = require('axios');
const db = require('../db');
const logger = require('../logger');

const PAYPHONE_BASE_URL = process.env.PAYPHONE_BASE_URL;
const PAYPHONE_TOKEN = process.env.PAYPHONE_TOKEN;
const PAYPHONE_STORE_ID = process.env.PAYPHONE_STORE_ID;

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_BASE_URL = process.env.PAYPAL_BASE_URL;

const COIN_PACKAGES = {
  package_1: { id: 'package_1', coins: 100, priceCents: 100, priceUsd: 1.00 },
  package_2: { id: 'package_2', coins: 500, priceCents: 400, priceUsd: 4.00 },
  package_3: { id: 'package_3', coins: 1200, priceCents: 900, priceUsd: 9.00 }
};

function extractErrorMessage(err) {
  if (typeof err === 'string') return err;
  if (err instanceof Error && err.message) return err.message;
  if (err?.response?.data) {
    const data = err.response.data;
    if (typeof data === 'string') return data;
    if (typeof data === 'object') {
      if (typeof data.message === 'string') return data.message;
      if (typeof data.error === 'string') return data.error;
      if (typeof data.detail === 'string') return data.detail;
      return JSON.stringify(data);
    }
  }
  if (err?.message) return err.message;
  return 'No se pudo completar la solicitud';
}

// Paypal access token helper
async function getPayPalAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  try {
    const response = await axios.post(`${PAYPAL_BASE_URL}/v1/oauth2/token`, 'grant_type=client_credentials', {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    return response.data.access_token;
  } catch (err) {
    logger.error('Error fetching PayPal token:', err?.response?.data || err.message);
    throw new Error('Failed to authenticate with PayPal');
  }
}

// PayPal create order
async function createPayPalOrder(userId, packageId) {
  const pkg = COIN_PACKAGES[packageId];
  if (!pkg) throw new Error('Paquete inválido');

  const accessToken = await getPayPalAccessToken();
  try {
    const order = {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: `${userId}_${packageId}`,
        amount: {
          currency_code: 'USD',
          value: pkg.priceUsd.toFixed(2)
        },
        description: `${pkg.coins} Monedas del Juego`
      }],
      application_context: {
        return_url: `${process.env.BASE_URL}/api/payments/paypal/success`,
        cancel_url: `${process.env.BASE_URL}/api/payments/paypal/cancel`
      }
    };

    const response = await axios.post(`${PAYPAL_BASE_URL}/v2/checkout/orders`, order, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const approvalLink = response.data.links.find(link => link.rel === 'approve').href;
    return { orderId: response.data.id, approvalLink };
  } catch (err) {
    logger.error('Error creating PayPal order:', err?.response?.data || err.message);
    throw new Error('No se pudo crear la orden de PayPal');
  }
}

// PayPal capture order
async function capturePayPalOrder(orderId) {
  const accessToken = await getPayPalAccessToken();
  try {
    // First fetch the order to reliably get the reference_id
    const getResponse = await axios.get(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const referenceId = getResponse.data.purchase_units[0].reference_id; // userId_packageId
    const firstUnderscore = referenceId.indexOf('_');
    const userIdStr = referenceId.substring(0, firstUnderscore);
    const packageId = referenceId.substring(firstUnderscore + 1);
    const userId = parseInt(userIdStr, 10);

    // Now capture it
    const response = await axios.post(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`, {}, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data.status === 'COMPLETED') {
      await addCoinsToUser(userId, packageId);
      return { success: true, coinsAdded: COIN_PACKAGES[packageId].coins };
    }
    throw new Error(`Pago no completado. Estado: ${response.data.status}`);
  } catch (err) {
    logger.error('Error capturing PayPal order:', err?.response?.data || err);
    throw new Error('No se pudo confirmar el pago de PayPal');
  }
}

// PayPhone create transaction
async function createPayPhoneTransaction(userId, packageId) {
  const pkg = COIN_PACKAGES[packageId];
  if (!pkg) throw new Error('Paquete inválido');

  const clientTxId = `TX_${Date.now()}_${userId}_${packageId}`;
  const payload = {
    amount: pkg.priceCents,
    amountWithoutTax: pkg.priceCents,
    amountWithTax: 0,
    tax: 0,
    clientTransactionId: clientTxId,
    currency: 'USD',
    reference: `${pkg.coins} Monedas del Juego`,
    responseUrl: `${process.env.BASE_URL}/api/payments/payphone/success?tx=${clientTxId}`,
    cancellationUrl: `${process.env.BASE_URL}/api/payments/payphone/cancel`,
    storeId: PAYPHONE_STORE_ID
  };

  const endpointCandidates = [
    '/api/button/Prepare',
    '/api/button/prepare',
    '/api/button/Prepare/',
    '/api/button/prepare/'
  ];

  let lastError = null;
  for (const endpointPath of endpointCandidates) {
    try {
      const baseUrl = (PAYPHONE_BASE_URL || '').replace(/\/+$/, '');
      const url = `${baseUrl}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${PAYPHONE_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        paymentId: response.data.paymentId,
        payWithCard: response.data.payWithCard || response.data.paymentUrl || response.data.url || ''
      };
    } catch (err) {
      lastError = err;
      logger.warn('PayPhone endpoint failed', {
        endpoint: endpointPath,
        status: err?.response?.status,
        detail: extractErrorMessage(err)
      });
    }
  }

  const detail = extractErrorMessage(lastError) || 'No se pudo iniciar el pago con PayPhone';
  logger.error('Error creating PayPhone transaction:', detail);
  throw new Error(detail);
}

// Add coins to user
async function addCoinsToUser(userId, packageId) {
  const pkg = COIN_PACKAGES[packageId];
  if (!pkg) throw new Error('Paquete inválido');

  const pool = db.getPool();
  await pool.query('UPDATE users SET coins = coins + ? WHERE id = ?', [pkg.coins, userId]);
  logger.info(`Added ${pkg.coins} coins to user ${userId}`);
}

module.exports = {
  createPayPalOrder,
  capturePayPalOrder,
  createPayPhoneTransaction,
  COIN_PACKAGES
};
