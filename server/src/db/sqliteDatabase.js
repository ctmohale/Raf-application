import Database from 'better-sqlite3';

function normalizeParam(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof value === 'boolean') return value ? 1 : 0;
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

function normalizeSql(sql) {
  return String(sql)
    .replace(/DATE_FORMAT\(\s*([^,]+),\s*'%Y-%m'\s*\)/gi, "strftime('%Y-%m', $1)")
    .replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE/gi, 'ON CONFLICT DO UPDATE SET')
    .replace(/VALUES\(\s*(`?\w+`?)\s*\)/gi, 'excluded.$1')
    .replace(/datetime\(([^)]+)\)/gi, 'datetime($1)');
}

function normalizeSchema(sql) {
  return normalizeSql(sql)
    .replace(/^\s*INDEX\s+[^\n]+,?\s*$/gim, '')
    .replace(/UNIQUE\s+KEY\s+\w+\s*\(([^)]+)\)/gi, 'UNIQUE ($1)')
    .replace(/\bBIGINT\s+UNSIGNED\b/gi, 'INTEGER')
    .replace(/\bBIGINT\b/gi, 'INTEGER')
    .replace(/\bTINYINT\s*\(\s*1\s*\)/gi, 'INTEGER')
    .replace(/\bDOUBLE\b/gi, 'REAL')
    .replace(/\bDECIMAL\s*\([^)]*\)/gi, 'REAL')
    .replace(/\bVARCHAR\s*\([^)]*\)/gi, 'TEXT')
    .replace(/\bLONGTEXT\b/gi, 'TEXT')
    .replace(/\bDATETIME\b/gi, 'TEXT')
    .replace(/\bDATE\b/gi, 'TEXT')
    .replace(/\bINT\b/gi, 'INTEGER')
    .replace(/\bENUM\s*\([^)]*\)/gi, 'TEXT')
    .replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTO_INCREMENT/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/,\s*\)/g, '\n  )');
}

class SqliteStatement {
  constructor(database, sql) {
    this.statement = database.connection.prepare(normalizeSql(sql));
  }

  async all(...params) {
    const normalized = normalizeParams(params);
    return Array.isArray(normalized) ? this.statement.all(...normalized) : this.statement.all(normalized);
  }

  async get(...params) {
    const normalized = normalizeParams(params);
    return Array.isArray(normalized) ? this.statement.get(...normalized) : this.statement.get(normalized);
  }

  async run(...params) {
    const normalized = normalizeParams(params);
    const result = Array.isArray(normalized) ? this.statement.run(...normalized) : this.statement.run(normalized);
    return {
      lastInsertRowid: result.lastInsertRowid,
      changes: result.changes
    };
  }
}

export class SqliteDatabase {
  constructor(filename, { close = true } = {}) {
    this.shouldClose = close;
    this.connection = new Database(filename);
    this.connection.pragma('journal_mode = WAL');
    this.connection.pragma('foreign_keys = ON');
  }

  prepare(sql) {
    return new SqliteStatement(this, sql);
  }

  async exec(sql) {
    return this.connection.exec(normalizeSchema(sql));
  }

  transaction(callback) {
    return async (...args) => {
      this.connection.exec('BEGIN IMMEDIATE');
      try {
        const result = await callback(...args);
        this.connection.exec('COMMIT');
        return result;
      } catch (error) {
        this.connection.exec('ROLLBACK');
        throw error;
      }
    };
  }

  async close(force = false) {
    if ((this.shouldClose || force) && this.connection.open) this.connection.close();
  }
}
