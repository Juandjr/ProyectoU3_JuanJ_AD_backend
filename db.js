const { Pool } = require('pg');
const logger = require('./logger');

let pool = null;

async function connect() {
  // Priority: DATABASE_URL > SUPABASE_DB_URL > build from components
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    buildConnectionString();

  const config = {
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };

  try {
    pool = new Pool(config);

    // Test connection
    const client = await pool.connect();
    client.release();

    // Create schema and seed data
    await ensureSchema();

    logger.info('PostgreSQL (Supabase) connected — schema ready');
  } catch (err) {
    logger.error('PostgreSQL connection error:', err.message);
    throw err;
  }
}

function buildConnectionString() {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const projectRef = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');
  const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD || '');
  return `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres`;
}

async function ensureSchema() {
  // Users table
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
      "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Cosmetics table
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

  // Results table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.results (
      id SERIAL PRIMARY KEY,
      "userId" INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      score INT NOT NULL,
      difficulty VARCHAR(20) DEFAULT 'MEDIUM',
      date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // User cosmetics join table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.user_cosmetics (
      "userId" INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      "cosmeticId" INT NOT NULL REFERENCES public.cosmetics(id) ON DELETE CASCADE,
      "purchaseDate" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY ("userId", "cosmeticId")
    );
  `);

  // Seed cosmetics if empty
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM cosmetics');
  if (rows[0].count === 0) {
    await pool.query(`
      INSERT INTO cosmetics (name, description, price, "imageUrl", color) VALUES
        ('Espada de Fuego',    'Una espada llameante que ilumina la oscuridad.',  500,  '🔥', '#ff6b35'),
        ('Escudo de Hielo',   'Un escudo impenetrable congelado en el tiempo.',   750,  '❄️', '#00d4ff'),
        ('Capa de las Sombras','Oculta tu presencia de los enemigos.',            1200, '🌑', '#6c3baa'),
        ('Rayo de Plasma',    'Arma de energía pura.',                           2000, '⚡', '#ffe44d'),
        ('Corona Dorada',     'Símbolo de la realeza en el campo de batalla.',   5000, '👑', '#ffd700')
    `);
    logger.info('Seeded default cosmetics');
  }
}

function getPool() {
  if (!pool) throw new Error('Database not initialized. Call connect() first.');
  return pool;
}

module.exports = { connect, getPool };
