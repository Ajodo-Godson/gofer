/**
 * Audit — append-only event log backed by the `audit` table.
 *
 * record(event: AuditEvent): Promise<void>
 *   AuditEvent = { errandId?, eventType, actor?, detail?: object }
 *   Writes one row to the audit table. Never updates or deletes rows.
 *
 * query(filter, limit=50): Promise<AuditEvent[]>
 *   filter = { errandId?, eventType?, since?: ISO date string }
 *   Returns rows ordered by ts DESC.
 *
 * Schema (from db/migrations/001_reliability.sql):
 *   audit(id bigserial, errand_id text NOT NULL, actor text, action text NOT NULL,
 *         payload jsonb, ts timestamptz)
 *
 * Note: eventType maps to the `action` column; detail maps to `payload`.
 *       errandId maps to `errand_id` (defaults to '' when absent).
 */

import { randomUUID } from "node:crypto";
import { AdapterError } from "../interfaces/AdapterError.js";

class Audit {
  #pool;

  constructor(pool) {
    this.#pool = pool;
  }

  /**
   * Appends one audit event row. Throws AdapterError('invalid') when eventType
   * is missing; wraps unexpected DB failures as AdapterError('unknown').
   *
   * @param {{ errandId?: string, eventType: string, actor?: string, detail?: object }} event
   * @returns {Promise<void>}
   */
  async record(event) {
    const {
      errandId = "",
      eventType,
      actor = null,
      detail = {}
    } = event || {};

    if (!eventType) {
      throw new AdapterError("invalid", "audit.record requires eventType.", {
        provider: "audit"
      });
    }

    // id is generated here for uniqueness guarantee; the DB bigserial also
    // provides a unique surrogate key but we expose a uuid for external refs.
    const id = randomUUID();

    try {
      await this.#pool.query(
        `INSERT INTO audit (errand_id, actor, action, payload, ts)
         VALUES ($1, $2, $3, $4, now())`,
        [errandId, actor || null, eventType, JSON.stringify(detail || {})]
      );
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError("unknown", `audit.record failed: ${error.message}`, {
        provider: "audit",
        errandId,
        cause: error
      });
    }

    // Suppress id from callers — the record is write-only by design.
    void id;
  }

  /**
   * Queries audit rows with optional filters.
   *
   * @param {{ errandId?: string, eventType?: string, since?: string }} filter
   * @param {number} [limit=50]
   * @returns {Promise<Array<{ errandId: string, eventType: string, actor: string|null, detail: object, ts: string }>>}
   */
  async query(filter = {}, limit = 50) {
    const { errandId, eventType, since } = filter;

    const conditions = [];
    const params = [];

    if (errandId !== undefined) {
      params.push(errandId);
      conditions.push(`errand_id = $${params.length}`);
    }

    if (eventType !== undefined) {
      params.push(eventType);
      conditions.push(`action = $${params.length}`);
    }

    if (since !== undefined) {
      params.push(since);
      conditions.push(`ts >= $${params.length}::timestamptz`);
    }

    params.push(limit);
    const limitParam = `$${params.length}`;

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    try {
      const { rows } = await this.#pool.query(
        `SELECT errand_id, actor, action, payload, ts
         FROM audit
         ${where}
         ORDER BY ts DESC
         LIMIT ${limitParam}`,
        params
      );

      return rows.map((row) => ({
        errandId: row.errand_id,
        eventType: row.action,
        actor: row.actor || null,
        detail: row.payload || {},
        ts: row.ts
      }));
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError("unknown", `audit.query failed: ${error.message}`, {
        provider: "audit",
        cause: error
      });
    }
  }
}

// ── exports ───────────────────────────────────────────────────────────────────

/**
 * Factory — creates an Audit instance backed by the given pg Pool.
 * @param {import('pg').Pool} pool
 */
export function createAudit(pool) {
  return new Audit(pool);
}

let _default = null;

/**
 * Returns the module-level default Audit instance.
 * Requires a pool to be provided on first call.
 * @param {import('pg').Pool} [pool]
 */
export async function getDefaultAudit(pool) {
  if (!_default) {
    if (!pool) {
      throw new AdapterError(
        "unavailable",
        "No default audit configured. Pass a pool to getDefaultAudit(pool) first.",
        { provider: "audit" }
      );
    }
    _default = createAudit(pool);
  }
  return _default;
}
