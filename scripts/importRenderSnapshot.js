import fs from 'node:fs/promises';
import path from 'node:path';

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

const snapshot = await fs.readFile(snapshotPath);
const importResponse = await fetch(`${baseUrl}/api/admin-import`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${login.token}`,
    'content-type': 'application/gzip'
  },
  body: snapshot
});
const result = await importResponse.json();
if (!importResponse.ok) throw new Error(result.error || `Import failed (${importResponse.status})`);
console.log(JSON.stringify(result));
