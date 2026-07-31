const fs = require('fs');
const path = require('path');
const { createLogger, format, transports } = require('winston');

const loggerTransports = [new transports.Console()];

// Only write to file if NOT running in Vercel / serverless environment
if (!process.env.VERCEL) {
  try {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    loggerTransports.push(new transports.File({ filename: path.join(logsDir, 'app.logs') }));
  } catch (err) {
    console.warn('Could not initialize file logger transport, falling back to Console:', err.message);
  }
}

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
      return `${timestamp} [${level}] ${message} ${metaStr}`;
    })
  ),
  transports: loggerTransports
});

module.exports = logger;

