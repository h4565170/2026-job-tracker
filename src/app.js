const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const {
  JOB_TYPES,
  COMPANY_TYPES,
  APPLICATION_STATUSES,
  normalizeApplication,
  shanghaiToday,
  weekStartFor,
  isValidDate
} = require('./constants');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const error = new Error('请求体过大');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('JSON 格式不正确');
    error.status = 400;
    throw error;
  }
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return require('node:crypto').timingSafeEqual(a, b);
}

function hasBasicAuth(req, password) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const suppliedPassword = separator >= 0 ? decoded.slice(separator + 1) : '';
    return secureEqual(suppliedPassword, password);
  } catch {
    return false;
  }
}

function hasAutomationKey(req, apiKey) {
  const supplied = req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return secureEqual(supplied, apiKey);
}

function parsePositiveId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error('记录 ID 不正确');
    error.status = 400;
    throw error;
  }
  return id;
}

function createHttpServer(options) {
  if (!options || !options.database) throw new Error('createHttpServer 需要 database');
  const database = options.database;
  const publicDir = path.resolve(options.publicDir || path.join(__dirname, '..', 'public'));
  const appPassword = options.appPassword || '';
  const automationApiKey = options.automationApiKey || '';
  const nodeEnv = options.nodeEnv || process.env.NODE_ENV || 'development';

  const server = require('node:http').createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = decodeURIComponent(requestUrl.pathname);

      if (pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, service: '2026秋招岗位投递管理表', time: new Date().toISOString() });
        return;
      }

      if (appPassword && !pathname.startsWith('/api/automation/') && !hasBasicAuth(req, appPassword)) {
        sendJson(res, 401, { error: '需要访问密码' }, { 'WWW-Authenticate': 'Basic realm="2026 Job Tracker"' });
        return;
      }

      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, requestUrl, pathname, {
          database,
          automationApiKey,
          nodeEnv
        });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: '不支持的请求方法' });
        return;
      }

      serveStatic(req, res, pathname, publicDir);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error(error);
      sendJson(res, status, { error: status >= 500 ? '服务器内部错误' : error.message });
    }
  });

  return server;
}

