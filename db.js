const { Pool } = require('pg');
const logger = require('./logger');

let pool = null;
let connectPromise = null;

async function connect() {
  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    const connectionString =
      process.env.DATABASE_URL ||
      process.env.AZURE_POSTGRES_URL ||
      buildConnectionString();

    const config = {
      connectionString,
      ssl: buildSslConfig(),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };

    try {
      pool = new Pool(config);

      const client = await pool.connect();
      client.release();

      await ensureSchema();

      logger.info('PostgreSQL connected - schema ready');
      return pool;
    } catch (err) {
      logger.error('PostgreSQL connection error:', err.message);
      pool = null;
      connectPromise = null;
      throw err;
    }
  })();

  return connectPromise;
}

function buildConnectionString() {
  const host = process.env.AZURE_DB_HOST || 'postgresql-juanj.postgres.database.azure.com';
  const user = process.env.AZURE_DB_USER || 'postgres';
  const rawPassword = process.env.AZURE_DB_PASSWORD || 'Balatrito123.';
  const database = process.env.AZURE_DB_NAME || 'postgres';
  const password = encodeURIComponent(String(rawPassword).trim());

  return `postgresql://${user}:${password}@${host}:5432/${database}`;
}

function buildSslConfig() {
  const rejectUnauthorized = String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'false').toLowerCase() === 'true';
  return { rejectUnauthorized };
}

async function ensureSchema() {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS public;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) NOT NULL UNIQUE,
      email VARCHAR(255) NOT NULL UNIQUE,
      "passwordHash" VARCHAR(255),
      "oauthProvider" VARCHAR(20) DEFAULT 'local',
      status VARCHAR(20) DEFAULT 'inactive',
      "verificationCode" VARCHAR(10) DEFAULT NULL,
      "verificationExpiresAt" TIMESTAMP DEFAULT NULL,
      "verificationAttempts" INT DEFAULT 0,
      "recoveryToken" VARCHAR(100) DEFAULT NULL,
      "recoveryTokenExpiresAt" TIMESTAMP DEFAULT NULL,
      "mfaEnabled" BOOLEAN DEFAULT FALSE,
      "mfaSecret" VARCHAR(100) DEFAULT NULL,
      "pendingMfaSecret" VARCHAR(100) DEFAULT NULL,
      coins INT DEFAULT 0,
      "equippedCosmeticId" INT DEFAULT NULL,
      "avatarUrl" TEXT DEFAULT NULL,
      "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.cosmetics (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      price INT NOT NULL,
      "imageUrl" VARCHAR(255),
      color VARCHAR(20) DEFAULT '#7fffd4'
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.results (
      id SERIAL PRIMARY KEY,
      "userId" INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      score INT NOT NULL,
      difficulty VARCHAR(20) DEFAULT 'MEDIUM',
      date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.user_cosmetics (
      "userId" INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      "cosmeticId" INT NOT NULL REFERENCES public.cosmetics(id) ON DELETE CASCADE,
      "purchaseDate" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY ("userId", "cosmeticId")
    );
  `);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM public.cosmetics');
  if (rows[0].count === 0) {
    await pool.query(`
      INSERT INTO public.cosmetics (name, description, price, "imageUrl", color) VALUES
        ('Espada de Fuego', 'Una espada llameante que ilumina la oscuridad.', 500, '🔥', '#ff6b35'),
        ('Escudo de Hielo', 'Un escudo impenetrable congelado en el tiempo.', 750, '❄️', '#00d4ff'),
        ('Capa de las Sombras', 'Oculta tu presencia de los enemigos.', 1200, '🌑', '#6c3baa'),
        ('Rayo de Plasma', 'Arma de energía pura.', 2000, '⚡', '#ffe44d'),
        ('Corona Dorada', 'Símbolo de la realeza en el campo de batalla.', 5000, '👑', '#ffd700')
    `);
    logger.info('Seeded default cosmetics');
  }
}

function getPool() {
  if (!pool) throw new Error('Database not initialized. Call connect() first.');
  return pool;
}

module.exports = { connect, getPool };
