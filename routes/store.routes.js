const express = require('express');
const router = express.Router();
const { jwtMiddleware } = require('../middleware/auth.middleware');
const db = require('../db');
const logger = require('../logger');

// Get all cosmetics and user's owned cosmetics
router.get('/items', jwtMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const pool = db.getPool();

    const { rows: items } = await pool.query('SELECT * FROM public.cosmetics');
    const { rows: ownedRows } = await pool.query('SELECT "cosmeticId" FROM public.user_cosmetics WHERE "userId" = $1', [userId]);
    const { rows: userRows } = await pool.query('SELECT coins, "equippedCosmeticId" FROM public.users WHERE id = $1', [userId]);

    const ownedIds = ownedRows.map(r => r.cosmeticId);
    const coins = userRows[0]?.coins || 0;
    const equippedCosmeticId = userRows[0]?.equippedCosmeticId || null;

    const genericDescription = 'Aspecto visual para personalizar tu personaje.';

    res.json({
      items: items.map(item => ({
        ...item,
        description: genericDescription,
        owned: ownedIds.includes(item.id),
        equipped: item.id === equippedCosmeticId
      })),
      coins,
      equippedCosmeticId
    });
  } catch (err) {
    logger.error('Error fetching store items:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Buy a cosmetic
router.post('/buy', jwtMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ error: 'itemId es requerido' });

    const pool = db.getPool();
    
    // Check if already owned
    const { rows: ownedRows } = await pool.query('SELECT * FROM public.user_cosmetics WHERE "userId" = $1 AND "cosmeticId" = $2', [userId, itemId]);
    if (ownedRows.length > 0) return res.status(400).json({ error: 'Ya posees este aspecto' });

    // Get item and user coins
    const { rows: itemRows } = await pool.query('SELECT price FROM public.cosmetics WHERE id = $1', [itemId]);
    if (itemRows.length === 0) return res.status(404).json({ error: 'Aspecto no encontrado' });
    const price = itemRows[0].price;

    const { rows: userRows } = await pool.query('SELECT coins FROM public.users WHERE id = $1', [userId]);
    const coins = userRows[0]?.coins || 0;

    if (coins < price) {
      return res.status(400).json({ error: 'Monedas insuficientes' });
    }

    // Process purchase
    await pool.query('UPDATE public.users SET coins = coins - $1 WHERE id = $2', [price, userId]);
    await pool.query('INSERT INTO public.user_cosmetics ("userId", "cosmeticId") VALUES ($1, $2)', [userId, itemId]);

    logger.info(`User ${userId} bought cosmetic ${itemId} for ${price} coins`);

    res.json({ success: true, newCoinBalance: coins - price });
  } catch (err) {
    logger.error('Error buying cosmetic:', err);
    res.status(500).json({ error: 'Error procesando la compra' });
  }
});

// Equip a cosmetic
router.post('/equip', jwtMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { itemId } = req.body;
    const pool = db.getPool();

    if (!itemId) {
      // Unequip (set to null)
      await pool.query('UPDATE public.users SET "equippedCosmeticId" = NULL WHERE id = $1', [userId]);
      return res.json({ success: true, equippedCosmeticId: null, equippedColor: null });
    }

    // Verify user owns the cosmetic
    const { rows: ownedRows } = await pool.query('SELECT * FROM public.user_cosmetics WHERE "userId" = $1 AND "cosmeticId" = $2', [userId, itemId]);
    if (ownedRows.length === 0) {
      return res.status(400).json({ error: 'No posees este aspecto' });
    }

    // Get the cosmetic color
    const { rows: cosmeticRows } = await pool.query('SELECT color FROM public.cosmetics WHERE id = $1', [itemId]);
    const color = cosmeticRows[0]?.color || '#7fffd4';

    // Update equipped cosmetic
    await pool.query('UPDATE public.users SET "equippedCosmeticId" = $1 WHERE id = $2', [itemId, userId]);

    logger.info(`User ${userId} equipped cosmetic ${itemId}`);

    res.json({ success: true, equippedCosmeticId: itemId, equippedColor: color });
  } catch (err) {
    logger.error('Error equipping cosmetic:', err);
    res.status(500).json({ error: 'Error equipando el aspecto' });
  }
});

// Get equipped cosmetic color for current user (used by game canvas)
router.get('/equipped', jwtMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const pool = db.getPool();

    const { rows: userRows } = await pool.query('SELECT "equippedCosmeticId" FROM public.users WHERE id = $1', [userId]);
    const equippedId = userRows[0]?.equippedCosmeticId || null;

    if (!equippedId) {
      return res.json({ equippedCosmeticId: null, color: null, name: null });
    }

    const { rows: cosmeticRows } = await pool.query('SELECT name, color, "imageUrl" FROM public.cosmetics WHERE id = $1', [equippedId]);
    const cosmetic = cosmeticRows[0];

    res.json({
      equippedCosmeticId: equippedId,
      color: cosmetic?.color || '#7fffd4',
      name: cosmetic?.name || null,
      imageUrl: cosmetic?.imageUrl || null
    });
  } catch (err) {
    logger.error('Error fetching equipped cosmetic:', err);
    res.status(500).json({ error: 'Error obteniendo cosmético equipado' });
  }
});

module.exports = router;
