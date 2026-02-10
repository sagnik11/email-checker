const { PostgresStorage } = require("./postgres");

class NoopStorage {
  async connect() {}

  async close() {}

  getExtra() {
    return null;
  }

  async store() {}

  async createV0BulkJob() {
    throw new Error("Postgres storage is required for bulk endpoints.");
  }

  async createV1BulkJob() {
    throw new Error("Postgres storage is required for bulk endpoints.");
  }

  async getV0BulkProgress() {
    return null;
  }

  async getV1BulkProgress() {
    return null;
  }

  async getV0Results() {
    return [];
  }

  async getV1Results() {
    return [];
  }

  async getV0BulkJob() {
    return null;
  }

  async getV1BulkJob() {
    return null;
  }

  async countV0Processed() {
    return 0;
  }

  async countV1Processed() {
    return 0;
  }
}

async function createStorage(config) {
  if (config.storage?.type === "postgres") {
    const storage = new PostgresStorage(config.storage.db_url, config.storage.extra || null);
    await storage.connect();
    return storage;
  }

  return new NoopStorage();
}

module.exports = {
  NoopStorage,
  createStorage,
};
