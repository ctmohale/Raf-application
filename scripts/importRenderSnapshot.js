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
  let imported = false;
  let lastError = '';
  for (let attempt = 1; attempt <= 5 && !imported; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/admin-import/file`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${login.token}`,
        'content-type': 'application/octet-stream',
        'x-snapshot-path': encodeURIComponent(file.path)
      },
      body: contents
    });
    const responseText = await response.text();
    let fileResult = {};
    try {
      fileResult = responseText ? JSON.parse(responseText) : {};
    } catch {
      // Preserve the status and file path in the error below when a proxy returns HTML.
    }
    imported = response.ok && fileResult.imported;
    lastError = fileResult.error || `File import failed (${response.status}): ${file.path}${responseText ? ` - ${responseText.slice(0, 120)}` : ''}`;
    if (!imported && attempt < 5 && [429, 502, 503, 504].includes(response.status)) {
      await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    } else if (!imported) {
      break;
    }
  }
  if (!imported) throw new Error(lastError);
  uploadedFiles += 1;
  uploadedBytes += contents.length;
  await new Promise(resolve => setTimeout(resolve, 500));
}

console.log(JSON.stringify({ ...result, files: uploadedFiles, fileBytes: uploadedBytes }));
