const mysql = require('mysql2/promise');
const logger = require('./logger');

let pool = null;

async function connect() {
  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT, 10) : 3306;
  const user = process.env.MYSQL_USER || 'root';
  const password = process.env.MYSQL_PASSWORD || '';
  const database = process.env.MYSQL_DATABASE || 'survival_db';

  try {
    // Connect without database to ensure it exists
    const adminConn = await mysql.createConnection({ host, port, user, password });
    await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
    await adminConn.end();

    pool = mysql.createPool({ host, port, user, password, database, waitForConnections: true, connectionLimit: 10 });

    // Create users table if not exists
    const createUsers = `
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        passwordHash VARCHAR(255),
        oauthProvider ENUM('google','local') DEFAULT 'local',
        status ENUM('active','inactive') DEFAULT 'inactive',
        verificationCode VARCHAR(10) DEFAULT NULL,
        verificationExpiresAt DATETIME DEFAULT NULL,
        verificationAttempts INT DEFAULT 0,
        recoveryToken VARCHAR(100) DEFAULT NULL,
        recoveryTokenExpiresAt DATETIME DEFAULT NULL,
        mfaEnabled TINYINT(1) DEFAULT 0,
        mfaSecret VARCHAR(100) DEFAULT NULL,
        pendingMfaSecret VARCHAR(100) DEFAULT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;

    await pool.query(createUsers);
    // Check if coins column exists in users table, if not add it
    try {
      const [columns] = await pool.query("SHOW COLUMNS FROM users LIKE 'coins'");
      if (columns.length === 0) {
        await pool.query("ALTER TABLE users ADD COLUMN coins INT DEFAULT 0");
        logger.info('Added coins column to users table');
      }
    } catch (e) {
      logger.error('Error checking/adding coins column:', e);
    }

    // Check if equippedCosmeticId column exists in users table
    try {
      const [cols] = await pool.query("SHOW COLUMNS FROM users LIKE 'equippedCosmeticId'");
      if (cols.length === 0) {
        await pool.query("ALTER TABLE users ADD COLUMN equippedCosmeticId INT DEFAULT NULL");
        logger.info('Added equippedCosmeticId column to users table');
      }
    } catch (e) {
      logger.error('Error checking/adding equippedCosmeticId column:', e);
    }

    // Create results table for scoreboard
    const createResults = `
      CREATE TABLE IF NOT EXISTS results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        score INT NOT NULL,
        difficulty ENUM('EASY','MEDIUM','HARD') DEFAULT 'MEDIUM',
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createResults);

    // Check if difficulty column exists in results table
    try {
      const [cols] = await pool.query("SHOW COLUMNS FROM results LIKE 'difficulty'");
      if (cols.length === 0) {
        await pool.query("ALTER TABLE results ADD COLUMN difficulty ENUM('EASY','MEDIUM','HARD') DEFAULT 'MEDIUM'");
        logger.info('Added difficulty column to results table');
      }
    } catch (e) {
      logger.error('Error checking/adding difficulty column to results:', e);
    }

    // Create cosmetics table
    const createCosmetics = `
      CREATE TABLE IF NOT EXISTS cosmetics (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        price INT NOT NULL,
        imageUrl VARCHAR(255),
        color VARCHAR(20) DEFAULT '#7fffd4'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createCosmetics);

    // Add color column if missing (for existing tables)
    try {
      const [cols] = await pool.query("SHOW COLUMNS FROM cosmetics LIKE 'color'");
      if (cols.length === 0) {
        await pool.query("ALTER TABLE cosmetics ADD COLUMN color VARCHAR(20) DEFAULT '#7fffd4'");
        logger.info('Added color column to cosmetics table');
      }
    } catch (e) {
      logger.error('Error checking/adding color column:', e);
    }

    // Create user_cosmetics table
    const createUserCosmetics = `
      CREATE TABLE IF NOT EXISTS user_cosmetics (
        userId INT NOT NULL,
        cosmeticId INT NOT NULL,
        purchaseDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (userId, cosmeticId),
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (cosmeticId) REFERENCES cosmetics(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createUserCosmetics);

    // Seed some cosmetics if empty
    const [cosmeticsRows] = await pool.query('SELECT COUNT(*) as count FROM cosmetics');
    if (cosmeticsRows[0].count === 0) {
      await pool.query(`
        INSERT INTO cosmetics (name, description, price, imageUrl, color) VALUES 
        ('Espada de Fuego', 'Una espada llameante que ilumina la oscuridad.', 500, '🔥', '#ff6b35'),
        ('Escudo de Hielo', 'Un escudo impenetrable congelado en el tiempo.', 750, '❄️', '#00d4ff'),
        ('Capa de las Sombras', 'Oculta tu presencia de los enemigos.', 1200, '🌑', '#6c3baa'),
        ('Rayo de Plasma', 'Arma de energía pura.', 2000, '⚡', '#ffe44d'),
        ('Corona Dorada', 'Símbolo de la realeza en el campo de batalla.', 5000, '👑', '#ffd700')
      `);
      logger.info('Seeded default cosmetics');
    }

    logger.info('MySQL connected and ensured schema');
  } catch (err) {
    logger.error('MySQL connection error', err);
    throw err;
  }
}

function getPool() {
  if (!pool) throw new Error('Database not initialized. Call connect() first.');
  return pool;
}

module.exports = { connect, getPool };
