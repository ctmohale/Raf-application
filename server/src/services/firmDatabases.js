import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { clientUploadsDir, config } from '../config.js';
import { pool, getMySqlOptions } from '../db/db.js';
import { firmSchema } from '../db/firmSchema.js';
import { MySqlDatabase } from '../db/mysqlDatabase.js';
import { SqliteDatabase } from '../db/sqliteDatabase.js';
export const coreClientDocumentRequests = Object.freeze([['claimant_id', 'ID / Passport', 'Certified identity document.'], ['police_accident_report', 'Police Report', 'Police accident records.'], ['client_accident_affidavit', 'Accident Affidavit', 'Signed accident statement.'], ['medical_documents', 'Medical Records', 'Treatment and medical records.'], ['medical_expenses', 'Medical Bills', 'Invoices and payment proof.'], ['employment_income', 'Employment & Income', 'Income and work records.'], ['banking_proof', 'Banking Proof', 'Bank letter or statement.'], ['photographs', 'Photos', 'Injury and accident photos.']]);
const initializedFirmDatabases = new Set();
const firmPools = new Map();
export function slugifyFirmName(name) {
  const slug = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'firm';
}
export function getFirmDatabaseName(databaseFilename) {
  const sourceName = String(databaseFilename || 'firm');
  const base = String(config.mysqlDatabase || 'orc').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 22);
  const suffix = sourceName.replace(/\.db$/i, '').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24);
  const hash = createHash('sha256').update(sourceName).digest('hex').slice(0, 8);
  return `${base}__firm_${suffix}_${hash}`;
}
function quoteIdentifier(identifier) {
  return `\`${String(identifier).replace(/`/g, '``')}\``;
}
async function prepareFirmDatabase(firm, {
  forceInitialize = false
} = {}) {
  const databaseName = getFirmDatabaseName(firm.database_filename);
  const needsInitialization = forceInitialize || !initializedFirmDatabases.has(databaseName);
  if (needsInitialization && config.databaseDriver === 'mysql') {
    await pool.query(`CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  }
  let firmPool = firmPools.get(databaseName);
  if (!firmPool) {
    if (config.databaseDriver === 'mysql') {
      firmPool = mysql.createPool({
        ...getMySqlOptions(databaseName),
        waitForConnections: true,
        connectionLimit: Number(process.env.MYSQL_FIRM_POOL_SIZE || 3),
        queueLimit: 0
      });
    } else {
      const firmsDir = path.join(config.sqliteDataDir, 'firms');
      fs.mkdirSync(firmsDir, { recursive: true });
      firmPool = new SqliteDatabase(path.join(firmsDir, `${databaseName}.db`), { close: false });
    }
    firmPools.set(databaseName, firmPool);
  }
  const firmDb = config.databaseDriver === 'mysql' ? new MySqlDatabase(firmPool) : firmPool;
  if (needsInitialization) {
    await firmDb.exec(firmSchema);
    const profileUpsert = config.databaseDriver === 'mysql' ? `
        ON DUPLICATE KEY UPDATE
          central_firm_id = VALUES(central_firm_id), name = VALUES(name), slug = VALUES(slug),
          contact_name = VALUES(contact_name), contact_email = VALUES(contact_email),
          contact_phone = VALUES(contact_phone), address = VALUES(address), updated_at = CURRENT_TIMESTAMP
      ` : `
        ON CONFLICT(id) DO UPDATE SET
          central_firm_id = excluded.central_firm_id, name = excluded.name, slug = excluded.slug,
          contact_name = excluded.contact_name, contact_email = excluded.contact_email,
          contact_phone = excluded.contact_phone, address = excluded.address, updated_at = CURRENT_TIMESTAMP
      `;
    await firmDb.prepare(`
      INSERT INTO firm_profile
        (id, central_firm_id, name, slug, contact_name, contact_email, contact_phone, address)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ${profileUpsert}
    `).run(firm.id, firm.name, firm.slug, firm.contact_name || null, firm.contact_email || null, firm.contact_phone || null, firm.address || null);
    const firmUploadDir = path.join(clientUploadsDir, firm.slug);
    fs.mkdirSync(firmUploadDir, {
      recursive: true
    });
    const flatUploads = (await firmDb.prepare('SELECT id, stored_filename FROM client_uploads').all()).filter(upload => path.basename(upload.stored_filename) === upload.stored_filename);
    const updateStoredFilename = firmDb.prepare('UPDATE client_uploads SET stored_filename = ? WHERE id = ?');
    for (const upload of flatUploads) {
      const firmStoredFilename = path.join(firm.slug, upload.stored_filename);
      const currentPath = path.join(clientUploadsDir, upload.stored_filename);
      const firmPath = path.join(clientUploadsDir, firmStoredFilename);
      if (fs.existsSync(currentPath) && !fs.existsSync(firmPath)) fs.renameSync(currentPath, firmPath);
      if (fs.existsSync(firmPath)) await updateStoredFilename.run(firmStoredFilename, upload.id);
    }
    initializedFirmDatabases.add(databaseName);
  }
  return firmDb;
}
export async function openFirmDatabase(firm) {
  return await prepareFirmDatabase(firm);
}
export async function initializeFirmDatabase(firm) {
  await prepareFirmDatabase(firm, {
    forceInitialize: true
  });
}
export async function dropFirmDatabase(firm) {
  const databaseName = getFirmDatabaseName(firm.database_filename);
  const firmPool = firmPools.get(databaseName);
  if (firmPool) {
    if (config.databaseDriver === 'mysql') await firmPool.end();
    else await firmPool.close(true);
  }
  firmPools.delete(databaseName);
  if (config.databaseDriver === 'mysql') {
    await pool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  } else {
    const filename = path.join(config.sqliteDataDir, 'firms', `${databaseName}.db`);
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(`${filename}${suffix}`)) fs.unlinkSync(`${filename}${suffix}`);
    }
  }
  initializedFirmDatabases.delete(databaseName);
}
export async function closeFirmDatabases() {
  await Promise.all([...firmPools.values()].map(firmPool => config.databaseDriver === 'mysql' ? firmPool.end() : firmPool.close(true)));
  firmPools.clear();
}
