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
  const [rows] = await pool.query('SELECT id, username, status FROM users WHERE id = ? LIMIT 1', [payload.sub]);
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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query('SELECT id, username, email, status FROM users WHERE username = ? OR email = ? LIMIT 1', [username, email]);
    
    let existingUser = null;
    if (existing.length > 0) {
      existingUser = existing[0];
      if (existingUser.status === 'active') {
        if (existingUser.email === email) throw new Error('Email already exists');
        if (existingUser.username === username) throw new Error('Username already exists');
        throw new Error('Username or email already exists');
      }
      // If inactive, we overwrite the inactive user
    }

    const passwordHash = await hashPassword(password);
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
    
    let userId;
    if (existingUser && existingUser.status === 'inactive') {
      await conn.query(
        'UPDATE users SET username = ?, passwordHash = ?, verificationCode = ?, verificationExpiresAt = ?, verificationAttempts = 0 WHERE id = ?',
        [username, passwordHash, code, expiresAt, existingUser.id]
      );
      userId = existingUser.id;
    } else {
      const [res] = await conn.query(
        'INSERT INTO users (username, email, passwordHash, oauthProvider, status, verificationCode, verificationExpiresAt, verificationAttempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [username, email, passwordHash, 'local', 'inactive', code, expiresAt, 0]
      );
      userId = res.insertId;
    }

    // Try sending mail, log error if fails but transaction commits so code is in DB
    try {
      await emailService.sendVerificationEmail({ name: username, email, code, expirationMinutes: CODE_TTL_MINUTES });
    } catch (mailErr) {
      logger.error('Failed to send verification email during registration', { error: mailErr.message });
    }

    await conn.commit();
    const user = { id: userId, username, email, status: 'inactive' };
    logger.info('User registered (inactive)', { username, email });
    return user;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function loginLocal({ username, password }) {
  const pool = db.getPool();
  const [rows] = await pool.query('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
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
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
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
    await pool.query('UPDATE users SET verificationAttempts = ? WHERE id = ?', [attempts, user.id]);
    throw new Error(`Código incorrecto. Intentos restantes: ${MAX_VERIFICATION_ATTEMPTS - attempts}`);
  }

  await pool.query(
    'UPDATE users SET status = "active", verificationCode = NULL, verificationExpiresAt = NULL, verificationAttempts = 0 WHERE id = ?',
    [user.id]
  );

  const token = signToken({ sub: user.id, username: user.username });
  logger.info('User account activated', { email });
  return { user, token, message: 'Cuenta activada correctamente' };
}

async function resendRegisterCode({ email }) {
  const pool = db.getPool();
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  if (rows.length === 0) throw new Error('No existe una cuenta con ese correo');
  const user = rows[0];

  if (user.status === 'active') {
    throw new Error('La cuenta ya está activa');
  }

  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await pool.query(
    'UPDATE users SET verificationCode = ?, verificationExpiresAt = ?, verificationAttempts = 0 WHERE id = ?',
    [code, expiresAt, user.id]
  );

  await emailService.sendVerificationEmail({ name: user.username, email, code, expirationMinutes: CODE_TTL_MINUTES });
  logger.info('Resent verification code', { email });
  return { message: 'Código de verificación enviado' };
}

async function requestPasswordRecovery({ email }) {
  const pool = db.getPool();
  // We can look up by email
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  
  // Security best practice: don't reveal if user does not exist
  if (rows.length === 0) {
    return { message: 'Si el correo está registrado, recibirás un enlace de recuperación en breve.' };
  }
  const user = rows[0];

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  await pool.query(
    'UPDATE users SET recoveryToken = ?, recoveryTokenExpiresAt = ? WHERE id = ?',
    [token, expiresAt, user.id]
  );

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  await emailService.sendPasswordRecoveryEmail({ name: user.username, email, token, baseUrl });
  logger.info('Password recovery requested', { email });

  return { message: 'Si el correo está registrado, recibirás un enlace de recuperación en breve.' };
}

async function resetPassword({ email, token, newPassword }) {
  const pool = db.getPool();
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
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
    'UPDATE users SET passwordHash = ?, recoveryToken = NULL, recoveryTokenExpiresAt = NULL WHERE id = ?',
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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [userByEmail] = await conn.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    let user;
    if (userByEmail.length > 0) {
      user = userByEmail[0];
      // Google users are automatically activated if they were inactive
      if (user.status !== 'active') {
        await conn.query('UPDATE users SET status = "active", verificationCode = NULL, verificationExpiresAt = NULL WHERE id = ?', [user.id]);
        user.status = 'active';
      }
    } else {
      const [duplicate] = await conn.query('SELECT username FROM users WHERE username = ? LIMIT 1', [normalizedUsername]);
      let usernameToSave = normalizedUsername;
      if (duplicate.length > 0) {
        usernameToSave = `${normalizedUsername}_${Date.now()}`;
      }
      const [res] = await conn.query('INSERT INTO users (username, email, oauthProvider, status) VALUES (?, ?, ?, ?)', [usernameToSave, email, 'google', 'active']);
      user = { id: res.insertId, username: usernameToSave, email, status: 'active' };
    }
    await conn.commit();
    const token = signToken({ sub: user.id, username: user.username });
    return { user, token };
  } catch (err) {
    await conn.rollback();
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
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
  if (rows.length === 0) throw new Error('Usuario no encontrado');
  const user = rows[0];

  if (user.mfaEnabled) throw new Error('MFA ya está activado para esta cuenta');

  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(user.email, MFA_ISSUER, secret);
  const qrCode = await QRCode.toDataURL(otpauth);

  await pool.query('UPDATE users SET pendingMfaSecret = ? WHERE id = ?', [secret, userId]);

  return { message: 'Escanea el QR con tu app autenticadora', qrCode, manualKey: secret };
}

async function confirmMfaSetup({ userId, code }) {
  const pool = db.getPool();
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
  if (rows.length === 0) throw new Error('Usuario no encontrado');
  const user = rows[0];

  if (!user.pendingMfaSecret) throw new Error('No hay configuración MFA pendiente');

  const cleanCode = String(code || '').replace(/\s/g, '');
  const isValid = authenticator.check(cleanCode, user.pendingMfaSecret);
  if (!isValid) throw new Error('Código incorrecto. Revisa la hora de tu dispositivo o espera el próximo código.');

  await pool.query(
    'UPDATE users SET mfaEnabled = 1, mfaSecret = ?, pendingMfaSecret = NULL WHERE id = ?',
    [user.pendingMfaSecret, userId]
  );

  logger.info('MFA enabled for user', { userId });
  return { message: 'Autenticación de dos factores activada correctamente' };
}

async function disableMfa({ userId }) {
  const pool = db.getPool();
  await pool.query(
    'UPDATE users SET mfaEnabled = 0, mfaSecret = NULL, pendingMfaSecret = NULL WHERE id = ?',
    [userId]
  );
  logger.info('MFA disabled for user', { userId });
  return { message: 'Autenticación de dos factores desactivada' };
}

async function verifyMfaLogin({ email, code }) {
  const pool = db.getPool();
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
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
  const [rows] = await pool.query('SELECT mfaEnabled FROM users WHERE id = ? LIMIT 1', [userId]);
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
