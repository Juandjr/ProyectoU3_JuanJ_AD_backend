const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');
const logger = require('../logger');

const crypto = require('crypto');
const emailService = require('./email.service');

const JWT_SECRET = process.env.JWT_SECRET || '0633dffc89472706044d5524f36f70e1ad8d5677a24bc28a9618fba7156bbaa7';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '1h';
const GOOGLE_CLIENT_ID = process.env.SESSION_CLIENT_ID;
const CODE_TTL_MINUTES = parseInt(process.env.CODE_TTL_MINUTES || '10', 10);
const MAX_VERIFICATION_ATTEMPTS = parseInt(process.env.MAX_VERIFICATION_ATTEMPTS || '5', 10);

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function refreshToken(token) {
  if (!token) throw new Error('No token provided');
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
  } catch (err) {
    throw new Error('Invalid token');
  }
  if (!payload || !payload.sub) {
    throw new Error('Invalid token payload');
  }

  const pool = db.getPool();
  const { rows } = await pool.query('SELECT id, username, status FROM users WHERE id = $1 LIMIT 1', [payload.sub]);
  if (rows.length === 0) {
    throw new Error('User not found');
  }
  const user = rows[0];
  if (user.status !== 'active') {
    throw new Error('User not active');
  }

  return signToken({ sub: user.id, username: user.username });
}

function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
}

async function registerLocal({ username, email, password }) {
  const pool = db.getPool();
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const { rows: existing } = await conn.query('SELECT id, username, email, status FROM users WHERE username = $1 OR email = $2 LIMIT 1', [username, email]);
    
    let existingUser = null;
    if (existing.length > 0) {
      existingUser = existing[0];
      if (existingUser.status === 'active') {
        if (existingUser.email === email) throw new Error('Email already exists');
        if (existingUser.username === username) throw new Error('Username already exists');
        throw new Error('Username or email already exists');
      }
    }

    const passwordHash = await hashPassword(password);
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
    
    let userId;
    if (existingUser && existingUser.status === 'inactive') {
      await conn.query(
        'UPDATE users SET username = $1, email = $2, "passwordHash" = $3, "oauthProvider" = $4, "verificationCode" = $5, "verificationExpiresAt" = $6, "verificationAttempts" = 0 WHERE id = $7',
        [username, email, passwordHash, 'local', code, expiresAt, existingUser.id]
      );
      userId = existingUser.id;
    } else {
      const res = await conn.query(
        'INSERT INTO users (username, email, "passwordHash", "oauthProvider", status, "verificationCode", "verificationExpiresAt", "verificationAttempts") VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
        [username, email, passwordHash, 'local', 'inactive', code, expiresAt, 0]
      );
      userId = res.rows[0].id;
    }

    try {
      if (process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD) {
        await emailService.sendVerificationEmail({ name: username, email, code, expirationMinutes: CODE_TTL_MINUTES });
      }
    } catch (mailErr) {
      logger.error('Failed to send verification email during registration', { error: mailErr.message });
    }

    await conn.query('COMMIT');
    const user = { id: userId, username, email, status: 'inactive' };
    logger.info('User registered (inactive)', { username, email });
    return user;
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }
}

async function loginLocal({ username, password }) {
  const pool = db.getPool();
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1 LIMIT 1', [username]);
  if (rows.length === 0) throw new Error('Invalid credentials');
  const user = rows[0];
  if (!user.passwordHash) throw new Error('Local login not configured for this user');
  
  if (user.status !== 'active') {
    throw new Error('Debe verificar su correo para activar la cuenta');
  }

  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) throw new Error('Invalid credentials');

  if (user.mfaEnabled) {
    return { user: { id: user.id, username: user.username, email: user.email }, requiresMfa: true };
  }

  const token = signToken({ sub: user.id, username: user.username });
  return { user, token, requiresMfa: false };
}

