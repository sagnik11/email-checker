// @ts-nocheck
const { Pool } = require("pg");

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS bulk_jobs (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_records INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_results (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES bulk_jobs(id) ON DELETE CASCADE,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_emails ON email_results (job_id);

CREATE TABLE IF NOT EXISTS v1_bulk_job (
  id SERIAL PRIMARY KEY,
  total_records INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS v1_task_result (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES v1_bulk_job(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  extra JSONB,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v1_task_result_job_id ON v1_task_result (job_id);

ALTER TABLE v1_bulk_job ADD COLUMN IF NOT EXISTS input_map JSONB;

CREATE TABLE IF NOT EXISTS v1_dlq_task (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES v1_bulk_job(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  dlq_arrived_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v1_dlq_task_job_id ON v1_dlq_task (job_id);
`;

class PostgresStorage {
  constructor(dbUrl, extra) {
    this.pool = new Pool({ connectionString: dbUrl });
    this.extra = extra || null;
  }

  async connect() {
    await this.pool.query(MIGRATION_SQL);
  }

  getExtra() {
    return this.extra;
  }

  async close() {
    await this.pool.end();
  }

  async createV0BulkJob(totalRecords) {
    const res = await this.pool.query(
      `INSERT INTO bulk_jobs (total_records) VALUES ($1) RETURNING id`,
      [totalRecords]
    );
    return res.rows[0].id;
  }

  async createV1BulkJob(totalRecords, inputMap = null) {
    const res = await this.pool.query(
      `INSERT INTO v1_bulk_job (total_records, input_map) VALUES ($1, $2) RETURNING id`,
      [totalRecords, inputMap === null ? null : JSON.stringify(inputMap)]
    );
    return res.rows[0].id;
  }

  async store(task, workerOutput, extra = null) {
    const payload = JSON.stringify(task);

    if (task.job_id?.kind === "bulk_v0") {
      const result = workerOutput.ok ? JSON.stringify(workerOutput.result) : null;
      await this.pool.query(
        `INSERT INTO email_results (job_id, result) VALUES ($1, $2)`,
        [task.job_id.id, result]
      );
      return;
    }

    const jobId = task.job_id?.kind === "bulk_v1" ? task.job_id.id : null;

    if (workerOutput.ok) {
      await this.pool.query(
        `INSERT INTO v1_task_result (payload, job_id, extra, result) VALUES ($1, $2, $3, $4)`,
        [payload, jobId, JSON.stringify(extra), JSON.stringify(workerOutput.result)]
      );
      return;
    }

    await this.pool.query(
      `INSERT INTO v1_task_result (payload, job_id, extra, error) VALUES ($1, $2, $3, $4)`,
      [payload, jobId, JSON.stringify(extra), String(workerOutput.error)]
    );
  }

  async getV0BulkJob(jobId) {
    const res = await this.pool.query(
      `SELECT id, created_at, total_records FROM bulk_jobs WHERE id = $1 LIMIT 1`,
      [jobId]
    );
    return res.rows[0] || null;
  }

  async getV1BulkJob(jobId) {
    const res = await this.pool.query(
      `SELECT id, created_at, total_records, input_map FROM v1_bulk_job WHERE id = $1 LIMIT 1`,
      [jobId]
    );
    return res.rows[0] || null;
  }

  async getV0BulkProgress(jobId) {
    const job = await this.getV0BulkJob(jobId);
    if (!job) return null;

    const agg = await this.pool.query(
      `
      SELECT
        COUNT(*)::int AS total_processed,
        COUNT(CASE WHEN result ->> 'is_reachable' LIKE 'safe' THEN 1 END)::int AS safe_count,
        COUNT(CASE WHEN result ->> 'is_reachable' LIKE 'risky' THEN 1 END)::int AS risky_count,
        COUNT(CASE WHEN result ->> 'is_reachable' LIKE 'invalid' THEN 1 END)::int AS invalid_count,
        COUNT(CASE WHEN result ->> 'is_reachable' LIKE 'unknown' THEN 1 END)::int AS unknown_count,
        (SELECT created_at FROM email_results WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1) AS finished_at
      FROM email_results
      WHERE job_id = $1
      `,
      [jobId]
    );

    const row = agg.rows[0];
    const totalProcessed = Number(row.total_processed || 0);
    const totalRecords = Number(job.total_records || 0);

    return {
      job_id: Number(job.id),
      created_at: new Date(job.created_at).toISOString(),
      finished_at:
        totalProcessed < totalRecords || !row.finished_at
          ? null
          : new Date(row.finished_at).toISOString(),
      total_records: totalRecords,
      total_processed: totalProcessed,
      summary: {
        total_safe: Number(row.safe_count || 0),
        total_risky: Number(row.risky_count || 0),
        total_invalid: Number(row.invalid_count || 0),
        total_unknown: Number(row.unknown_count || 0),
      },
      job_status: totalProcessed < totalRecords ? "running" : "completed",
    };
  }

  async getV1BulkProgress(jobId) {
    const job = await this.getV1BulkJob(jobId);
    if (!job) return null;

    const agg = await this.pool.query(
      `
      SELECT
        COUNT(*)::int AS total_processed,
        COUNT(CASE WHEN result ->> 'is_reachable' LIKE 'safe' THEN 1 END)::int AS safe_count,
        COUNT(CASE WHEN result ->> 'is_reachable' LIKE 'risky' THEN 1 END)::int AS risky_count,
        COUNT(CASE WHEN result ->> 'is_reachable' LIKE 'invalid' THEN 1 END)::int AS invalid_count,
        COUNT(CASE WHEN result ->> 'is_reachable' LIKE 'unknown' THEN 1 END)::int AS unknown_count,
        (SELECT created_at FROM v1_task_result WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1) AS finished_at
      FROM v1_task_result
      WHERE job_id = $1
      `,
      [jobId]
    );

    const row = agg.rows[0];
    const totalProcessed = Number(row.total_processed || 0);
    const totalRecords = Number(job.total_records || 0);
    const inputMap = Array.isArray(job.input_map) ? job.input_map : null;
    const totalInputs = inputMap ? inputMap.length : totalRecords;

    return {
      job_id: Number(job.id),
      created_at: new Date(job.created_at).toISOString(),
      finished_at:
        totalProcessed < totalRecords || !row.finished_at
          ? null
          : new Date(row.finished_at).toISOString(),
      total_inputs: totalInputs,
      total_records: totalRecords,
      total_processed: totalProcessed,
      summary: {
        total_safe: Number(row.safe_count || 0),
        total_risky: Number(row.risky_count || 0),
        total_invalid: Number(row.invalid_count || 0),
        total_unknown: Number(row.unknown_count || 0),
      },
      job_status: totalProcessed < totalRecords ? "running" : "completed",
    };
  }

  async getV0Results(jobId, limit = null, offset = 0) {
    const query =
      `SELECT result FROM email_results WHERE job_id = $1 ORDER BY id ` +
      (limit === null ? `` : `LIMIT $2 `) +
      `OFFSET $${limit === null ? 2 : 3}`;

    const params = limit === null ? [jobId, offset] : [jobId, limit, offset];
    const res = await this.pool.query(query, params);
    return res.rows.map((r) => r.result);
  }

  async getV1Results(jobId, limit = null, offset = 0) {
    const query =
      `SELECT result FROM v1_task_result WHERE job_id = $1 ORDER BY id ` +
      (limit === null ? `` : `LIMIT $2 `) +
      `OFFSET $${limit === null ? 2 : 3}`;

    const params = limit === null ? [jobId, offset] : [jobId, limit, offset];
    const res = await this.pool.query(query, params);
    return res.rows.map((r) => r.result);
  }

  async getV1ResultsByCanonical(jobId) {
    const res = await this.pool.query(
      `SELECT payload->'input'->>'to_email' AS canonical, result, error
       FROM v1_task_result WHERE job_id = $1`,
      [jobId]
    );
    const map = new Map();
    for (const row of res.rows) {
      const key = row.canonical == null ? "" : String(row.canonical).toLowerCase();
      map.set(key, { result: row.result, error: row.error });
    }
    return map;
  }

  async countV0Processed(jobId) {
    const res = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM email_results WHERE job_id = $1`,
      [jobId]
    );
    return Number(res.rows[0]?.count || 0);
  }

  async countV1Processed(jobId) {
    const res = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM v1_task_result WHERE job_id = $1`,
      [jobId]
    );
    return Number(res.rows[0]?.count || 0);
  }

  async storeDlqFailure(task, info = {}) {
    const jobId = task?.job_id?.kind === "bulk_v1" ? task.job_id.id : null;
    const payload = JSON.stringify(task);
    const errorText = String(info.error ?? "retry_exhausted");
    const attempts = Number(info.attempts ?? 0);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO v1_dlq_task (job_id, payload, error, attempts) VALUES ($1, $2, $3, $4)`,
        [jobId, payload, errorText, attempts]
      );
      await client.query(
        `INSERT INTO v1_task_result (payload, job_id, extra, error) VALUES ($1, $2, $3, $4)`,
        [payload, jobId, JSON.stringify(this.extra), errorText]
      );
      await client.query("COMMIT");
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  }

  async getV1Failures(jobId, limit = 50, offset = 0) {
    const usingLimit = limit !== null && limit !== undefined;
    const query =
      `SELECT id, payload, error, attempts, dlq_arrived_at
       FROM v1_dlq_task
       WHERE job_id = $1
       ORDER BY id ` +
      (usingLimit ? `LIMIT $2 ` : ``) +
      `OFFSET $${usingLimit ? 3 : 2}`;
    const params = usingLimit ? [jobId, limit, offset] : [jobId, offset];
    const res = await this.pool.query(query, params);
    return res.rows.map((r) => ({
      id: Number(r.id),
      payload: r.payload,
      error: r.error,
      attempts: Number(r.attempts || 0),
      dlq_arrived_at:
        r.dlq_arrived_at instanceof Date
          ? r.dlq_arrived_at.toISOString()
          : r.dlq_arrived_at,
    }));
  }

  async countV1Failures(jobId) {
    const res = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM v1_dlq_task WHERE job_id = $1`,
      [jobId]
    );
    return Number(res.rows[0]?.count || 0);
  }
}

module.exports = {
  PostgresStorage,
};