async function handleApi(req, res, requestUrl, pathname, context) {
  const { database, automationApiKey, nodeEnv } = context;

  if (pathname === '/api/meta' && req.method === 'GET') {
    sendJson(res, 200, {
      data: {
        jobTypes: JOB_TYPES,
        companyTypes: COMPANY_TYPES,
        statuses: APPLICATION_STATUSES,
        ...(await database.getMeta())
      }
    });
    return;
  }

  if (pathname === '/api/dashboard' && req.method === 'GET') {
    const requestedToday = requestUrl.searchParams.get('today') || shanghaiToday();
    if (!isValidDate(requestedToday)) {
      const error = new Error('today 日期格式不正确');
      error.status = 400;
      throw error;
    }
    const requestedWeekStart = requestUrl.searchParams.get('weekStart') || weekStartFor(requestedToday);
    if (!isValidDate(requestedWeekStart)) {
      const error = new Error('weekStart 日期格式不正确');
      error.status = 400;
      throw error;
    }
    sendJson(res, 200, { data: await database.getDashboard(requestedToday, requestedWeekStart) });
    return;
  }

  if (pathname === '/api/applications' && req.method === 'GET') {
    const result = await database.listApplications({
      q: requestUrl.searchParams.get('q') || '',
      status: requestUrl.searchParams.get('status') || '',
      jobType: requestUrl.searchParams.get('jobType') || '',
      companyType: requestUrl.searchParams.get('companyType') || '',
      city: requestUrl.searchParams.get('city') || '',
      sortBy: requestUrl.searchParams.get('sortBy') || '',
      sortDir: requestUrl.searchParams.get('sortDir') || '',
      limit: requestUrl.searchParams.get('limit') || 500,
      offset: requestUrl.searchParams.get('offset') || 0
    });
    sendJson(res, 200, { data: result.rows, meta: { total: result.total, limit: result.limit, offset: result.offset } });
    return;
  }

  if (pathname === '/api/applications' && req.method === 'POST') {
    const payload = normalizeApplication(await readJson(req));
    sendJson(res, 201, { data: await database.createApplication(payload) });
    return;
  }

  const statusRoute = pathname.match(/^\/api\/applications\/(\d+)\/status$/);
  if (statusRoute && req.method === 'PATCH') {
    const id = parsePositiveId(statusRoute[1]);
    const body = await readJson(req);
    const payload = normalizeApplication({ status: body.status }, { partial: true });
    const application = await database.updateStatus(id, payload.status);
    if (!application) {
      sendJson(res, 404, { error: '未找到该岗位记录' });
      return;
    }
    sendJson(res, 200, { data: application });
    return;
  }

  const applicationRoute = pathname.match(/^\/api\/applications\/(\d+)$/);
  if (applicationRoute && req.method === 'GET') {
    const application = await database.getApplication(parsePositiveId(applicationRoute[1]));
    if (!application) {
      sendJson(res, 404, { error: '未找到该岗位记录' });
      return;
    }
    sendJson(res, 200, { data: application });
    return;
  }

  if (applicationRoute && req.method === 'PATCH') {
    const id = parsePositiveId(applicationRoute[1]);
    const payload = normalizeApplication(await readJson(req), { partial: true, defaults: false });
    if (!Object.keys(payload).length) {
      sendJson(res, 400, { error: '没有可更新的字段' });
      return;
    }
    const application = await database.updateApplication(id, payload);
    if (!application) {
      sendJson(res, 404, { error: '未找到该岗位记录' });
      return;
    }
    sendJson(res, 200, { data: application });
    return;
  }

  if (applicationRoute && req.method === 'DELETE') {
    const deleted = await database.deleteApplication(parsePositiveId(applicationRoute[1]));
    if (!deleted) {
      sendJson(res, 404, { error: '未找到该岗位记录' });
      return;
    }
    sendJson(res, 200, { data: { deleted: true } });
    return;
  }

  const isAutomationRoute = pathname === '/api/automation/applications' ||
    pathname === '/api/automation/applications/upsert';

  if (isAutomationRoute && req.method === 'POST') {
    requireAutomationAccess(req, automationApiKey, nodeEnv);
    const body = await readJson(req);
    const source = body.application || body.data || body;
    const externalId = String(body.externalId || source.externalId || '').trim();
    if (!externalId) {
      const error = new Error('externalId 为必填，用于防止自动投递重复写入');
      error.status = 400;
      throw error;
    }
    if (externalId.length > 200) {
      const error = new Error('externalId 不能超过 200 个字符');
      error.status = 400;
      throw error;
    }
    const payload = normalizeApplication(source, { partial: false, defaults: true });
    const result = await database.upsertAutomationApplication(payload, externalId);
    sendJson(res, result.created ? 201 : 200, {
      data: result.application,
      meta: { operation: result.created ? 'created' : 'updated' }
    });
    return;
  }

  const automationStatusRoute = pathname.match(/^\/api\/automation\/applications\/(\d+)\/status$/);
  if (automationStatusRoute && req.method === 'PATCH') {
    requireAutomationAccess(req, automationApiKey, nodeEnv);
    const body = await readJson(req);
    const payload = normalizeApplication({ status: body.status }, { partial: true });
    const application = await database.updateStatus(parsePositiveId(automationStatusRoute[1]), payload.status);
    if (!application) {
      sendJson(res, 404, { error: '未找到该岗位记录' });
      return;
    }
    sendJson(res, 200, { data: application });
    return;
  }

  sendJson(res, 404, { error: '接口不存在' });
}

function requireAutomationAccess(req, apiKey, nodeEnv) {
  if (!apiKey && nodeEnv !== 'production') return;
  if (!apiKey) {
    const error = new Error('自动化 API 未配置 AUTOMATION_API_KEY');
    error.status = 503;
    throw error;
  }
  if (!hasAutomationKey(req, apiKey)) {
    const error = new Error('自动化 API Key 不正确');
    error.status = 401;
    throw error;
  }
}

function serveStatic(req, res, pathname, publicDir) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let filePath = path.resolve(publicDir, relativePath);
  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) {
    sendJson(res, 403, { error: '禁止访问' });
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    if (path.extname(relativePath)) {
      sendJson(res, 404, { error: '文件不存在' });
      return;
    }
    filePath = path.join(publicDir, 'index.html');
  }

  const body = fs.readFileSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff'
  });
  if (req.method === 'HEAD') res.end();
  else res.end(body);
}

function createRequestHandler(options) {
  const server = createHttpServer(options);
  return server.listeners('request')[0];
}

module.exports = { createHttpServer, createRequestHandler, sendJson };
