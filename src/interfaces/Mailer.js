/**
 * @typedef {Object} OutboundMail
 * @property {string} to
 * @property {string} subject
 * @property {string} body
 * @property {string} [threadId]
 * @property {string} errandId
 *
 * @typedef {Object} InboundMail
 * @property {string} messageId
 * @property {string} from
 * @property {string} subject
 * @property {string} body
 * @property {string} threadId
 * @property {string} receivedAt
 */
export class Mailer {
  /** @param {OutboundMail} mail @returns {Promise<{messageId:string, threadId:string}>} */
  async send(mail) {
    throw new Error("Mailer.send must be implemented by an adapter.");
  }

  /** @param {string} threadId @returns {Promise<InboundMail[]>} */
  async poll(threadId) {
    throw new Error("Mailer.poll must be implemented by an adapter.");
  }
}
