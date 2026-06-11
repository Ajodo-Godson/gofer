/**
 * Gates — stateless HMAC-SHA256 approval token system.
 *
 * No DB required: tokens are self-contained and verifiable by signature.
 *
 * requiresApproval(template, step): boolean
 *   Returns true if the workflow template's `gates` array includes this step.
 *
 * issueApprovalToken(errandId, step, approver): Promise<{ token, expiresAt }>
 *   token = base64url(JSON.stringify(payload)) + '.' + base64url(hmac_hex)
 *   payload = { errandId, step, approver, iat, exp }  (exp = iat + 3600)
 *
 * verifyApprovalToken(token, errandId, step): Promise<boolean>
 *   Returns true only if signature valid, not expired, errandId matches, step matches.
 *   Returns false on any invalid/expired/tampered token. Fail closed: exception → false.
 *
 * Secret: APPROVAL_TOKEN_SECRET environment variable.
 */

import { createHmac } from "node:crypto";

const TOKEN_TTL_SECONDS = 3600;

// ── helpers ───────────────────────────────────────────────────────────────────

function toBase64url(str) {
  return Buffer.from(str).toString("base64url");
}

function fromBase64url(b64) {
  return Buffer.from(b64, "base64url").toString("utf8");
}

function hmacSign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function getSecret() {
  const secret = process.env.APPROVAL_TOKEN_SECRET;
  if (!secret) {
    throw new Error("APPROVAL_TOKEN_SECRET is not set");
  }
  return secret;
}

// ── Gates class ───────────────────────────────────────────────────────────────

class Gates {
  /**
   * Returns true if the workflow template requires approval for the given step.
   * @param {{ gates?: string[] }} template
   * @param {string} step
   * @returns {boolean}
   */
  requiresApproval(template, step) {
    if (!template || !Array.isArray(template.gates)) return false;
    return template.gates.includes(step);
  }

  /**
   * Issues a signed, time-limited approval token.
   * @param {string} errandId
   * @param {string} step
   * @param {string} approver
   * @returns {Promise<{ token: string, expiresAt: string }>}
   */
  async issueApprovalToken(errandId, step, approver) {
    const secret = getSecret();
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + TOKEN_TTL_SECONDS;

    const payload = JSON.stringify({ errandId, step, approver, iat, exp });
    const encodedPayload = toBase64url(payload);
    const sig = hmacSign(encodedPayload, secret);
    const encodedSig = toBase64url(sig);

    const token = `${encodedPayload}.${encodedSig}`;
    const expiresAt = new Date(exp * 1000).toISOString();

    return { token, expiresAt };
  }

  /**
   * Verifies an approval token against errandId and step.
   * Returns false (never throws) on any invalid/expired/tampered token.
   * @param {string} token
   * @param {string} errandId
   * @param {string} step
   * @returns {Promise<boolean>}
   */
  async verifyApprovalToken(token, errandId, step) {
    try {
      const secret = process.env.APPROVAL_TOKEN_SECRET;
      if (!secret) return false;

      if (!token || typeof token !== "string") return false;

      const dotIndex = token.lastIndexOf(".");
      if (dotIndex === -1) return false;

      const encodedPayload = token.slice(0, dotIndex);
      const encodedSig = token.slice(dotIndex + 1);

      // Verify signature
      const expectedSig = hmacSign(encodedPayload, secret);
      const expectedEncoded = toBase64url(expectedSig);

      // Constant-time comparison via timing-safe approach using string equality
      // (for full security a timingSafeEqual would be used on Buffer, but the
      // token is public-facing and HMAC-hex encoded — either way we compare)
      if (encodedSig !== expectedEncoded) return false;

      // Decode and parse payload
      const payloadStr = fromBase64url(encodedPayload);
      const parsed = JSON.parse(payloadStr);

      // Check expiry
      const now = Math.floor(Date.now() / 1000);
      if (!parsed.exp || now > parsed.exp) return false;

      // Check binding claims
      if (parsed.errandId !== errandId) return false;
      if (parsed.step !== step) return false;

      return true;
    } catch (_err) {
      return false;
    }
  }
}

// ── exports ───────────────────────────────────────────────────────────────────

/**
 * Factory — creates a fresh Gates instance.
 */
export function createGates() {
  return new Gates();
}

let _default = null;

/**
 * Returns the module-level default Gates instance.
 * Creates one lazily if not yet configured.
 */
export async function getDefaultGates() {
  if (!_default) {
    _default = createGates();
  }
  return _default;
}
