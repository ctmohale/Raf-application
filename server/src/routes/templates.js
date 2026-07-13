import crypto from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import express from 'express';
import { PDFDocument } from 'pdf-lib';
import { db, serializeField, serializeTemplate } from '../db/db.js';
import { authenticate, authenticateJwtOrApiKey, hashApiKey } from '../middleware/auth.js';
import { pdfUpload, spreadsheetUpload } from '../middleware/upload.js';
import { generatedDir, originalsDir, resolveInside } from '../config.js';
import { detectFieldsFromPdf } from '../services/fieldDetection.js';
import { generateFilledPdf, validateDataAgainstFields } from '../services/pdfFill.js';
import { parseSpreadsheet } from '../services/spreadsheet.js';
import { getOwnedTemplate, getTemplateFields } from '../services/templateAccess.js';

export const templatesRouter = express.Router();

const allowedFieldTypes = new Set(['text', 'number', 'date', 'checkbox', 'select', 'signature', 'repeatable']);

function normalizeField(input) {
  const name = String(input.name || input.label || 'field').trim().replace(/\s+/g, '_').toLowerCase();
  return {
    name,
    label: String(input.label || input.name || 'Field').trim(),
    page_number: Math.max(1, Number(input.page_number || 1)),
    x: Math.max(0, Number(input.x || 0)),
    y: Math.max(0, Number(input.y || 0)),
    width: Math.max(10, Number(input.width || 160)),
    height: Math.max(10, Number(input.height || 28)),
    field_type: allowedFieldTypes.has(input.field_type) ? input.field_type : 'text',
    required: input.required ? 1 : 0,
    default_value: input.default_value == null ? '' : String(input.default_value),
    options_json: JSON.stringify(input.options || [])
  };
}

function fieldIdentity(field) {
  return String(field.label || field.name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function insertField(templateId, field) {
  const clean = normalizeField(field);
  const result = db.prepare(`
    INSERT INTO template_fields
      (template_id, name, label, page_number, x, y, width, height, field_type, required, default_value, options_json)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    templateId,
    clean.name,
    clean.label,
    clean.page_number,
    clean.x,
    clean.y,
    clean.width,
    clean.height,
    clean.field_type,
    clean.required,
    clean.default_value,
    clean.options_json
  );
  return result.lastInsertRowid;
}

function updateFieldLayout(templateId, fieldId, field) {
  const clean = normalizeField(field);
  db.prepare(`
    UPDATE template_fields
    SET x = ?, y = ?, width = ?, height = ?, field_type = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND template_id = ?
  `).run(
    clean.x,
    clean.y,
    clean.width,
    clean.height,
    clean.field_type,
    fieldId,
    templateId
  );
}

function getTemplateOr404(req, res) {
  const template = getOwnedTemplate(req.params.id, req.user.id);
  if (!template) {
    res.status(404).json({ error: 'Template not found' });
    return null;
  }
  return template;
}

templatesRouter.get('/', authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT document_templates.*, COUNT(template_fields.id) AS field_count
    FROM document_templates
    LEFT JOIN template_fields ON template_fields.template_id = document_templates.id
    WHERE document_templates.user_id = ?
    GROUP BY document_templates.id
    ORDER BY document_templates.created_at DESC
  `).all(req.user.id);
  res.json({ templates: rows.map(serializeTemplate) });
});

templatesRouter.post('/upload', authenticate, pdfUpload.single('pdf'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'PDF file is required' });

    const bytes = await fsp.readFile(req.file.path);
    const pdf = await PDFDocument.load(bytes);
    const name = String(req.body.name || req.file.originalname.replace(/\.pdf$/i, '') || 'Untitled template').trim();

    const result = db.prepare(`
      INSERT INTO document_templates (user_id, name, original_filename, stored_filename, page_count, status)
      VALUES (?, ?, ?, ?, ?, 'needs_setup')
    `).run(req.user.id, name, req.file.originalname, req.file.filename, pdf.getPageCount());

    const templateId = result.lastInsertRowid;
    const detectedFields = await detectFieldsFromPdf(req.file.filename);
    const insertMany = db.transaction((fields) => {
      fields.forEach((field) => insertField(templateId, field));
    });
    insertMany(detectedFields);

    const template = db.prepare(`
      SELECT document_templates.*, COUNT(template_fields.id) AS field_count
      FROM document_templates
      LEFT JOIN template_fields ON template_fields.template_id = document_templates.id
      WHERE document_templates.id = ?
      GROUP BY document_templates.id
    `).get(templateId);

    return res.status(201).json({
      template: serializeTemplate(template),
      detectedFields: detectedFields.length
    });
  } catch (error) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    return next(error);
  }
});

