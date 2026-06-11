/**
 * @typedef {Object} Fact
 * @property {string} userId
 * @property {string} kind
 * @property {string} text
 * @property {object} [meta]
 * @property {string} [errandId]
 *
 * @typedef {Object} Recall
 * @property {Fact} fact
 * @property {number} score
 */
export class MemoryStore {
  /** @param {Fact} fact @returns {Promise<{id:string}>} */
  async write(fact) {
    throw new Error("MemoryStore.write must be implemented by an adapter.");
  }

  /** @param {string} userId @param {string} query @param {number} [k=5] @returns {Promise<Recall[]>} */
  async recall(userId, query, k = 5) {
    throw new Error("MemoryStore.recall must be implemented by an adapter.");
  }
}
