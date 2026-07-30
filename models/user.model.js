const db = require('../db');

// Lightweight user model backed by MySQL. Exposes minimal API used by the app:
// - find(filter, projection)
// - findById(id) -> returns user object with `.results` array and `save()` method

async function find(filter = {}, projection = {}) {
  const pool = db.getPool();
  const [users] = await pool.query('SELECT id, username FROM users');
  // Load results for each user
  const userIds = users.map(u => u.id);
  let resultsMap = {};
  if (userIds.length > 0) {
    const [rows] = await pool.query('SELECT id, userId, score, difficulty, date FROM results WHERE userId IN (?)', [userIds]);
    rows.forEach(r => {
      if (!resultsMap[r.userId]) resultsMap[r.userId] = [];
      resultsMap[r.userId].push({ score: r.score, difficulty: r.difficulty, date: r.date });
    });
  }
  return users.map(u => ({ id: u.id, username: u.username, results: resultsMap[u.id] || [] }));
}

async function findById(id) {
  const pool = db.getPool();
  const [rows] = await pool.query('SELECT id, username, email FROM users WHERE id = ? LIMIT 1', [id]);
  if (rows.length === 0) return null;
  const user = rows[0];
  const [resRows] = await pool.query('SELECT id, score, difficulty, date FROM results WHERE userId = ? ORDER BY date DESC', [id]);
  user.results = resRows.map(r => ({ score: r.score, difficulty: r.difficulty, date: r.date }));

  // Attach save method to allow pushing new results and saving
  user.save = async function () {
    if (!this._pendingResult) return;
    const diff = ['EASY', 'MEDIUM', 'HARD'].includes(this._pendingResult.difficulty) ? this._pendingResult.difficulty : 'MEDIUM';
    await pool.query('INSERT INTO results (userId, score, difficulty) VALUES (?, ?, ?)', [this.id, this._pendingResult.score, diff]);
    delete this._pendingResult;
  };

  // Provide helper to push result similarly to mongoose
  user.resultsPush = function (result) {
    // record pending result which save() will persist
    this._pendingResult = result;
    this.results = this.results || [];
    this.results.push(result);
  };

  return user;
}

module.exports = { find, findById };