async function verifyRegisterCode({ email, code }) {
  const pool = db.getPool();
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
  if (rows.length === 0) throw new Error('No existe una cuenta con ese correo');
  const user = rows[0];

  if (user.status === 'active') {
    const token = signToken({ sub: user.id, username: user.username });
    return { user, token, message: 'La cuenta ya está activa' };
  }

  if (new Date(user.verificationExpiresAt).getTime() < Date.now()) {
    throw new Error('El código ha expirado. Solicite uno nuevo.');
  }

  if (user.verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
    throw new Error('Se alcanzó el número máximo de intentos. Solicite un nuevo código.');
  }

  if (user.verificationCode !== String(code).trim()) {
    const attempts = user.verificationAttempts + 1;
    await pool.query('UPDATE users SET "verificationAttempts" = $1 WHERE id = $2', [attempts, user.id]);
    throw new Error(`Código incorrecto. Intentos restantes: ${MAX_VERIFICATION_ATTEMPTS - attempts}`);
  }

  await pool.query(
    'UPDATE users SET status = \'active\', "verificationCode" = NULL, "verificationExpiresAt" = NULL, "verificationAttempts" = 0 WHERE id = $1',
    [user.id]
  );

  const token = signToken({ sub: user.id, username: user.username });
  logger.info('User account activated', { email });
  return { user, token, message: 'Cuenta activada correctamente' };
}

async function resendRegisterCode({ email }) {
  const pool = db.getPool();
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
  if (rows.length === 0) throw new Error('No existe una cuenta con ese correo');
  const user = rows[0];

  if (user.status === 'active') {
    throw new Error('La cuenta ya está activa');
  }

  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await pool.query(
    'UPDATE users SET "verificationCode" = $1, "verificationExpiresAt" = $2, "verificationAttempts" = 0 WHERE id = $3',
    [code, expiresAt, user.id]
  );

  await emailService.sendVerificationEmail({ name: user.username, email, code, expirationMinutes: CODE_TTL_MINUTES });
  logger.info('Resent verification code', { email });
  return { message: 'Código de verificación enviado' };
}

async function requestPasswordRecovery({ email }) {
  const pool = db.getPool();
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
  
  if (rows.length === 0) {
    return { message: 'Si el correo está registrado, recibirás un enlace de recuperación en breve.' };
  }
  const user = rows[0];

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await pool.query(
    'UPDATE users SET "recoveryToken" = $1, "recoveryTokenExpiresAt" = $2 WHERE id = $3',
    [token, expiresAt, user.id]
  );

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  await emailService.sendPasswordRecoveryEmail({ name: user.username, email, token, baseUrl });
  logger.info('Password recovery requested', { email });

  return { message: 'Si el correo está registrado, recibirás un enlace de recuperación en breve.' };
}

async function resetPassword({ email, token, newPassword }) {
  const pool = db.getPool();
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
  if (rows.length === 0) throw new Error('Token inválido o expirado.');
  const user = rows[0];

  if (!user.recoveryToken || user.recoveryToken !== token) {
    throw new Error('Token inválido o expirado.');
  }

  if (new Date(user.recoveryTokenExpiresAt).getTime() < Date.now()) {
    throw new Error('El enlace de recuperación ha expirado.');
  }

  const cleanPassword = String(newPassword || '').trim();
  if (cleanPassword.length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres.');
  }

  const passwordHash = await hashPassword(cleanPassword);
  await pool.query(
    'UPDATE users SET "passwordHash" = $1, "recoveryToken" = NULL, "recoveryTokenExpiresAt" = NULL WHERE id = $2',
    [passwordHash, user.id]
  );

  logger.info('Password reset completed', { email });
  return { message: 'Contraseña restablecida correctamente.' };
}

async function loginOrRegisterGoogle(idToken) {
  if (!GOOGLE_CLIENT_ID) throw new Error('Google client id not configured');
  const client = new OAuth2Client(GOOGLE_CLIENT_ID);
  const ticket = await client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  const email = payload.email;
  const usernameBase = email ? String(email).split('@')[0].trim() : '';
  const normalizedUsername = usernameBase || email;

  const pool = db.getPool();
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const { rows: userByEmail } = await conn.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
    let user;
    if (userByEmail.length > 0) {
      user = userByEmail[0];
      if (user.status !== 'active') {
        await conn.query('UPDATE users SET status = \'active\', "verificationCode" = NULL, "verificationExpiresAt" = NULL WHERE id = $1', [user.id]);
        user.status = 'active';
      }
    } else {
      const { rows: duplicate } = await conn.query('SELECT username FROM users WHERE username = $1 LIMIT 1', [normalizedUsername]);
      let usernameToSave = normalizedUsername;
      if (duplicate.length > 0) {
        usernameToSave = `${normalizedUsername}_${Date.now()}`;
      }
      const res = await conn.query('INSERT INTO users (username, email, "oauthProvider", status) VALUES ($1, $2, $3, $4) RETURNING id', [usernameToSave, email, 'google', 'active']);
      user = { id: res.rows[0].id, username: usernameToSave, email, status: 'active' };
    }
    await conn.query('COMMIT');
    const token = signToken({ sub: user.id, username: user.username });
    return { user, token };
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }
}

