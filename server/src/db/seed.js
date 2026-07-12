import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { db } from './db.js';
import { originalsDir } from '../config.js';

async function createDemoPdf(filePath) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawText('Client Intake Form', { x: 72, y: 720, size: 22, font: bold, color: rgb(0.04, 0.09, 0.18) });
  page.drawText('Name:', { x: 72, y: 660, size: 12, font });
  page.drawLine({ start: { x: 150, y: 656 }, end: { x: 420, y: 656 }, thickness: 1, color: rgb(0.65, 0.68, 0.74) });
  page.drawText('Email:', { x: 72, y: 610, size: 12, font });
  page.drawLine({ start: { x: 150, y: 606 }, end: { x: 420, y: 606 }, thickness: 1, color: rgb(0.65, 0.68, 0.74) });
  page.drawText('Start Date:', { x: 72, y: 560, size: 12, font });
  page.drawLine({ start: { x: 150, y: 556 }, end: { x: 300, y: 556 }, thickness: 1, color: rgb(0.65, 0.68, 0.74) });
  page.drawText('Amount:', { x: 72, y: 510, size: 12, font });
  page.drawLine({ start: { x: 150, y: 506 }, end: { x: 300, y: 506 }, thickness: 1, color: rgb(0.65, 0.68, 0.74) });
  page.drawText('Approved:', { x: 72, y: 460, size: 12, font });
  page.drawRectangle({ x: 150, y: 452, width: 16, height: 16, borderWidth: 1, borderColor: rgb(0.4, 0.43, 0.5) });
  page.drawText('Signature:', { x: 72, y: 410, size: 12, font });
  page.drawLine({ start: { x: 150, y: 406 }, end: { x: 420, y: 406 }, thickness: 1, color: rgb(0.65, 0.68, 0.74) });

  await fs.writeFile(filePath, await pdf.save());
}

async function seed() {
  const passwordHash = bcrypt.hashSync('password123', 12);
  let user = db.prepare('SELECT id FROM users WHERE email = ?').get('demo@example.com');
  if (!user) {
    const result = db.prepare(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ('Demo Admin', 'demo@example.com', ?, 'admin')
    `).run(passwordHash);
    user = { id: result.lastInsertRowid };
  }

  const existingTemplate = db.prepare(`
    SELECT id FROM document_templates
    WHERE user_id = ? AND name = 'Demo Intake Form'
  `).get(user.id);
  if (existingTemplate) {
    console.log('Demo data already exists.');
    return;
  }

  const storedFilename = 'demo-intake-form.pdf';
  await createDemoPdf(path.join(originalsDir, storedFilename));
  const templateResult = db.prepare(`
    INSERT INTO document_templates (user_id, name, original_filename, stored_filename, page_count, status)
    VALUES (?, 'Demo Intake Form', 'demo-intake-form.pdf', ?, 1, 'ready')
  `).run(user.id, storedFilename);

  const templateId = templateResult.lastInsertRowid;
  const fields = [
    ['client_name', 'Client Name', 1, 150, 118, 270, 24, 'text', 1, ''],
    ['email', 'Email', 1, 150, 168, 270, 24, 'text', 1, ''],
    ['start_date', 'Start Date', 1, 150, 218, 150, 24, 'date', 0, ''],
    ['amount', 'Amount', 1, 150, 268, 150, 24, 'number', 0, ''],
    ['approved', 'Approved', 1, 150, 324, 18, 18, 'checkbox', 0, ''],
    ['signature', 'Signature', 1, 150, 368, 270, 24, 'signature', 0, '']
  ];

  const insert = db.prepare(`
    INSERT INTO template_fields
      (template_id, name, label, page_number, x, y, width, height, field_type, required, default_value, options_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')
  `);

  for (const field of fields) {
    insert.run(templateId, ...field);
  }

  console.log('Seeded demo@example.com / password123');
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
