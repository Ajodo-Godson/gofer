import { AdapterError } from "../interfaces/AdapterError.js";

/**
 * Creates a provider-memory store backed by a pg Pool.
 * @param {import('pg').Pool} pool
 */
export function createProviderMemory(pool) {
  return new PgProviderMemory(pool);
}

let _default = null;

export function getDefaultProviderMemory() {
  if (!_default) {
    throw new AdapterError(
      "unavailable",
      "No default provider memory configured. Call setDefaultProviderMemory(pool) first.",
      { provider: "providerMemory" }
    );
  }
  return _default;
}

export function setDefaultProviderMemory(pool) {
  _default = createProviderMemory(pool);
}

class PgProviderMemory {
  #pool;

  constructor(pool) {
    this.#pool = pool;
  }

  /**
   * Loads the stored profile for a provider key, or {} if none.
   * @param {string} providerKey
   * @returns {Promise<object>}
   */
  async recallProvider(providerKey) {
    if (!providerKey) {
      throw new AdapterError("invalid", "recallProvider requires providerKey.", {
        provider: "providerMemory"
      });
    }

    try {
      const { rows } = await this.#pool.query(
        `SELECT profile FROM provider_memory WHERE provider_key = $1`,
        [providerKey]
      );
      return rows.length > 0 ? rows[0].profile : {};
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError("unknown", `recallProvider failed: ${error.message}`, {
        provider: "providerMemory",
        cause: error
      });
    }
  }

  /**
   * Merges delta into the stored profile using Object.assign (shallow merge).
   * Upserts the row so missing providers are created automatically.
   * @param {string} providerKey
   * @param {object} delta  Fields to merge into the existing profile.
   * @returns {Promise<object>}  The resulting merged profile.
   */
  async updateProvider(providerKey, delta) {
    if (!providerKey) {
      throw new AdapterError("invalid", "updateProvider requires providerKey.", {
        provider: "providerMemory"
      });
    }
    if (!delta || typeof delta !== "object" || Array.isArray(delta)) {
      throw new AdapterError("invalid", "updateProvider requires a plain object delta.", {
        provider: "providerMemory"
      });
    }

    try {
      // Read current profile, merge, write back.
      const existing = await this.recallProvider(providerKey);
      const merged = Object.assign({}, existing, delta);

      await this.#pool.query(
        `INSERT INTO provider_memory (provider_key, profile, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (provider_key)
         DO UPDATE SET profile = $2, updated_at = now()`,
        [providerKey, JSON.stringify(merged)]
      );

      return merged;
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError("unknown", `updateProvider failed: ${error.message}`, {
        provider: "providerMemory",
        cause: error
      });
    }
  }
}
