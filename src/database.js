const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { addDays, COMMON_CHANNELS, COMMON_CITIES } = require('./constants');

const FIELD_COLUMNS = {
  applicationDate: 'application_date',
  companyName: 'company_name',
  jobTitle: 'job_title',
  jobType: 'job_type',
  companyType: 'company_type',
  channel: 'channel',
  location: 'location',
  salaryRange: 'salary_range',
  jobUrl: 'job_url',
  status: 'status',
  rejectionReason: 'rejection_reason',
  notes: 'notes'
};

const SORT_COLUMNS = {
  applicationDate: 'application_date',
  companyName: 'company_name',
  jobTitle: 'job_title',
  status: 'status',
  updatedAt: 'updated_at',
  createdAt: 'created_at'
};

function nowIso() {
  return new Date().toISOString();
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    applicationDate: row.application_date,
    companyName: row.company_name,
    jobTitle: row.job_title,
    jobType: row.job_type,
    companyType: row.company_type,
    channel: row.channel,
    location: row.location,
    salaryRange: row.salary_range || '',
    jobUrl: row.job_url || '',
    status: row.status,
    rejectionReason: row.rejection_reason || '',
    notes: row.notes || '',
    source: row.source || 'manual',
    externalId: row.external_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createDatabase(options = {}) {
  const filePath = options.filePath || ':memory:';
  let actualPath = filePath;
  if (filePath !== ':memory:') {
    actualPath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(actualPath), { recursive: true });
  }

  const db = new DatabaseSync(actualPath);
  if (actualPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_date TEXT NOT NULL,
      company_name TEXT NOT NULL,
      job_title TEXT NOT NULL,
      job_type TEXT NOT NULL,
      company_type TEXT NOT NULL,
      channel TEXT NOT NULL,
      location TEXT NOT NULL,
      salary_range TEXT NOT NULL DEFAULT '',
      job_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '待投',
      rejection_reason TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      external_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_applications_date ON applications(application_date DESC);
    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_applications_job_type ON applications(job_type);
    CREATE INDEX IF NOT EXISTS idx_applications_company_type ON applications(company_type);
    CREATE INDEX IF NOT EXISTS idx_applications_location ON applications(location);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_external
      ON applications(source, external_id)
      WHERE external_id IS NOT NULL;
  `);

  const statements = {
    getById: db.prepare('SELECT * FROM applications WHERE id = ?'),
    getByExternalId: db.prepare("SELECT * FROM applications WHERE source = 'automation' AND external_id = ?"),
    delete: db.prepare('DELETE FROM applications WHERE id = ?')
  };

  function getApplication(id) {
    return mapRow(statements.getById.get(Number(id)));
  }

  function getApplicationByExternalId(externalId) {
    return mapRow(statements.getByExternalId.get(String(externalId)));
  }

  function insertApplication(payload, source = 'manual', externalId = null) {
    const columns = ['created_at', 'updated_at', 'source', 'external_id'];
    const params = [nowIso(), nowIso(), source, externalId];
    for (const [field, column] of Object.entries(FIELD_COLUMNS)) {
      columns.push(column);
      params.push(payload[field] ?? '');
    }
    const placeholders = columns.map(() => '?').join(', ');
    const result = db.prepare(`
      INSERT INTO applications (${columns.join(', ')})
      VALUES (${placeholders})
    `).run(...params);
    return getApplication(Number(result.lastInsertRowid));
  }

  function createApplication(payload) {
    return insertApplication(payload, 'manual', null);
  }

  function updateApplication(id, payload) {
    const entries = Object.entries(payload).filter(([field]) => FIELD_COLUMNS[field]);
    if (!entries.length) return getApplication(id);
    const setters = entries.map(([field]) => `${FIELD_COLUMNS[field]} = ?`);
    const params = entries.map(([, value]) => value ?? '');
    setters.push('updated_at = ?');
    params.push(nowIso(), Number(id));
    const result = db.prepare(`
      UPDATE applications
      SET ${setters.join(', ')}
      WHERE id = ?
    `).run(...params);
    return Number(result.changes) ? getApplication(id) : null;
  }

  function updateStatus(id, status) {
    const result = db.prepare(`
      UPDATE applications
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(status, nowIso(), Number(id));
    return Number(result.changes) ? getApplication(id) : null;
  }

  function deleteApplication(id) {
    return Number(statements.delete.run(Number(id)).changes) > 0;
  }

  function listApplications(filters = {}) {
    const clauses = [];
    const params = [];
    const addLike = (columns, value) => {
      const pattern = `%${String(value).trim()}%`;
      clauses.push(`(${columns.map((column) => `${column} LIKE ? COLLATE NOCASE`).join(' OR ')})`);
      columns.forEach(() => params.push(pattern));
    };

    if (filters.q) {
      addLike(
        ['company_name', 'job_title', 'location', 'channel', 'salary_range', 'notes', 'rejection_reason'],
        filters.q
      );
    }
    if (filters.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }
    if (filters.jobType) {
      clauses.push('job_type = ?');
      params.push(filters.jobType);
    }
    if (filters.companyType) {
      clauses.push('company_type = ?');
      params.push(filters.companyType);
    }
    if (filters.city) {
      clauses.push('location LIKE ?');
      params.push(`%${String(filters.city).trim()}%`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sortColumn = SORT_COLUMNS[filters.sortBy] || SORT_COLUMNS.applicationDate;
    const sortDirection = String(filters.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(Math.max(Number(filters.limit) || 500, 1), 1000);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM applications ${where}`).get(...params).count);
    const rows = db.prepare(`
      SELECT * FROM applications
      ${where}
      ORDER BY ${sortColumn} ${sortDirection}, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return { rows: rows.map(mapRow), total, limit, offset };
  }

  function getDashboard(today, weekStart) {
    const weekEnd = addDays(weekStart, 6);
    const counts = db.prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status <> '待投' THEN 1 ELSE 0 END), 0) AS delivered,
        COALESCE(SUM(CASE WHEN status = '待投' THEN 1 ELSE 0 END), 0) AS waiting,
        COALESCE(SUM(CASE WHEN application_date BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS week,
        COALESCE(SUM(CASE WHEN status IN ('一面', '二面', 'Offer') THEN 1 ELSE 0 END), 0) AS interviews,
        COALESCE(SUM(CASE WHEN status = 'Offer' THEN 1 ELSE 0 END), 0) AS offers,
        COALESCE(SUM(CASE WHEN status = '拒绝' THEN 1 ELSE 0 END), 0) AS rejections,
        COALESCE(SUM(CASE WHEN status = '无回应' THEN 1 ELSE 0 END), 0) AS noResponse
      FROM applications
    `).get(weekStart, weekEnd);

    const total = Number(counts.total);
    const delivered = Number(counts.delivered);
    const interviews = Number(counts.interviews);
    const offers = Number(counts.offers);
    const recent = db.prepare(`
      SELECT * FROM applications
      ORDER BY application_date DESC, created_at DESC, id DESC
      LIMIT 6
    `).all().map(mapRow);

    return {
      today,
      weekStart,
      weekEnd,
      total,
      delivered,
      waiting: Number(counts.waiting),
      week: Number(counts.week),
      interviews,
      offers,
      rejections: Number(counts.rejections),
      noResponse: Number(counts.noResponse),
      interviewRate: delivered ? interviews / delivered : 0,
      offerRate: delivered ? offers / delivered : 0,
      recent
    };
  }

  function getMeta() {
    const storedCities = db.prepare(`
      SELECT location, COUNT(*) AS count
      FROM applications
      WHERE TRIM(location) <> ''
      GROUP BY location
      ORDER BY count DESC, location ASC
      LIMIT 50
    `).all().map((row) => row.location);
    const storedChannels = db.prepare(`
      SELECT channel, COUNT(*) AS count
      FROM applications
      WHERE TRIM(channel) <> ''
      GROUP BY channel
      ORDER BY count DESC, channel ASC
      LIMIT 30
    `).all().map((row) => row.channel);
    const cities = [...new Set([...storedCities, ...COMMON_CITIES])];
    const channels = [...new Set([...storedChannels, ...COMMON_CHANNELS])];
    return { cities, channels };
  }

  function upsertAutomationApplication(payload, externalId) {
    const existing = externalId ? getApplicationByExternalId(externalId) : null;
    if (existing) return { application: updateApplication(existing.id, payload), created: false };
    return { application: insertApplication(payload, 'automation', externalId || null), created: true };
  }

  function close() {
    db.close();
  }

  return {
    raw: db,
    getApplication,
    getApplicationByExternalId,
    createApplication,
    updateApplication,
    updateStatus,
    deleteApplication,
    listApplications,
    getDashboard,
    getMeta,
    upsertAutomationApplication,
    close
  };
}

module.exports = { createDatabase, mapRow };
