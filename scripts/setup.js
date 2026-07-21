import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const envPath = path.join(projectRoot, '.env');
const examplePath = path.join(projectRoot, '.env.example');

if (fs.existsSync(envPath)) {
  console.log('.env already exists; no settings were overwritten.');
} else {
  const secret = crypto.randomBytes(32).toString('hex');
  const contents = fs
    .readFileSync(examplePath, 'utf8')
    .replace('change-me-to-a-long-random-secret', secret);
  fs.writeFileSync(envPath, contents, { mode: 0o600 });
  console.log('Created .env with a random JWT secret.');
}

for (const directory of [
  'server/data/firms',
  'server/uploads/originals',
  'server/uploads/generated',
  'server/uploads/spreadsheets',
  'server/uploads/client-documents'
]) {
  fs.mkdirSync(path.join(projectRoot, directory), { recursive: true });
}

console.log('Local storage directories are ready.');
