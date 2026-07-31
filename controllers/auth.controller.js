const authService = require('../services/auth.service');
const logger = require('../logger');

async function register(req, res) {
  const { username, email, password, passwordConfirm } = req.body;
  if (!username || !email || !password || !passwordConfirm) return res.status(400).json({ error: 'Faltan campos obligatorios' });
  if (password !== passwordConfirm) return res.status(400).json({ error: 'Las contraseñas no coinciden' });
  try {
    const user = await authService.registerLocal({ username, email, password });
    res.json({ id: user.id, username: user.username, email: user.email });
  } catch (err) {
    logger.error('Register failed:', { error: err.message, stack: err.stack });
    const isDuplicate = err.message && (err.message.includes('exists') || err.message.includes('duplicate') || err.message.includes('unique'));
    const status = isDuplicate ? 409 : 500;
    res.status(status).json({ error: err.message || 'Error en el servidor al registrar usuario' });
  }
}

async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const result = await authService.loginLocal({ username, password });
    if (result.requiresMfa) {
      return res.json({ requiresMfa: true, email: result.user.email });
    }
    res.json({ token: result.token, user: { id: result.user.id, username: result.user.username }, requiresMfa: false });
  } catch (err) {
    logger.warn('Login failed', { err: err.message });
    res.status(401).json({ error: err.message });
  }
}

async function google(req, res) {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'Missing idToken' });
  try {
    const { user, token } = await authService.loginOrRegisterGoogle(idToken);
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    logger.error('Google auth failed', { err: err.message });
    res.status(400).json({ error: err.message });
  }
}

async function verifyCode(req, res) {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Missing fields' });
  try {
    const result = await authService.verifyRegisterCode({ email, code });
    res.json(result);
  } catch (err) {
    logger.warn('Verification failed', { err: err.message });
    res.status(400).json({ error: err.message });
  }
}

async function resendCode(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  try {
    const result = await authService.resendRegisterCode({ email });
    res.json(result);
  } catch (err) {
    logger.warn('Resending code failed', { err: err.message });
    res.status(400).json({ error: err.message });
  }
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  try {
    const result = await authService.requestPasswordRecovery({ email });
    res.json(result);
  } catch (err) {
    logger.warn('Forgot password failed', { err: err.message });
    res.status(400).json({ error: err.message });
  }
}

async function resetPassword(req, res) {
  const { email, token, newPassword } = req.body;
  if (!email || !token || !newPassword) return res.status(400).json({ error: 'Missing fields' });
  try {
    const result = await authService.resetPassword({ email, token, newPassword });
    res.json(result);
  } catch (err) {
    logger.warn('Reset password failed', { err: err.message });
    res.status(400).json({ error: err.message });
  }
}

async function mfaSetup(req, res) {
  const userId = req.user && req.user.sub;
  if (!userId) return res.status(401).json({ error: 'No autorizado' });
  try {
    const result = await authService.startMfaSetup({ userId });
    res.json(result);
  } catch (err) {
    logger.warn('MFA setup failed', { err: err.message });
    res.status(400).json({ error: err.message });
  }
}

async function mfaConfirm(req, res) {
  const userId = req.user && req.user.sub;
  const { code } = req.body;
  if (!userId) return res.status(401).json({ error: 'No autorizado' });
  if (!code) return res.status(400).json({ error: 'Missing code' });
  try {
    const result = await authService.confirmMfaSetup({ userId, code });
    res.json(result);
  } catch (err) {
    logger.warn('MFA confirm failed', { err: err.message });
    res.status(400).json({ error: err.message });
  }
}

async function mfaDisable(req, res) {
  const userId = req.user && req.user.sub;
  if (!userId) return res.status(401).json({ error: 'No autorizado' });
  try {
    const result = await authService.disableMfa({ userId });
    res.json(result);
  } catch (err) {
    logger.warn('MFA disable failed', { err: err.message });
    res.status(400).json({ error: err.message });
  }
}

async function mfaStatus(req, res) {
  const userId = req.user && req.user.sub;
  if (!userId) return res.status(401).json({ error: 'No autorizado' });
  try {
    const result = await authService.getMfaStatus({ userId });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function verifyMfaLogin(req, res) {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Missing fields' });
  try {
    const result = await authService.verifyMfaLogin({ email, code });
    res.json(result);
  } catch (err) {
    logger.warn('MFA login verify failed', { err: err.message });
    res.status(400).json({ error: err.message });
  }
}

async function refreshToken(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const newToken = await authService.refreshToken(token);
    res.json({ token: newToken });
  } catch (err) {
    logger.warn('Token refresh failed', { err: err.message });
    res.status(401).json({ error: err.message || 'Invalid token' });
  }
}

module.exports = { register, login, google, verifyCode, resendCode, forgotPassword, resetPassword, mfaSetup, mfaConfirm, mfaDisable, mfaStatus, verifyMfaLogin, refreshToken };
