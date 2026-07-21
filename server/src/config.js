import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import dotenv from 'dotenv';
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const serverRoot = path.resolve(__dirname, '..');
export const projectRoot = path.resolve(serverRoot, '..');
export const uploadsDir = path.resolve(process.env.UPLOADS_DIR || path.join(serverRoot, 'uploads'));
export const originalsDir = path.join(uploadsDir, 'originals');
export const generatedDir = path.join(uploadsDir, 'generated');
export const spreadsheetsDir = path.join(uploadsDir, 'spreadsheets');
export const clientUploadsDir = path.join(uploadsDir, 'client-documents');
export const clientDistDir = path.join(projectRoot, 'client', 'dist');
export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 25),
  billingRatePerApplication: Number(process.env.BILLING_RATE_PER_APPLICATION || 500),
  powerMailBaseUrl: process.env.POWERMAIL_BASE_URL || 'https://powermail.beestack.co.za/api',
  powerMailApiKey: process.env.POWERMAIL_API_KEY || '',
  powerMailFromEmail: process.env.POWERMAIL_FROM_EMAIL || '',
  powerMailTemplateKey: process.env.POWERMAIL_TEMPLATE_KEY || '',
  openAiApiKey: process.env.OPENAI_API_KEY || '',
  aiExtractionModel: process.env.AI_EXTRACTION_MODEL || 'gpt-5-nano',
  mysqlUrl: process.env.MYSQL_URL || '',
  mysqlHost: process.env.MYSQLHOST || process.env.MYSQL_HOST || '127.0.0.1',
  mysqlPort: Number(process.env.MYSQLPORT || process.env.MYSQL_PORT || 3306),
  mysqlUser: process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
  mysqlPassword: process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || '',
  mysqlDatabase: process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || (process.env.MYSQL_URL ? decodeURIComponent(new URL(process.env.MYSQL_URL).pathname.replace(/^\//, '')) : 'orc_document_automation'),
  mysqlSsl: process.env.MYSQL_SSL === 'true'
};
const unsafeJwtSecrets = new Set(['', 'dev-only-change-me', 'change-me-to-a-long-random-secret']);
if (process.env.NODE_ENV === 'production' && unsafeJwtSecrets.has(config.jwtSecret)) {
  throw new Error('JWT_SECRET must be set to a long random value in production');
}
if (process.env.NODE_ENV === 'production' && !config.mysqlUrl && !process.env.MYSQLHOST && !process.env.MYSQL_HOST) {
  throw new Error('MYSQL_URL (or MYSQLHOST connection settings) must be configured in production');
}
for (const dir of [uploadsDir, originalsDir, generatedDir, spreadsheetsDir, clientUploadsDir]) {
  fs.mkdirSync(dir, {
    recursive: true
  });
}
export function resolveInside(baseDir, storedFileName) {
  const resolved = path.resolve(baseDir, storedFileName);
  if (!resolved.startsWith(path.resolve(baseDir))) {
    throw new Error('Invalid file path');
  }
  return resolved;
}