templatesRouter.get('/:id', authenticate, (req, res) => {
  const template = getTemplateOr404(req, res);
  if (!template) return;

  const fieldRows = getTemplateFields(template.id);
  return res.json({
    template: serializeTemplate({ ...template, field_count: fieldRows.length }),
    fields: fieldRows.map(serializeField)
  });
});

templatesRouter.get('/:id/pdf', authenticate, (req, res) => {
  const template = getTemplateOr404(req, res);
  if (!template) return;

  const filePath = resolveInside(originalsDir, template.stored_filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'PDF is missing from storage' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${template.original_filename}"`);
  fs.createReadStream(filePath).pipe(res);
});

templatesRouter.patch('/:id', authenticate, (req, res) => {
  const template = getTemplateOr404(req, res);
  if (!template) return;

  const name = String(req.body?.name || '').trim();
  const status = String(req.body?.status || template.status).trim();
  const allowedStatuses = new Set(['needs_setup', 'ready', 'archived']);

  if (!name) return res.status(400).json({ error: 'Template name is required' });
  if (!allowedStatuses.has(status)) return res.status(400).json({ error: 'Choose a valid template status' });

  db.prepare(`
    UPDATE document_templates
    SET name = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(name, status, template.id, req.user.id);

  const updated = db.prepare(`
    SELECT document_templates.*, COUNT(template_fields.id) AS field_count
    FROM document_templates
    LEFT JOIN template_fields ON template_fields.template_id = document_templates.id
    WHERE document_templates.id = ? AND document_templates.user_id = ?
    GROUP BY document_templates.id
  `).get(template.id, req.user.id);

  return res.json({ template: serializeTemplate(updated) });
});

templatesRouter.post('/:id/fields/detect', authenticate, async (req, res, next) => {
  try {
    const template = getTemplateOr404(req, res);
    if (!template) return;

    const existingFields = getTemplateFields(template.id).map(serializeField);
    const existingByKey = new Map(existingFields.map((field) => [`${field.page_number}:${fieldIdentity(field)}`, field]));
    const existingKeys = new Set(existingByKey.keys());
    const requestedPage = Number(req.body?.pageNumber || 0);
    const pageNumbers = requestedPage >= 1 && requestedPage <= Number(template.page_count || requestedPage)
      ? [requestedPage]
      : null;
    const maxFields = Math.max(1, Math.min(500, Number(req.body?.maxFields || 90)));
    const detectedFields = await detectFieldsFromPdf(template.stored_filename, { pageNumbers, maxFields });
    const updateExisting = req.body?.updateExisting !== false;
    const additions = detectedFields.filter((field) => {
      const key = `${field.page_number}:${fieldIdentity(field)}`;
      return fieldIdentity(field) && !existingKeys.has(key);
    });
    const updates = detectedFields.filter((field) => {
      if (!updateExisting) return false;
      const key = `${field.page_number}:${fieldIdentity(field)}`;
      const existing = existingByKey.get(key);
      if (!existing) return false;
      return Math.abs(Number(existing.x) - Number(field.x)) > 1
        || Math.abs(Number(existing.y) - Number(field.y)) > 1
        || Math.abs(Number(existing.width) - Number(field.width)) > 1
        || Math.abs(Number(existing.height) - Number(field.height)) > 1
        || existing.field_type !== field.field_type;
    });

    if (additions.length > 0 || updates.length > 0) {
      const applyDetectedFields = db.transaction((fieldsToAdd, fieldsToUpdate) => {
        fieldsToAdd.forEach((field) => insertField(template.id, field));
        fieldsToUpdate.forEach((field) => {
          const existing = existingByKey.get(`${field.page_number}:${fieldIdentity(field)}`);
          if (existing) updateFieldLayout(template.id, existing.id, field);
        });
        db.prepare(`
          UPDATE document_templates
          SET status = 'ready', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(template.id);
      });
      applyDetectedFields(additions, updates);
    }

    const fields = getTemplateFields(template.id).map(serializeField);
    return res.status(201).json({
      fields,
      detectedFields: detectedFields.length,
      addedFields: additions.length,
      updatedFields: updates.length
    });
  } catch (error) {
    return next(error);
  }
});

