import { db } from '../db/db.js';

export function getOwnedTemplate(templateId, userId) {
  return db.prepare(`
    SELECT *
    FROM document_templates
    WHERE id = ? AND user_id = ?
  `).get(templateId, userId);
}

export function getTemplateFields(templateId) {
  return db.prepare(`
    SELECT *
    FROM template_fields
    WHERE template_id = ?
    ORDER BY page_number, y, x, id
  `).all(templateId);
}
