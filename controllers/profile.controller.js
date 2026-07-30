const db = require('../db');
const logger = require('../logger');

async function getProfile(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) return res.status(401).json({ error: 'No autorizado' });

  try {
    const pool = db.getPool();

    // Fetch user info
    const [userRows] = await pool.query(
      'SELECT id, username, email, oauthProvider, status, mfaEnabled, createdAt FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    if (userRows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    const user = userRows[0];

    // Fetch stats from results table
    const [statsRows] = await pool.query(
      `SELECT 
        COUNT(*) AS gamesPlayed,
        COALESCE(MAX(score), 0) AS highestScore,
        COALESCE(SUM(score), 0) AS totalScore,
        COALESCE(AVG(score), 0) AS averageScore
       FROM results WHERE userId = ?`,
      [userId]
    );
    const stats = statsRows[0];

    // Fetch recent results (last 5)
    const [recentResults] = await pool.query(
      'SELECT score, date FROM results WHERE userId = ? ORDER BY date DESC LIMIT 5',
      [userId]
    );

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        oauthProvider: user.oauthProvider,
        status: user.status,
        mfaEnabled: !!user.mfaEnabled,
        createdAt: user.createdAt,
      },
      stats: {
        gamesPlayed: parseInt(stats.gamesPlayed || 0, 10),
        highestScore: parseInt(stats.highestScore || 0, 10),
        totalScore: parseInt(stats.totalScore || 0, 10),
        averageScore: stats.averageScore ? parseFloat(parseFloat(stats.averageScore).toFixed(1)) : 0,
      },
      recentResults,
    });
  } catch (err) {
    logger.error('Get profile failed', { error: err.message, stack: err.stack });
    res.status(500).json({ error: `Error al obtener el perfil: ${err.message}` });
  }
}

module.exports = { getProfile };
