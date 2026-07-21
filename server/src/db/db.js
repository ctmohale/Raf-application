import mysql from 'mysql2/promise';
import { config } from '../config.js';
import { centralSchema } from './centralSchema.js';
import { MySqlDatabase } from './mysqlDatabase.js';
function mysqlOptions(database = config.mysqlDatabase, usePool = true) {
  let base;
  if (config.mysqlUrl) {
    const url = new URL(config.mysqlUrl);
    base = {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: database || decodeURIComponent(url.pathname.replace(/^\//, ''))
    };
  } else {
    base = {
      host: config.mysqlHost,
      port: config.mysqlPort,
      user: config.mysqlUser,
      password: config.mysqlPassword,
      database
    };
  }
  return {
    ...base,
    database,
    charset: 'utf8mb4',
    dateStrings: true,
    namedPlaceholders: true,
    multipleStatements: true,
    ...(usePool ? {
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    } : {}),
    ...(config.mysqlSsl ? {
      ssl: {}
    } : {})
  };
}
export const pool = mysql.createPool(mysqlOptions());
export const db = new MySqlDatabase(pool, {
  close: true
});
const retryableConnectionErrors = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR']);
export async function initializeDatabase({
  retries = Number(process.env.DB_CONNECT_RETRIES || 10)
} = {}) {
  for (let attempt = 1;; attempt += 1) {
    try {
      await db.exec(centralSchema);
      await db.prepare("UPDATE users SET role = 'staff' WHERE role = 'client'").run();
      await db.prepare("UPDATE users SET status = 'active' WHERE status IS NULL OR status = ''").run();
      await db.prepare(`
        UPDATE users
        SET approved_at = COALESCE(approved_at, created_at),
            updated_at = COALESCE(updated_at, created_at)
      `).run();
      return;
    } catch (error) {
      if (attempt >= retries || !retryableConnectionErrors.has(error.code)) throw error;
      const delayMs = Number(process.env.DB_CONNECT_RETRY_MS || 3000);
      console.warn(`MySQL is unavailable (${error.code}); retrying in ${delayMs}ms (${attempt}/${retries})`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
export function getMySqlOptions(database) {
  return mysqlOptions(database, false);
}
export function serializeField(row) {
  if (!row) return null;
  return {
    ...row,
    page_number: Number(row.page_number),
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    required: Boolean(row.required),
    options: row.options_json ? JSON.parse(row.options_json) : []
  };
}
export function serializeTemplate(row) {
  if (!row) return null;
  return {
    ...row,
    page_count: Number(row.page_count),
    field_count: Number(row.field_count || 0)
  };
}
export function serializeDocument(row) {
  if (!row) return null;
  return {
    ...row,
    row_number: row.row_number == null ? null : Number(row.row_number),
    input: row.input_json ? JSON.parse(row.input_json) : {}
  };
}
