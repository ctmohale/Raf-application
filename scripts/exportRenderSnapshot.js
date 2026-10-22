import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { db, initializeDatabase } from '../server/src/db/db.js';
import { uploadsDir } from '../server/src/config.js';
import { closeFirmDatabases, openFirmDatabase } from '../server/src/services/firmDatabases.js';

const gzip = promisify(zlib.gzip);
const outputPath = path.resolve(process.argv[2] || '/private/tmp/orc-render-snapshot.json.gz');

const centralTables = [
  'users', 'firms', 'app_settings', 'user_settings', 'user_firm_access',
  'firm_user_notifications', 'document_templates', 'template_fields',
  'field_mappings', 'generated_documents', 'api_keys', 'firm_messages', 'activity_logs'
];

const firmTables = [
  'firm_profile', 'users', 'document_templates', 'template_fields', 'field_mappings',
  'generated_documents', 'api_keys', 'firm_clients', 'raf_cases', 'matters',
  'client_document_requests', 'client_uploads', 'client_email_logs',
  'claim_form_templates', 'medical_assessment_requests', 'firm_doctors',
  'matter_assignment_history', 'firm_schema_migrations'
];

async function exportTables(database, names) {
  const result = {};
  for (const name of names) result[name] = await database.prepare(`SELECT * FROM \`${name}\``).all();
  return result;
}

async function walkFiles(directory, root = directory) {
  const result = [];
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return result;
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(fullPath, root));
    else if (entry.isFile() && entry.name !== '.gitkeep') {
      result.push({
        path: path.relative(root, fullPath),
        data: (await fs.readFile(fullPath)).toString('base64')
      });
    }
  }
  return result;
}

try {
  await initializeDatabase({ retries: 1 });
  const central = await exportTables(db, centralTables);
  const firms = [];
  for (const firm of central.firms) {
    const firmDb = await openFirmDatabase(firm);
    firms.push({ firmId: firm.id, tables: await exportTables(firmDb, firmTables) });
  }
  const files = await walkFiles(uploadsDir);
  const snapshot = {
    format: 'orc-render-snapshot-v1',
    exportedAt: new Date().toISOString(),
    central,
    firms,
    files
  };
  const compressed = await gzip(Buffer.from(JSON.stringify(snapshot)), { level: 9 });
  await fs.writeFile(outputPath, compressed, { mode: 0o600 });
  console.log(JSON.stringify({
    outputPath,
    compressedBytes: compressed.length,
    centralRecords: Object.values(central).reduce((sum, rows) => sum + rows.length, 0),
    firms: firms.length,
    files: files.length
  }));
} finally {
  await closeFirmDatabases();
  await db.close();
}
