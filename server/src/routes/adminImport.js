import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import express from 'express';
import { promisify } from 'node:util';
import { config, uploadsDir } from '../config.js';
import { db } from '../db/db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { openFirmDatabase } from '../services/firmDatabases.js';

const gunzip = promisify(zlib.gunzip);

export const adminImportRouter = express.Router();

const centralInsertOrder = [
  'users', 'firms', 'app_settings', 'user_settings', 'user_firm_access',
  'firm_user_notifications', 'document_templates', 'template_fields',
  'field_mappings', 'generated_documents', 'api_keys', 'firm_messages', 'activity_logs'
];

const firmInsertOrder = [
  'firm_profile', 'users', 'document_templates', 'template_fields', 'field_mappings',
  'generated_documents', 'api_keys', 'firm_clients', 'raf_cases', 'matters',
  'client_document_requests', 'client_uploads', 'client_email_logs',
  'claim_form_templates', 'medical_assessment_requests', 'firm_doctors',
  'matter_assignment_history', 'firm_schema_migrations'
];

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

async function replaceTables(database, tables, insertOrder) {
  await database.exec('PRAGMA foreign_keys = OFF');
  try {
    await database.transaction(async () => {
      for (const table of [...insertOrder].reverse()) {
        await database.prepare(`DELETE FROM ${quoteIdentifier(table)}`).run();
      }
      for (const table of insertOrder) {
        const rows = Array.isArray(tables?.[table]) ? tables[table] : [];
        for (const row of rows) {
          const columns = Object.keys(row);
          if (!columns.length) continue;
          const placeholders = columns.map(() => '?').join(', ');
          const sql = `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`;
          await database.prepare(sql).run(...columns.map(column => row[column]));
        }
      }
    })();
  } finally {
    await database.exec('PRAGMA foreign_keys = ON');
  }
}

async function restoreFiles(files) {
  const root = path.resolve(uploadsDir);
  let restored = 0;
  for (const file of files || []) {
    if (!file?.path || typeof file.data !== 'string') continue;
    const destination = path.resolve(root, file.path);
    if (!destination.startsWith(`${root}${path.sep}`)) throw new Error(`Invalid snapshot file path: ${file.path}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, Buffer.from(file.data, 'base64'));
    restored += 1;
  }
  return restored;
}

async function restoreFile(relativePath, contents) {
  if (!relativePath) throw new Error('A snapshot file path is required');
  const root = path.resolve(uploadsDir);
  const destination = path.resolve(root, relativePath);
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error(`Invalid snapshot file path: ${relativePath}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, contents);
}

adminImportRouter.post(
  '/file',
  authenticate,
  requireAdmin,
  express.raw({ type: 'application/octet-stream', limit: '100mb' }),
  async (req, res) => {
    if (config.databaseDriver !== 'sqlite') {
      return res.status(400).json({ error: 'Snapshot import is only available for the SQLite deployment' });
    }
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'A binary file body is required' });
    const relativePath = decodeURIComponent(String(req.get('x-snapshot-path') || ''));
    await restoreFile(relativePath, req.body);
    return res.json({ imported: true, path: relativePath, bytes: req.body.length });
  }
);

adminImportRouter.post(
  '/',
  authenticate,
  requireAdmin,
  express.raw({ type: ['application/gzip', 'application/octet-stream'], limit: '100mb' }),
  async (req, res) => {
    if (config.databaseDriver !== 'sqlite') {
      return res.status(400).json({ error: 'Snapshot import is only available for the SQLite deployment' });
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'A gzip snapshot body is required' });
    }

    const snapshot = JSON.parse((await gunzip(req.body)).toString('utf8'));
    if (snapshot?.format !== 'orc-render-snapshot-v1') {
      return res.status(400).json({ error: 'Unsupported snapshot format' });
    }

    await replaceTables(db, snapshot.central, centralInsertOrder);

    let firmRecords = 0;
    for (const tenant of snapshot.firms || []) {
      const firm = await db.prepare('SELECT * FROM firms WHERE id = ?').get(tenant.firmId);
      if (!firm) continue;
      const firmDb = await openFirmDatabase(firm);
      await replaceTables(firmDb, tenant.tables, firmInsertOrder);
      firmRecords += Object.values(tenant.tables || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
    }

    const restoredFiles = await restoreFiles(snapshot.files);
    return res.json({
      imported: true,
      centralRecords: Object.values(snapshot.central || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0),
      firmRecords,
      firms: snapshot.firms?.length || 0,
      files: restoredFiles
    });
  }
);
