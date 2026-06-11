/**
 * Authorization — trust gate for every capability invocation.
 *
 * authorize(ctx): Promise<{ allowed: boolean, reason?: string }>
 * ctx = { userId, capability, errandId, actor }
 * capability: 'voice' | 'browser' | 'mail' | 'memory' | 'payments'
 *
 * Rules:
 *   - userId required for all capabilities
 *   - capability required for all calls
 *   - payments requires actor (the human approver) to be identified
 *   - all other capabilities: allowed when userId present
 *   - never throws — always returns { allowed, reason? }
 */

const VALID_CAPABILITIES = new Set(["voice", "browser", "mail", "memory", "payments"]);

class Authorization {
  /**
   * @param {{ userId?: string, capability?: string, errandId?: string, actor?: string }} ctx
   * @returns {Promise<{ allowed: boolean, reason?: string }>}
   */
  async authorize(ctx = {}) {
    try {
      const { userId, capability, actor } = ctx;

      if (!userId) {
        return { allowed: false, reason: "missing userId" };
      }

      if (!capability) {
        return { allowed: false, reason: "missing capability" };
      }

      if (capability === "payments" && !actor) {
        return { allowed: false, reason: "payments capability requires actor" };
      }

      return { allowed: true };
    } catch (_err) {
      // Never throw — internal failures return denied with generic reason.
      return { allowed: false, reason: "internal authorization error" };
    }
  }
}

/**
 * Factory — creates a fresh Authorization instance.
 * @returns {{ authorize: (ctx: object) => Promise<{ allowed: boolean, reason?: string }> }}
 */
export function createAuthorization() {
  return new Authorization();
}

let _default = null;

/**
 * Returns the module-level default authorization instance.
 * Creates one lazily if not yet configured.
 * @returns {Promise<Authorization>}
 */
export async function getDefaultAuthorization() {
  if (!_default) {
    _default = createAuthorization();
  }
  return _default;
}
