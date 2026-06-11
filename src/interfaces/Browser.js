/**
 * @typedef {Object} ActRequest
 * @property {string} prompt
 * @property {object} [schema]
 * @property {string} [profileId]
 * @property {string} errandId
 *
 * @typedef {Object} ActResult
 * @property {boolean} success
 * @property {object} [data]
 * @property {string[]} [artifacts]
 * @property {"login_required"|"captcha"|"not_found"|null} blocker
 */
export class Browser {
  /** @param {ActRequest} req @returns {Promise<ActResult>} */
  async act(req) {
    throw new Error("Browser.act must be implemented by an adapter.");
  }

  /** @param {string} profileId @returns {Promise<{sessionId:string}>} */
  async authSession(profileId) {
    throw new Error("Browser.authSession must be implemented by an adapter.");
  }
}
