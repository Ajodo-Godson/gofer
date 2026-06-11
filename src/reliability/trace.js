import { AdapterError } from "../interfaces/AdapterError.js";

/**
 * Creates a tracer backed by a pg Pool.
 * @param {import('pg').Pool} pool
 */
export function createTracer(pool) {
  return new PgTracer(pool);
}

let _default = null;

/**
 * Returns the module-level default tracer.
 * Must call setDefaultTracer(pool) before first use,
 * or pass a pool directly to createTracer().
 */
export function getDefaultTracer() {
  if (!_default) {
    throw new AdapterError(
      "unavailable",
      "No default tracer configured. Call setDefaultTracer(pool) first.",
      { provider: "tracer" }
    );
  }
  return _default;
}

export function setDefaultTracer(pool) {
  _default = createTracer(pool);
}

class PgTracer {
  #pool;

  constructor(pool) {
    this.#pool = pool;
  }

  /**
   * Inserts an errand record and returns the errand_id.
   * @param {string} errandId
   * @param {{ userId: string, templateId?: string, request?: object }} opts
   */
  async startErrand(errandId, { userId, templateId = null, request = {} } = {}) {
    if (!errandId || !userId) {
      throw new AdapterError("invalid", "startErrand requires errandId and userId.", {
        provider: "tracer",
        errandId
      });
    }

    try {
      await this.#pool.query(
        `INSERT INTO errands (errand_id, user_id, template_id, request, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'pending', now(), now())
         ON CONFLICT (errand_id) DO NOTHING`,
        [errandId, userId, templateId, JSON.stringify(request)]
      );
      return errandId;
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError("unknown", `startErrand failed: ${error.message}`, {
        provider: "tracer",
        errandId,
        cause: error
      });
    }
  }

  /**
   * Appends a step-level trace entry.
   * @param {string} errandId
   * @param {string|null} jobId
   * @param {{ step?: string, provider?: string, status?: string, meta?: object }} opts
   */
  async logStep(errandId, jobId, { step = null, provider = null, status = "started", meta = {} } = {}) {
    if (!errandId) {
      throw new AdapterError("invalid", "logStep requires errandId.", { provider: "tracer" });
    }

    try {
      const { rows } = await this.#pool.query(
        `INSERT INTO traces (errand_id, job_id, step, provider, status, meta, ts)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         RETURNING id`,
        [errandId, jobId || null, step, provider, status, JSON.stringify(meta)]
      );
      return { id: rows[0].id };
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError("unknown", `logStep failed: ${error.message}`, {
        provider: "tracer",
        errandId,
        cause: error
      });
    }
  }

  /**
   * Marks the errand finished with a final status.
   * @param {string} errandId
   * @param {{ outcome?: string, confirmed?: boolean }} opts
   */
  async finishErrand(errandId, { outcome = "done", confirmed = false } = {}) {
    if (!errandId) {
      throw new AdapterError("invalid", "finishErrand requires errandId.", { provider: "tracer" });
    }

    try {
      const { rowCount } = await this.#pool.query(
        `UPDATE errands
         SET status = $2, updated_at = now()
         WHERE errand_id = $1`,
        [errandId, outcome]
      );
      return { errandId, outcome, confirmed, updated: rowCount > 0 };
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError("unknown", `finishErrand failed: ${error.message}`, {
        provider: "tracer",
        errandId,
        cause: error
      });
    }
  }
}