templatesRouter.post('/:id/fields', authenticate, (req, res) => {
  const template = getTemplateOr404(req, res);
  if (!template) return;

  if (Array.isArray(req.body.fields)) {
    const replaceFields = db.transaction((fields) => {
      db.prepare('DELETE FROM template_fields WHERE template_id = ?').run(template.id);
      fields.forEach((field) => insertField(template.id, field));
      db.prepare(`
        UPDATE document_templates
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(fields.length ? 'ready' : 'needs_setup', template.id);
    });
    replaceFields(req.body.fields);
  } else {
    insertField(template.id, req.body || {});
    db.prepare(`
      UPDATE document_templates
      SET status = 'ready', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(template.id);
  }

  const fields = getTemplateFields(template.id).map(serializeField);
  return res.status(201).json({ fields });
});

templatesRouter.put('/:id/fields/:fieldId', authenticate, (req, res) => {
  const template = getTemplateOr404(req, res);
  if (!template) return;

  const existing = db.prepare('SELECT * FROM template_fields WHERE id = ? AND template_id = ?').get(req.params.fieldId, template.id);
  if (!existing) return res.status(404).json({ error: 'Field not found' });

  const clean = normalizeField({ ...existing, ...req.body });
  db.prepare(`
    UPDATE template_fields
    SET name = ?, label = ?, page_number = ?, x = ?, y = ?, width = ?, height = ?,
        field_type = ?, required = ?, default_value = ?, options_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND template_id = ?
  `).run(
    clean.name,
    clean.label,
    clean.page_number,
    clean.x,
    clean.y,
    clean.width,
    clean.height,
    clean.field_type,
    clean.required,
    clean.default_value,
    clean.options_json,
    req.params.fieldId,
    template.id
  );

  const row = db.prepare('SELECT * FROM template_fields WHERE id = ?').get(req.params.fieldId);
  return res.json({ field: serializeField(row) });
});

templatesRouter.delete('/:id/fields/:fieldId', authenticate, (req, res) => {
  const template = getTemplateOr404(req, res);
  if (!template) return;

  db.prepare('DELETE FROM template_fields WHERE id = ? AND template_id = ?').run(req.params.fieldId, template.id);
  const count = db.prepare('SELECT COUNT(*) AS count FROM template_fields WHERE template_id = ?').get(template.id).count;
  db.prepare(`
    UPDATE document_templates
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(count ? 'ready' : 'needs_setup', template.id);
  return res.status(204).end();
});

templatesRouter.delete('/:id', authenticate, (req, res) => {
  const template = getTemplateOr404(req, res);
  if (!template) return;

  const generatedDocuments = db.prepare(`
    SELECT stored_filename
    FROM generated_documents
    WHERE template_id = ? AND user_id = ?
  `).all(template.id, req.user.id);

  db.prepare('DELETE FROM document_templates WHERE id = ? AND user_id = ?').run(template.id, req.user.id);

  fs.rm(resolveInside(originalsDir, template.stored_filename), { force: true }, () => {});
  for (const document of generatedDocuments) {
    if (document.stored_filename) {
      fs.rm(resolveInside(generatedDir, document.stored_filename), { force: true }, () => {});
    }
  }

  return res.status(204).end();
});

templatesRouter.post('/:id/generate/form', authenticate, async (req, res, next) => {
  try {
    const template = getTemplateOr404(req, res);
    if (!template) return;
    const fields = getTemplateFields(template.id).map(serializeField);
    const data = req.body.data || req.body || {};
    const errors = validateDataAgainstFields(fields, data);
    if (errors.length) return res.status(400).json({ errors });

    const document = await generateFilledPdf({ template, fields, data, userId: req.user.id, sourceType: 'form' });
    return res.status(201).json({ document });
  } catch (error) {
    return next(error);
  }
});

templatesRouter.post('/:id/spreadsheet/preview', authenticate, spreadsheetUpload.single('spreadsheet'), (req, res, next) => {
  try {
    const template = getTemplateOr404(req, res);
    if (!template) return;
    if (!req.file) return res.status(400).json({ error: 'Spreadsheet is required' });

    const parsed = parseSpreadsheet(req.file.path);
    return res.json({
      sheetName: parsed.sheetName,
      columns: parsed.columns,
      sampleRows: parsed.rows.slice(0, 5),
      rowCount: parsed.rows.length
    });
  } catch (error) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    return next(error);
  }
});

templatesRouter.post('/:id/generate/spreadsheet', authenticate, spreadsheetUpload.single('spreadsheet'), async (req, res, next) => {
  try {
    const template = getTemplateOr404(req, res);
    if (!template) return;
    if (!req.file) return res.status(400).json({ error: 'Spreadsheet is required' });

    const fields = getTemplateFields(template.id).map(serializeField);
    const mapping = JSON.parse(req.body.mapping || '{}');
    const parsed = parseSpreadsheet(req.file.path);
    const documents = [];

    db.prepare(`
      INSERT INTO field_mappings (template_id, user_id, name, source_type, mapping_json)
      VALUES (?, ?, ?, 'spreadsheet', ?)
    `).run(template.id, req.user.id, req.body.mappingName || `Mapping ${new Date().toLocaleDateString()}`, JSON.stringify(mapping));

    for (let index = 0; index < parsed.rows.length; index += 1) {
      const row = parsed.rows[index];
      const data = {};
      for (const field of fields) {
        const column = mapping[field.name];
        data[field.name] = column ? row[column] : field.default_value || '';
      }
      const errors = validateDataAgainstFields(fields, data);
      if (errors.length) {
        return res.status(400).json({ error: `Row ${index + 1}: ${errors.join(', ')}` });
      }
      documents.push(await generateFilledPdf({
        template,
        fields,
        data,
        userId: req.user.id,
        sourceType: 'spreadsheet',
        rowNumber: index + 1
      }));
    }

    return res.status(201).json({ documents, count: documents.length });
  } catch (error) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    return next(error);
  }
});

templatesRouter.post('/:id/api-key', authenticate, (req, res) => {
  const template = getTemplateOr404(req, res);
  if (!template) return;

  const apiKey = `orc_live_${crypto.randomBytes(24).toString('hex')}`;
  db.prepare(`
    INSERT INTO api_keys (user_id, template_id, name, key_hash)
    VALUES (?, ?, ?, ?)
  `).run(req.user.id, template.id, req.body.name || 'Default API key', hashApiKey(apiKey));

  return res.status(201).json({ apiKey });
});

templatesRouter.post('/:id/generate/api', authenticateJwtOrApiKey, async (req, res, next) => {
  try {
    if (req.apiKey && Number(req.apiKey.template_id) !== Number(req.params.id)) {
      return res.status(403).json({ error: 'API key is not authorized for this template' });
    }

    const template = getOwnedTemplate(req.params.id, req.user.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const fields = getTemplateFields(template.id).map(serializeField);
    const data = req.body.data || req.body || {};
    const errors = validateDataAgainstFields(fields, data, { rejectUnknown: true });
    if (errors.length) return res.status(400).json({ errors });

    const document = await generateFilledPdf({ template, fields, data, userId: req.user.id, sourceType: 'api' });
    return res.status(201).json({ document });
  } catch (error) {
    return next(error);
  }
});