// ─── MFA / TOTP functions ────────────────────────────────────────────────────
const { authenticator } = require('@otplib/preset-default');
const QRCode = require('qrcode');

authenticator.options = {
  step: 30,
  window: parseInt(process.env.MFA_WINDOW || '1', 10),
};

const MFA_ISSUER = process.env.MFA_ISSUER || 'Aplicaciones Distribuidas';

async function startMfaSetup({ userId }) {
  const pool = db.getPool();
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
  if (rows.length === 0) throw new Error('Usuario no encontrado');
  const user = rows[0];

  if (user.mfaEnabled) throw new Error('MFA ya está activado para esta cuenta');

  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(user.email, MFA_ISSUER, secret);
  const qrCode = await QRCode.toDataURL(otpauth);

  await pool.query('UPDATE users SET "pendingMfaSecret" = $1 WHERE id = $2', [secret, userId]);

  return { message: 'Escanea el QR con tu app autenticadora', qrCode, manualKey: secret };
}

async function confirmMfaSetup({ userId, code }) {
  const pool = db.getPool();
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
  if (rows.length === 0) throw new Error('Usuario no encontrado');
  const user = rows[0];

  if (!user.pendingMfaSecret) throw new Error('No hay configuración MFA pendiente');

  const cleanCode = String(code || '').replace(/\s/g, '');
  const isValid = authenticator.check(cleanCode, user.pendingMfaSecret);
  if (!isValid) throw new Error('Código incorrecto. Revisa la hora de tu dispositivo o espera el próximo código.');

  await pool.query(
    'UPDATE users SET "mfaEnabled" = TRUE, "mfaSecret" = $1, "pendingMfaSecret" = NULL WHERE id = $2',
    [user.pendingMfaSecret, userId]
  );

  logger.info('MFA enabled for user', { userId });
  return { message: 'Autenticación de dos factores activada correctamente' };
}

async function disableMfa({ userId }) {
  const pool = db.getPool();
  await pool.query(
    'UPDATE users SET "mfaEnabled" = FALSE, "mfaSecret" = NULL, "pendingMfaSecret" = NULL WHERE id = $1',
    [userId]
  );
  logger.info('MFA disabled for user', { userId });
  return { message: 'Autenticación de dos factores desactivada' };
}

async function verifyMfaLogin({ email, code }) {
  const pool = db.getPool();
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
  if (rows.length === 0) throw new Error('Credenciales inválidas');
  const user = rows[0];

  if (!user.mfaEnabled || !user.mfaSecret) throw new Error('MFA no está activado en esta cuenta');

  const cleanCode = String(code || '').replace(/\s/g, '');
  const isValid = authenticator.check(cleanCode, user.mfaSecret);
  if (!isValid) throw new Error('Código MFA inválido o expirado');

  const token = signToken({ sub: user.id, username: user.username });
  logger.info('MFA login successful', { email });
  return { user: { id: user.id, username: user.username }, token };
}

async function getMfaStatus({ userId }) {
  const pool = db.getPool();
  const { rows } = await pool.query('SELECT "mfaEnabled" FROM users WHERE id = $1 LIMIT 1', [userId]);
  if (rows.length === 0) throw new Error('Usuario no encontrado');
  return { mfaEnabled: !!rows[0].mfaEnabled };
}


module.exports = {
  hashPassword,
  comparePassword,
  signToken,
  verifyToken,
  registerLocal,
  loginLocal,
  loginOrRegisterGoogle,
  verifyRegisterCode,
  resendRegisterCode,
  requestPasswordRecovery,
  resetPassword,
  startMfaSetup,
  confirmMfaSetup,
  disableMfa,
  verifyMfaLogin,
  getMfaStatus,
};
