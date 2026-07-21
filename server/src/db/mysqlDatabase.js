import { AsyncLocalStorage } from 'node:async_hooks';

const transactionConnections = new AsyncLocalStorage();

function normalizeParam(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    return value.slice(0, 19).replace('T', ' ');
  }
  return value;
}

function normalizeParams(params) {
  if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) && !(params[0] instanceof Date)) {
    return Object.fromEntries(Object.entries(params[0]).map(([key, value]) => [key, normalizeParam(value)]));
  }
  return params.map(normalizeParam);
}

export function normalizeSql(sql) {
  return String(sql)
    .replace(/\s+COLLATE\s+NOCASE/gi, '')
    .replace(/datetime\(([^)]+)\)/gi, '$1')
    .replace(/strftime\(\s*'%Y-%m'\s*,\s*([^)]+)\)/gi, "DATE_FORMAT($1, '%Y-%m')");
}

class MySqlStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = normalizeSql(sql);
  }

  async all(...params) {
    const [rows] = await this.database.executor().execute(this.sql, normalizeParams(params));
    return rows;
  }

  async get(...params) {
    const rows = await this.all(...params);
    return rows[0];
  }

  async run(...params) {
    const [result] = await this.database.executor().execute(this.sql, normalizeParams(params));
    return {
      lastInsertRowid: result.insertId,
      changes: result.affectedRows
    };
  }
}

export class MySqlDatabase {
  constructor(executor, { close = false } = {}) {
    this.baseExecutor = executor;
    this.shouldClose = close;
  }

  executor() {
    return transactionConnections.getStore()?.get(this) || this.baseExecutor;
  }

  prepare(sql) {
    return new MySqlStatement(this, sql);
  }

  async exec(sql) {
    const [result] = await this.executor().query(normalizeSql(sql));
    return result;
  }

  transaction(callback) {
    return async (...args) => {
      const pooled = typeof this.baseExecutor.getConnection === 'function';
      const connection = pooled ? await this.baseExecutor.getConnection() : this.baseExecutor;
      const parent = transactionConnections.getStore() || new Map();
      const context = new Map(parent);
      context.set(this, connection);

      try {
        await connection.beginTransaction();
        const result = await transactionConnections.run(context, () => callback(...args));
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        if (pooled) connection.release();
      }
    };
  }

  async close() {
    if (this.shouldClose) await this.baseExecutor.end();
  }
}
