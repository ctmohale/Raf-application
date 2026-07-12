import fs from 'node:fs';
import express from 'express';
import { db, serializeDocument, serializeField } from '../db/db.js';
import { generatedDir, resolveInside } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { getTemplateFields } from '../services/templateAccess.js';

export const documentsRouter = express.Router();

documentsRouter.get('/', authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT generated_documents.*, document_templates.name AS template_name
    FROM generated_documents
    JOIN document_templates ON document_templates.id = generated_documents.template_id
    WHERE generated_documents.user_id = ?
    ORDER BY generated_documents.created_at DESC
  `).all(req.user.id);
  res.json({ documents: rows.map(serializeDocument) });
});

documentsRouter.get('/:id', authenticate, (req, res) => {
  const row = db.prepare(`
    SELECT generated_documents.*, document_templates.name AS template_name
    FROM generated_documents
    JOIN document_templates ON document_templates.id = generated_documents.template_id
    WHERE generated_documents.id = ? AND generated_documents.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Document not found' });

  const fields = getTemplateFields(row.template_id).map(serializeField);
  return res.json({ document: serializeDocument(row), fields });
});

documentsRouter.get('/:id/download', authenticate, (req, res) => {
  const row = db.prepare(`
    SELECT *
    FROM generated_documents
    WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Document not found' });

  const filePath = resolveInside(generatedDir, row.stored_filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File is missing from storage' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${req.query.inline ? 'inline' : 'attachment'}; filename="${row.file_name}"`
  );
  fs.createReadStream(filePath).pipe(res);
});
