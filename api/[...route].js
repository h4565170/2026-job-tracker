const path = require('node:path');
const { createRequestHandler } = require('../src/app');
const { createPostgresDatabase } = require('../src/postgres');

let requestHandler;

function getRequestHandler() {
  if (!requestHandler) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
    if (!connectionString) {
      const error = new Error('DATABASE_URL 未配置');
      error.status = 503;
      throw error;
    }
    const database = createPostgresDatabase({ connectionString });
    requestHandler = createRequestHandler({
      database,
      publicDir: path.join(process.cwd(), 'public'),
      appPassword: process.env.APP_PASSWORD || '',
      automationApiKey: process.env.AUTOMATION_API_KEY || '',
      nodeEnv: process.env.NODE_ENV || 'production'
    });
  }
  return requestHandler;
}

module.exports = async (req, res) => {
  try {
    await getRequestHandler()(req, res);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    const body = JSON.stringify({ error: status >= 500 ? '服务器内部错误' : error.message });
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store'
    });
    res.end(body);
  }
};
