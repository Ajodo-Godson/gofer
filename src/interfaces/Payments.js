/**
 * @typedef {Object} PaymentIntentReq
 * @property {string} userId
 * @property {number} amountCents
 * @property {string} currency
 * @property {string} description
 * @property {string} errandId
 *
 * @typedef {Object} PreparedPayment
 * @property {string} intentId
 * @property {number} amountCents
 * @property {string} description
 * @property {"requires_approval"} status
 */
export class Payments {
  /** @param {PaymentIntentReq} req @returns {Promise<PreparedPayment>} */
  async prepare(req) {
    throw new Error("Payments.prepare must be implemented by an adapter.");
  }

  /** @param {string} intentId @param {string} approvalToken @returns {Promise<{receiptId:string}>} */
  async charge(intentId, approvalToken) {
    throw new Error("Payments.charge must be implemented by an adapter.");
  }
}
