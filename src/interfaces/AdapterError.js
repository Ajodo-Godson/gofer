export class AdapterError extends Error {
  /**
   * @param {"unavailable"|"auth"|"blocked"|"invalid"|"timeout"|"unknown"} kind
   * @param {string} message
   * @param {{ provider?: string, errandId?: string, cause?: unknown }} [options]
   */
  constructor(kind, message, { provider, errandId, cause } = {}) {
    super(message, { cause });
    this.name = "AdapterError";
    this.kind = kind;
    this.provider = provider || null;
    this.errandId = errandId || null;
  }
}

export const ADAPTER_ERROR_KINDS = Object.freeze([
  "unavailable",
  "auth",
  "blocked",
  "invalid",
  "timeout",
  "unknown"
]);
