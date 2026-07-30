const User = require('../models/user.model');
const logger = require('../logger');
const gameRoomState = require('../game-room-state');

function calculatePlayReward(score, difficulty) {
  const normalizedScore = Math.max(0, Math.floor(Number(score) || 0));
  const baseCoins = Math.floor(normalizedScore / 25);

  const multiplier = {
    EASY: 1,
    MEDIUM: 1.25,
    HARD: 1.5
  }[difficulty] || 1;

  // Reward is intentionally modest so it doesn't unbalance the store economy.
  return Math.max(0, Math.floor(baseCoins * multiplier));
}

async function getScoreboard(req, res) {
  try {
    const difficulty = req.query.difficulty;
    const db = require('../db');
    const pool = db.getPool();

    let query = `
      SELECT r.score, r.difficulty, r.date, u.username
      FROM results r
      JOIN users u ON u.id = r."userId"
    `;
    const params = [];

    if (difficulty && ['EASY', 'MEDIUM', 'HARD'].includes(difficulty)) {
      query += ` WHERE r.difficulty = $1`;
      params.push(difficulty);
    }

    query += ` ORDER BY r.score DESC, r.date DESC LIMIT 10`;

    const { rows } = await pool.query(query, params);
    const entries = rows.map(row => ({ username: row.username, score: row.score, difficulty: row.difficulty, date: row.date }));
    res.json(entries);
  } catch (err) {
    logger.error('Failed to get scoreboard', { err: err.message });
    res.status(500).json({ error: 'Server error' });
  }
}

async function submitResult(req, res) {
  try {
    const userId = req.user && req.user.id;
    const { score, difficulty } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (typeof score !== 'number') return res.status(400).json({ error: 'Invalid score' });

    const normalizedIncomingDifficulty = typeof difficulty === 'string' ? difficulty.toUpperCase() : '';
    const roomDifficulty = ['EASY', 'MEDIUM', 'HARD'].includes(normalizedIncomingDifficulty)
      ? normalizedIncomingDifficulty
      : gameRoomState.getUserDifficulty(userId);

    const diff = ['EASY', 'MEDIUM', 'HARD'].includes(roomDifficulty) ? roomDifficulty : 'MEDIUM';

    logger.info('Submitting scoreboard result', { userId, incomingDifficulty: normalizedIncomingDifficulty, resolvedDifficulty: diff, score });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const db = require('../db');
    const pool = db.getPool();

    const { rows: existingRows } = await pool.query(
      'SELECT id, score FROM results WHERE "userId" = $1 AND difficulty = $2 ORDER BY score DESC, date DESC LIMIT 1',
      [user.id, diff]
    );

    const coinsEarned = calculatePlayReward(score, diff);
    if (coinsEarned > 0) {
      await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [coinsEarned, user.id]);
      logger.info('Added play reward coins', { userId: user.id, difficulty: diff, score, coinsEarned });
    }

    const currentBest = existingRows[0] ? Number(existingRows[0].score) || 0 : 0;

    if (score > currentBest) {
      if (existingRows[0]?.id) {
        await pool.query('UPDATE results SET score = $1, date = NOW() WHERE id = $2', [score, existingRows[0].id]);
      } else {
        await pool.query('INSERT INTO results ("userId", score, difficulty, date) VALUES ($1, $2, $3, NOW())', [user.id, score, diff]);
      }
      return res.json({ ok: true, updated: true, difficulty: diff, score, coinsEarned });
    }

    res.json({ ok: true, updated: false, difficulty: diff, score, coinsEarned, message: 'Score not higher than existing best for this difficulty' });
  } catch (err) {
    logger.error('Failed to submit result', { err: err.message });
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { getScoreboard, submitResult };
