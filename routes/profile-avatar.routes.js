const express = require('express');
const { put } = require('@vercel/blob');
const db = require('../db');
const { jwtMiddleware } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/profile/avatar', jwtMiddleware, express.raw({ type: '*/*', limit: '5mb' }), async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
    if (!allowedTypes.includes(contentType)) {
      return res.status(400).json({ error: 'Solo se permiten imágenes JPEG, PNG, WEBP, GIF o AVIF' });
    }

    const body = req.body;
    if (!body || !Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: 'Archivo vacío o inválido' });
    }
    if (body.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'La imagen no puede superar 5 MB' });
    }

    const extByType = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/avif': 'avif',
    };

    const ext = extByType[contentType] || 'bin';
    const filename = `avatars/user-${userId}-${Date.now()}.${ext}`;
    const blob = await put(filename, body, { access: 'public', contentType });

    const pool = db.getPool();
    await pool.query('UPDATE public.users SET "avatarUrl" = $1 WHERE id = $2', [blob.url, userId]);

    res.json({ url: blob.url });
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo subir la imagen' });
  }
});

module.exports = router;
