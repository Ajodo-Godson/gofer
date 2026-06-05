/**
 * @typedef {Object} CallRequest
 * @property {string} toNumber
 * @property {string} objective
 * @property {object} [context]
 * @property {string} errandId
 *
 * @typedef {Object} CallHandle
 * @property {string} callId
 * @property {"queued"|"in_progress"|"completed"|"failed"} status
 *
 * @typedef {Object} CallResult
 * @property {string} callId
 * @property {"completed"|"failed"|"no_answer"|"voicemail"} outcome
 * @property {string} transcript
 * @property {object} [structured]
 */
export class VoiceCaller {
  /** @param {CallRequest} req @returns {Promise<CallHandle>} */
  async call(req) {
    throw new Error("VoiceCaller.call must be implemented by an adapter.");
  }

  /** @param {string} callId @returns {Promise<CallResult>} */
  async result(callId) {
    throw new Error("VoiceCaller.result must be implemented by an adapter.");
  }
}
