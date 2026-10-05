const path = require('node:path');
const fs = require('node:fs');
const { createDatabase } = require('./src/database');
const { createHttpServer } = require('./src/app');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(dataDir, 'job-tracker.sqlite'));

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const database = createDatabase({ filePath: databasePath });
const server = createHttpServer({
  database,
  publicDir: path.join(__dirname, 'public'),
  appPassword: process.env.APP_PASSWORD || '',
  automationApiKey: process.env.AUTOMATION_API_KEY || '',
  nodeEnv: process.env.NODE_ENV || 'development'
});

server.listen(port, host, () => {
  console.log(`2026秋招岗位投递管理表已启动：http://${host}:${port}`);
  console.log(`数据库：${databasePath}`);
  if (process.env.APP_PASSWORD) console.log('访问密码保护：已开启');
  if (process.env.AUTOMATION_API_KEY) console.log('自动化 API Key：已配置');
});

function shutdown(signal) {
  console.log(`收到 ${signal}，正在安全关闭...`);
  server.close(() => {
    database.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
