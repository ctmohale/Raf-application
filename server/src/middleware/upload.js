import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { clientUploadsDir, config, originalsDir, spreadsheetsDir } from '../config.js';
import { db } from '../db/db.js';
import { openFirmDatabase } from '../services/firmDatabases.js';

function diskStorageFor(destination) {
  return multer.diskStorage({
    destination,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, `${randomUUID()}${ext}`);
    }
  });
}

function uploadError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function findFirmForClientUpload(req) {
  if (req.params.id) {
    return db.prepare('SELECT * FROM firms WHERE id = ? OR slug = ?').get(req.params.id, req.params.id);
  }

  if (!req.params.token) return null;
  const firms = db.prepare("SELECT * FROM firms WHERE status = 'active'").all();

  for (const firm of firms) {
    const firmDb = openFirmDatabase(firm);
    try {
      const client = firmDb.prepare('SELECT id FROM firm_clients WHERE invite_token = ?').get(req.params.token);
      if (client) return firm;
    } finally {
      firmDb.close();
    }
  }

  return null;
}

const clientDocumentStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      const firm = findFirmForClientUpload(req);
      if (!firm) return cb(uploadError('Firm not found for document upload', 404));

      const destination = path.join(clientUploadsDir, firm.slug);
      fs.mkdirSync(destination, { recursive: true });
      req.uploadFirm = firm;
      cb(null, destination);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const filename = `${randomUUID()}${ext}`;
    req.clientUploadStoredFilename = req.uploadFirm?.slug ? path.join(req.uploadFirm.slug, filename) : filename;
    cb(null, filename);
  }
});

export const pdfUpload = multer({
  storage: diskStorageFor(originalsDir),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf';
    cb(isPdf ? null : new Error('Only PDF files are allowed'), isPdf);
  }
});

export const spreadsheetUpload = multer({
  storage: diskStorageFor(spreadsheetsDir),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = ['.csv', '.xlsx', '.xls'].includes(ext);
    cb(allowed ? null : new Error('Only CSV or Excel files are allowed'), allowed);
  }
});

export const clientDocumentUpload = multer({
  storage: clientDocumentStorage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'].includes(ext);
    cb(allowed ? null : new Error('Only PDF, image, or Word documents are allowed'), allowed);
  }
});
