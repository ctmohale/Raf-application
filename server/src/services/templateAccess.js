import { db } from '../db/db.js';
export async function getOwnedTemplate(templateId, userId) {
  return await db.prepare(`
    SELECT *
    FROM document_templates
    WHERE id = ? AND user_id = ?
  `).get(templateId, userId);
}
export async function getTemplateFields(templateId) {
  return await db.prepare(`
    SELECT *
    FROM template_fields
    WHERE template_id = ?
    ORDER BY page_number, y, x, id
  `).all(templateId);
}
