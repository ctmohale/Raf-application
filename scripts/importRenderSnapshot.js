import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gunzip = promisify(zlib.gunzip);
const gzip = promisify(zlib.gzip);

const baseUrl = String(process.argv[2] || '').replace(/\/$/, '');
const snapshotPath = path.resolve(process.argv[3] || '/private/tmp/orc-render-snapshot.json.gz');
const email = process.env.SNAPSHOT_ADMIN_EMAIL || 'demo@example.com';
const password = process.env.SNAPSHOT_ADMIN_PASSWORD || 'password123';

if (!/^https?:\/\//.test(baseUrl)) {
  throw new Error('Usage: node scripts/importRenderSnapshot.js <base-url> [snapshot-path]');
}

const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password })
});
const login = await loginResponse.json();
if (!loginResponse.ok || !login.token) throw new Error(login.error || `Login failed (${loginResponse.status})`);

const snapshot = JSON.parse((await gunzip(await fs.readFile(snapshotPath))).toString('utf8'));
const files = Array.isArray(snapshot.files) ? snapshot.files : [];
snapshot.files = [];
const databaseSnapshot = await gzip(Buffer.from(JSON.stringify(snapshot)));
const importResponse = await fetch(`${baseUrl}/api/admin-import`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${login.token}`,
    'content-type': 'application/gzip'
  },
  body: databaseSnapshot
});
const result = await importResponse.json();
if (!importResponse.ok) throw new Error(result.error || `Import failed (${importResponse.status})`);

let uploadedFiles = 0;
let uploadedBytes = 0;
for (const file of files) {
  if (!file?.path || typeof file.data !== 'string') continue;
  const contents = Buffer.from(file.data, 'base64');
  const response = await fetch(`${baseUrl}/api/admin-import/file`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${login.token}`,
      'content-type': 'application/octet-stream',
      'x-snapshot-path': encodeURIComponent(file.path)
    },
    body: contents
  });
  const fileResult = await response.json();
  if (!response.ok) throw new Error(fileResult.error || `File import failed (${response.status}): ${file.path}`);
  uploadedFiles += 1;
  uploadedBytes += contents.length;
}

console.log(JSON.stringify({ ...result, files: uploadedFiles, fileBytes: uploadedBytes }));
