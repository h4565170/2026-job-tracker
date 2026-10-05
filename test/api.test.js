const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../src/database');
const { createHttpServer } = require('../src/app');

async function startTestServer(options = {}) {
  const database = createDatabase({ filePath: options.filePath || ':memory:' });
  const server = createHttpServer({
    database,
    publicDir: path.join(__dirname, '..', 'public'),
    automationApiKey: 'test-secret',
    nodeEnv: 'test',
    appPassword: options.appPassword || ''
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    database,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => { database.close(); resolve(); }))
  };
}

async function jsonRequest(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  return { response, payload };
}

test('核心 API 全流程', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  await t.test('健康检查与静态首页可用', async () => {
    const health = await jsonRequest(app.baseUrl, '/api/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.payload.ok, true);
    const home = await fetch(`${app.baseUrl}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /2026 秋招岗位投递管理表/);
  });

  await t.test('元数据提供全部固定下拉项', async () => {
    const { response, payload } = await jsonRequest(app.baseUrl, '/api/meta');
    assert.equal(response.status, 200);
    assert.deepEqual(payload.data.statuses, ['待投', '已投', '笔试', '一面', '二面', 'Offer', '拒绝', '无回应']);
    assert.ok(payload.data.jobTypes.includes('海外销售'));
    assert.ok(payload.data.companyTypes.includes('国企/央企'));
    assert.ok(payload.data.cities.includes('深圳'));
    assert.ok(payload.data.channels.includes('BOSS直聘'));
  });

  let applicationId;
  await t.test('新增岗位并可以查询', async () => {
    const { response, payload } = await jsonRequest(app.baseUrl, '/api/applications', {
      method: 'POST',
      body: JSON.stringify({
        applicationDate: '2026-10-05', companyName: '远航科技', jobTitle: '海外销售管培生',
        jobType: '海外销售', companyType: '民企', channel: '企业官网', location: '深圳',
        salaryRange: '15-20K', jobUrl: 'https://example.com/job/1', status: '已投',
        rejectionReason: '', notes: '官网投递'
      })
    });
    assert.equal(response.status, 201);
    assert.equal(payload.data.companyName, '远航科技');
    applicationId = payload.data.id;

    const search = await jsonRequest(app.baseUrl, '/api/applications?q=远航&status=已投&city=深圳');
    assert.equal(search.response.status, 200);
    assert.equal(search.payload.meta.total, 1);
    assert.equal(search.payload.data[0].id, applicationId);
  });

  await t.test('可更新状态、字段、筛选与统计', async () => {
    const status = await jsonRequest(app.baseUrl, `/api/applications/${applicationId}/status`, {
      method: 'PATCH', body: JSON.stringify({ status: '二面' })
    });
    assert.equal(status.response.status, 200);
    assert.equal(status.payload.data.status, '二面');

    const update = await jsonRequest(app.baseUrl, `/api/applications/${applicationId}`, {
      method: 'PATCH', body: JSON.stringify({ location: '上海', notes: '二面已预约' })
    });
    assert.equal(update.response.status, 200);
    assert.equal(update.payload.data.location, '上海');

    const dashboard = await jsonRequest(app.baseUrl, '/api/dashboard?today=2026-10-05&weekStart=2026-10-05');
    assert.equal(dashboard.payload.data.total, 1);
    assert.equal(dashboard.payload.data.week, 1);
    assert.equal(dashboard.payload.data.interviews, 1);
    assert.equal(dashboard.payload.data.interviewRate, 1);
    assert.equal(dashboard.payload.data.recent.length, 1);
  });

  await t.test('自动化接口需要 API Key 且可幂等写入', async () => {
    const denied = await jsonRequest(app.baseUrl, '/api/automation/applications/upsert', {
      method: 'POST', body: JSON.stringify({ externalId: 'auto-001' })
    });
    assert.equal(denied.response.status, 401);

    const create = await jsonRequest(app.baseUrl, '/api/automation/applications/upsert', {
      method: 'POST',
      headers: { 'X-API-Key': 'test-secret' },
      body: JSON.stringify({
        externalId: 'auto-001', applicationDate: '2026-10-05', companyName: '海岳集团',
        jobTitle: '国际贸易专员', jobType: '国际贸易', companyType: '国企/央企',
        channel: 'AI 助手', location: '广州', status: '已投', notes: '自动投递完成'
      })
    });
    assert.equal(create.response.status, 201);
    assert.equal(create.payload.meta.operation, 'created');

    const update = await jsonRequest(app.baseUrl, '/api/automation/applications/upsert', {
      method: 'POST',
      headers: { 'X-API-Key': 'test-secret' },
      body: JSON.stringify({
        externalId: 'auto-001', applicationDate: '2026-10-05', companyName: '海岳集团',
        jobTitle: '国际贸易专员', jobType: '国际贸易', companyType: '国企/央企',
        channel: 'AI 助手', location: '广州', status: '笔试', notes: '已收到笔试'
      })
    });
    assert.equal(update.response.status, 200);
    assert.equal(update.payload.meta.operation, 'updated');
    assert.equal(update.payload.data.status, '笔试');

    const list = await jsonRequest(app.baseUrl, '/api/applications?q=海岳');
    assert.equal(list.payload.meta.total, 1);
  });

  await t.test('非法数据被拒绝，删除后不再返回', async () => {
    const invalid = await jsonRequest(app.baseUrl, '/api/applications', {
      method: 'POST', body: JSON.stringify({ companyName: '缺少字段' })
    });
    assert.equal(invalid.response.status, 400);

    const removed = await jsonRequest(app.baseUrl, `/api/applications/${applicationId}`, { method: 'DELETE' });
    assert.equal(removed.response.status, 200);
    const missing = await jsonRequest(app.baseUrl, `/api/applications/${applicationId}`);
    assert.equal(missing.response.status, 404);
  });
});

test('SQLite 文件重新打开后仍保留数据', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'job-tracker-'));
  const filePath = path.join(directory, 'data.sqlite');
  try {
    const first = createDatabase({ filePath });
    first.createApplication({
      applicationDate: '2026-10-05', companyName: '持久化测试', jobTitle: '销售运营',
      jobType: '销售运营', companyType: '上市公司', channel: '测试', location: '北京', status: '已投'
    });
    first.close();

    const second = createDatabase({ filePath });
    const result = second.listApplications({ q: '持久化测试' });
    assert.equal(result.total, 1);
    assert.equal(result.rows[0].companyName, '持久化测试');
    second.close();
  } finally {
    const resolved = path.resolve(directory);
    if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
  }
});

test('设置 APP_PASSWORD 后会保护页面和普通 API', async (t) => {
  const app = await startTestServer({ appPassword: 'unit-pass' });
  t.after(() => app.close());

  const denied = await fetch(`${app.baseUrl}/api/applications`);
  assert.equal(denied.status, 401);
  const authorized = await fetch(`${app.baseUrl}/api/applications`, {
    headers: { Authorization: `Basic ${Buffer.from('user:unit-pass').toString('base64')}` }
  });
  assert.equal(authorized.status, 200);
  const health = await fetch(`${app.baseUrl}/api/health`);
  assert.equal(health.status, 200);

  const automation = await fetch(`${app.baseUrl}/api/automation/applications/upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-secret' },
    body: JSON.stringify({
      externalId: 'auth-check', applicationDate: '2026-10-05', companyName: '鉴权测试',
      jobTitle: '销售', jobType: '销售', companyType: '民企', channel: 'API', location: '上海', status: '已投'
    })
  });
  assert.equal(automation.status, 201);
});
