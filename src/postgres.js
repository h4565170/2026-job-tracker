const { Pool } = require('pg');
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
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function createPool(connectionString) {
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString) || /sslmode=disable/.test(connectionString);
  let effectiveConnectionString = connectionString;
  if (!isLocal) {
    try {
      const url = new URL(connectionString);
      url.searchParams.delete('sslmode');
      effectiveConnectionString = url.toString();
    } catch {
      effectiveConnectionString = connectionString;
    }
  }
  return new Pool({
    connectionString: effectiveConnectionString,
    max: 4,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    ssl: isLocal ? false : { rejectUnauthorized: false }
  });
}

function createPostgresDatabase(options = {}) {
  const connectionString = options.connectionString || process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  if (!connectionString) throw new Error('DATABASE_URL 未配置');
  const pool = createPool(connectionString);
  let schemaPromise;

  async function ensureSchema() {
    if (!schemaPromise) {
      schemaPromise = pool.query(`
        CREATE TABLE IF NOT EXISTS applications (
          id BIGSERIAL PRIMARY KEY,
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
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
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
    }
    return schemaPromise;
  }

  async function query(text, params = []) {
    await ensureSchema();
    return pool.query(text, params);
  }

  async function getApplication(id) {
    const result = await query('SELECT * FROM applications WHERE id = $1', [Number(id)]);
    return mapRow(result.rows[0]);
  }

  async function getApplicationByExternalId(externalId) {
    const result = await query(
      "SELECT * FROM applications WHERE source = 'automation' AND external_id = $1",
      [String(externalId)]
    );
    return mapRow(result.rows[0]);
  }

  async function insertApplication(payload, source = 'manual', externalId = null) {
    const columns = ['created_at', 'updated_at', 'source', 'external_id'];
    const params = [nowIso(), nowIso(), source, externalId];
    for (const [field, column] of Object.entries(FIELD_COLUMNS)) {
      columns.push(column);
      params.push(payload[field] ?? '');
    }
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    const result = await query(
      `INSERT INTO applications (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      params
    );
    return mapRow(result.rows[0]);
  }

  async function createApplication(payload) {
    return insertApplication(payload, 'manual', null);
  }

  async function updateApplication(id, payload) {
    const entries = Object.entries(payload).filter(([field]) => FIELD_COLUMNS[field]);
    if (!entries.length) return getApplication(id);
    const setters = entries.map(([field], index) => `${FIELD_COLUMNS[field]} = $${index + 1}`);
    const params = entries.map(([, value]) => value ?? '');
    setters.push(`updated_at = $${params.length + 1}`);
    params.push(nowIso(), Number(id));
    const result = await query(
      `UPDATE applications SET ${setters.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    return mapRow(result.rows[0]);
  }

  async function updateStatus(id, status) {
    const result = await query(
      'UPDATE applications SET status = $1, updated_at = $2 WHERE id = $3 RETURNING *',
      [status, nowIso(), Number(id)]
    );
    return mapRow(result.rows[0]);
  }

  async function deleteApplication(id) {
    const result = await query('DELETE FROM applications WHERE id = $1', [Number(id)]);
    return result.rowCount > 0;
  }

  async function listApplications(filters = {}) {
    const clauses = [];
    const params = [];
    const addLike = (columns, value) => {
      const conditions = [];
      for (const column of columns) {
        params.push(`%${String(value).trim()}%`);
        conditions.push(`${column} ILIKE $${params.length}`);
      }
      clauses.push(`(${conditions.join(' OR ')})`);
    };

    if (filters.q) {
      addLike(
        ['company_name', 'job_title', 'location', 'channel', 'salary_range', 'notes', 'rejection_reason'],
        filters.q
      );
    }
    if (filters.status) {
      params.push(filters.status);
      clauses.push(`status = $${params.length}`);
    }
    if (filters.jobType) {
      params.push(filters.jobType);
      clauses.push(`job_type = $${params.length}`);
    }
    if (filters.companyType) {
      params.push(filters.companyType);
      clauses.push(`company_type = $${params.length}`);
    }
    if (filters.city) {
      params.push(`%${String(filters.city).trim()}%`);
      clauses.push(`location ILIKE $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sortColumn = SORT_COLUMNS[filters.sortBy] || SORT_COLUMNS.applicationDate;
    const sortDirection = String(filters.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(Math.max(Number(filters.limit) || 500, 1), 1000);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const totalResult = await query(`SELECT COUNT(*)::int AS count FROM applications ${where}`, params);
    const listParams = [...params, limit, offset];
    const result = await query(`
      SELECT * FROM applications
      ${where}
      ORDER BY ${sortColumn} ${sortDirection}, id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, listParams);

    return {
      rows: result.rows.map(mapRow),
      total: totalResult.rows[0].count,
      limit,
      offset
    };
  }

  async function getDashboard(today, weekStart) {
    const weekEnd = addDays(weekStart, 6);
    const result = await query(`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(CASE WHEN status <> '待投' THEN 1 ELSE 0 END), 0)::int AS delivered,
        COALESCE(SUM(CASE WHEN status = '待投' THEN 1 ELSE 0 END), 0)::int AS waiting,
        COALESCE(SUM(CASE WHEN application_date BETWEEN $1 AND $2 THEN 1 ELSE 0 END), 0)::int AS week,
        COALESCE(SUM(CASE WHEN status IN ('一面', '二面', 'Offer') THEN 1 ELSE 0 END), 0)::int AS interviews,
        COALESCE(SUM(CASE WHEN status = 'Offer' THEN 1 ELSE 0 END), 0)::int AS offers,
        COALESCE(SUM(CASE WHEN status = '拒绝' THEN 1 ELSE 0 END), 0)::int AS rejections,
        COALESCE(SUM(CASE WHEN status = '无回应' THEN 1 ELSE 0 END), 0)::int AS no_response
      FROM applications
    `, [weekStart, weekEnd]);
    const recentResult = await query(`
      SELECT * FROM applications
      ORDER BY application_date DESC, created_at DESC, id DESC
      LIMIT 6
    `);
    const counts = result.rows[0];
    const delivered = Number(counts.delivered);
    const interviews = Number(counts.interviews);
    const offers = Number(counts.offers);

    return {
      today,
      weekStart,
      weekEnd,
      total: Number(counts.total),
      delivered,
      waiting: Number(counts.waiting),
      week: Number(counts.week),
      interviews,
      offers,
      rejections: Number(counts.rejections),
      noResponse: Number(counts.no_response),
      interviewRate: delivered ? interviews / delivered : 0,
      offerRate: delivered ? offers / delivered : 0,
      recent: recentResult.rows.map(mapRow)
    };
  }

  async function getMeta() {
    const citiesResult = await query(`
      SELECT location, COUNT(*)::int AS count
      FROM applications
      WHERE TRIM(location) <> ''
      GROUP BY location
      ORDER BY count DESC, location ASC
      LIMIT 50
    `);
    const channelsResult = await query(`
      SELECT channel, COUNT(*)::int AS count
      FROM applications
      WHERE TRIM(channel) <> ''
      GROUP BY channel
      ORDER BY count DESC, channel ASC
      LIMIT 30
    `);
    const storedCities = citiesResult.rows.map((row) => row.location);
    const storedChannels = channelsResult.rows.map((row) => row.channel);
    return {
      cities: [...new Set([...storedCities, ...COMMON_CITIES])],
      channels: [...new Set([...storedChannels, ...COMMON_CHANNELS])]
    };
  }

  async function upsertAutomationApplication(payload, externalId) {
    const existing = externalId ? await getApplicationByExternalId(externalId) : null;
    if (existing) {
      return { application: await updateApplication(existing.id, payload), created: false };
    }
    return { application: await insertApplication(payload, 'automation', externalId || null), created: true };
  }

  async function close() {
    await pool.end();
  }

  return {
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

module.exports = { createPostgresDatabase, mapRow };
