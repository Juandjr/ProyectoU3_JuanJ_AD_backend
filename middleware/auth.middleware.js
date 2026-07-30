const authService = require('../services/auth.service');
const logger = require('../logger');

function jwtMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const payload = authService.verifyToken(token);
    req.user = { sub: payload.sub, id: payload.sub, username: payload.username };
    next();
  } catch (err) {
    logger.warn('JWT verification failed', { err: err.message });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { jwtMiddleware };
