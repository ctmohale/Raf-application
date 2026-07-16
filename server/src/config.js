import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const serverRoot = path.resolve(__dirname, '..');
export const projectRoot = path.resolve(serverRoot, '..');
export const dataDir = path.join(serverRoot, 'data');
export const firmsDir = path.join(dataDir, 'firms');
export const uploadsDir = path.join(serverRoot, 'uploads');
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
  aiExtractionModel: process.env.AI_EXTRACTION_MODEL || 'gpt-5-nano'
};

for (const dir of [dataDir, firmsDir, uploadsDir, originalsDir, generatedDir, spreadsheetsDir, clientUploadsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

export function resolveInside(baseDir, storedFileName) {
  const resolved = path.resolve(baseDir, storedFileName);
  if (!resolved.startsWith(path.resolve(baseDir))) {
    throw new Error('Invalid file path');
  }
  return resolved;
}
