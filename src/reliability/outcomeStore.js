import { AdapterError } from "../interfaces/AdapterError.js";

/**
 * Creates an outcome store backed by a pg Pool.
 * @param {import('pg').Pool} pool
 */
export function createOutcomeStore(pool) {
  return new PgOutcomeStore(pool);
}

let _default = null;

export function getDefaultOutcomeStore() {
  if (!_default) {
    throw new AdapterError(
      "unavailable",
      "No default outcome store configured. Call setDefaultOutcomeStore(pool) first.",
      { provider: "outcomeStore" }
    );
  }
  return _default;
}

export function setDefaultOutcomeStore(pool) {
  _default = createOutcomeStore(pool);
}

class PgOutcomeStore {
  #pool;

  constructor(pool) {
    this.#pool = pool;
  }

  /**
   * Upserts the final outcome for an errand.
   * @param {string} errandId
   * @param {{ completed?: boolean, confirmed?: boolean, costCents?: number|null, channel?: string|null }} opts
   */
  async recordOutcome(errandId, { completed = false, confirmed = false, costCents = null, channel = null } = {}) {
    if (!errandId) {
      throw new AdapterError("invalid", "recordOutcome requires errandId.", {
        provider: "outcomeStore"
      });
    }

    try {
      await this.#pool.query(
        `INSERT INTO outcomes (errand_id, completed, confirmed, cost_cents, channel, recorded_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (errand_id)
         DO UPDATE SET
           completed   = EXCLUDED.completed,
           confirmed   = EXCLUDED.confirmed,
           cost_cents  = EXCLUDED.cost_cents,
           channel     = EXCLUDED.channel,
           recorded_at = now()`,
        [errandId, completed, confirmed, costCents, channel]
      );
      return { errandId, completed, confirmed, costCents, channel };
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError("unknown", `recordOutcome failed: ${error.message}`, {
        provider: "outcomeStore",
        errandId,
        cause: error
      });
    }
  }

  /**
   * Returns aggregate metrics over a recent time window.
   * @param {number} windowHours  How many hours back to look (default 24).
   * @param {{ channel?: string, confirmed?: boolean }} filter  Optional filters.
   * @returns {Promise<{ total: number, completed: number, confirmed: number, completionRate: number, confirmationRate: number }>}
   */
  async metrics(windowHours = 24, filter = {}) {
    const conditions = [`recorded_at >= now() - ($1 || ' hours')::interval`];
    const params = [String(windowHours)];

    if (filter.channel !== undefined) {
      params.push(filter.channel);
      conditions.push(`channel = $${params.length}`);
    }
    if (filter.confirmed !== undefined) {
      params.push(filter.confirmed);
      conditions.push(`confirmed = $${params.length}`);
    }

    const where = conditions.join(" AND ");

    try {
      const { rows } = await this.#pool.query(
        `SELECT
           COUNT(*)                           AS total,
           COUNT(*) FILTER (WHERE completed)  AS completed,
           COUNT(*) FILTER (WHERE confirmed)  AS confirmed
         FROM outcomes
         WHERE ${where}`,
        params
      );
      const row = rows[0];
      const total     = Number(row.total);
      const completed = Number(row.completed);
      const confirmed = Number(row.confirmed);
      return {
        total,
        completed,
        confirmed,
        completionRate:   total > 0 ? Number((completed / total).toFixed(4)) : 0,
        confirmationRate: total > 0 ? Number((confirmed / total).toFixed(4)) : 0
      };
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError("unknown", `metrics failed: ${error.message}`, {
        provider: "outcomeStore",
        cause: error
      });
    }
  }
}
