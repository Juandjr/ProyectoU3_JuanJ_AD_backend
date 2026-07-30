const fs = require('fs');
const path = require('path');
const { createLogger, format, transports } = require('winston');

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
      return `${timestamp} [${level}] ${message} ${metaStr}`;
    })
  ),
  transports: [
    new transports.File({ filename: path.join(logsDir, 'app.logs') }),
    new transports.Console()
  ]
});

module.exports = logger;
