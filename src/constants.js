const JOB_TYPES = ['销售', '海外销售', '国际贸易', '销售运营', '运营', '管培生', '其他'];
const COMPANY_TYPES = ['外企', '国企/央企', '民企', '上市公司', '其他'];
const APPLICATION_STATUSES = ['待投', '已投', '笔试', '一面', '二面', 'Offer', '拒绝', '无回应'];
const COMMON_CHANNELS = ['企业官网', 'BOSS直聘', '智联招聘', '前程无忧', '猎聘', '实习僧', '牛客', '校园招聘', '内推', '招聘会', '其他'];
const COMMON_CITIES = ['北京', '上海', '深圳', '广州', '杭州', '成都', '武汉', '南京', '苏州', '西安', '重庆', '香港', '海外'];

const TEXT_FIELDS = [
  'applicationDate',
  'companyName',
  'jobTitle',
  'jobType',
  'companyType',
  'channel',
  'location',
  'salaryRange',
  'jobUrl',
  'status',
  'rejectionReason',
  'notes'
];

const REQUIRED_FIELDS = [
  ['applicationDate', '投递日期'],
  ['companyName', '公司名称'],
  ['jobTitle', '岗位名称'],
  ['jobType', '岗位类型'],
  ['companyType', '公司类型'],
  ['channel', '投递渠道'],
  ['location', '工作地点'],
  ['status', '投递状态']
];

const MAX_LENGTHS = {
  applicationDate: 10,
  companyName: 120,
  jobTitle: 160,
  jobType: 30,
  companyType: 30,
  channel: 80,
  location: 100,
  salaryRange: 80,
  jobUrl: 1000,
  status: 20,
  rejectionReason: 500,
  notes: 2000
};

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function weekStartFor(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay();
  const distanceToMonday = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - distanceToMonday);
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function assertInputObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    const error = new Error('请求体必须是 JSON 对象');
    error.status = 400;
    throw error;
  }
}

function normalizeApplication(input, options = {}) {
  const { partial = false, defaults = true } = options;
  assertInputObject(input);
  const result = {};

  for (const field of TEXT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      const raw = input[field];
      if (raw !== null && typeof raw !== 'string' && typeof raw !== 'number') {
        const error = new Error(`${field} 格式不正确`);
        error.status = 400;
        throw error;
      }
      const value = raw == null ? '' : String(raw).trim();
      if (value.length > MAX_LENGTHS[field]) {
        const error = new Error(`${field} 内容过长`);
        error.status = 400;
        throw error;
      }
      result[field] = value;
    }
  }

  if (!partial && defaults) {
    if (!result.applicationDate) result.applicationDate = shanghaiToday();
    if (!result.status) result.status = '待投';
  }

  const missing = [];
  if (!partial) {
    for (const [field, label] of REQUIRED_FIELDS) {
      if (!result[field]) missing.push(label);
    }
  } else {
    for (const [field, label] of REQUIRED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(result, field) && !result[field]) missing.push(label);
    }
  }
  if (missing.length) {
    const error = new Error(`请填写：${missing.join('、')}`);
    error.status = 400;
    throw error;
  }

  if (result.applicationDate && !isValidDate(result.applicationDate)) {
    const error = new Error('投递日期格式应为 YYYY-MM-DD');
    error.status = 400;
    throw error;
  }
  if (result.jobType && !JOB_TYPES.includes(result.jobType)) {
    const error = new Error(`岗位类型必须是：${JOB_TYPES.join('、')}`);
    error.status = 400;
    throw error;
  }
  if (result.companyType && !COMPANY_TYPES.includes(result.companyType)) {
    const error = new Error(`公司类型必须是：${COMPANY_TYPES.join('、')}`);
    error.status = 400;
    throw error;
  }
  if (result.status && !APPLICATION_STATUSES.includes(result.status)) {
    const error = new Error(`投递状态必须是：${APPLICATION_STATUSES.join('、')}`);
    error.status = 400;
    throw error;
  }
  if (result.jobUrl) {
    try {
      const url = new URL(result.jobUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('bad protocol');
    } catch {
      const error = new Error('岗位链接必须是有效的 http 或 https 地址');
      error.status = 400;
      throw error;
    }
  }

  return result;
}

module.exports = {
  JOB_TYPES,
  COMPANY_TYPES,
  APPLICATION_STATUSES,
  COMMON_CHANNELS,
  COMMON_CITIES,
  TEXT_FIELDS,
  REQUIRED_FIELDS,
  normalizeApplication,
  shanghaiToday,
  weekStartFor,
  addDays,
  isValidDate
};
