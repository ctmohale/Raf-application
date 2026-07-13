import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { db, serializeDocument } from '../db/db.js';
import { generatedDir, originalsDir, resolveInside } from '../config.js';

function truthy(value) {
  return value === true || value === 'true' || value === 'yes' || value === 'on' || value === '1' || value === 1;
}

function normalizeValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(normalizeValue).filter(Boolean).join('\n');
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some((item) => String(item ?? '').trim() !== '');
  return value != null && String(value).trim() !== '';
}

function fitText(value, maxChars = 120) {
  const text = normalizeValue(value).replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}...` : text;
}

function wrapText(value, font, fontSize, maxWidth, maxLines) {
  const paragraphs = normalizeValue(value).split(/\r?\n/);
  const lines = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) lines.push(line);
      line = word;

      while (font.widthOfTextAtSize(line, fontSize) > maxWidth && line.length > 1) {
        let slice = line.length - 1;
        while (slice > 1 && font.widthOfTextAtSize(line.slice(0, slice), fontSize) > maxWidth) slice -= 1;
        lines.push(line.slice(0, slice));
        line = line.slice(slice);
      }
    }

    if (line) lines.push(line);
    if (lines.length >= maxLines) break;
  }

  return lines.slice(0, maxLines);
}

function groupedTextLines(value, font, fontSize, maxWidth, maxLines) {
  const explicitLines = normalizeValue(value).split(/\r?\n/);
  const lines = [];

  for (const explicitLine of explicitLines) {
    if (lines.length >= maxLines) break;
    const wrapped = wrapText(explicitLine, font, fontSize, maxWidth, Math.max(1, maxLines - lines.length));
    if (wrapped.length) lines.push(...wrapped);
    else lines.push('');
  }

  return lines.slice(0, maxLines);
}

function groupedInputBoxes(field) {
  const groupConfig = Array.isArray(field.options)
    ? field.options.find((option) => option && option.kind === 'grouped-input-boxes')
    : null;
  if (!Array.isArray(groupConfig?.boxes) || groupConfig.boxes.length === 0) return [];

  return groupConfig.boxes
    .filter((box) => Number.isFinite(Number(box.x)) && Number.isFinite(Number(box.y)))
    .sort((a, b) => (Number(a.y) - Number(b.y)) || (Number(a.x) - Number(b.x)));
}

function drawTextInBox(page, box, value, pageHeight, font, color = rgb(0.03, 0.09, 0.18)) {
  const text = fitText(value);
  if (!text) return;

  const boxHeight = Number(box.height);
  const fontSize = Math.max(8, Math.min(12, boxHeight * 0.45));
  page.drawText(text, {
    x: Number(box.x) + 3,
    y: pageHeight - Number(box.y) - boxHeight + 6,
    size: fontSize,
    font,
    color,
    maxWidth: Math.max(20, Number(box.width) - 6)
  });
}

function checkboxMarkStyle(field) {
  const option = Array.isArray(field?.options)
    ? field.options.find((item) => item && item.kind === 'checkbox-mark-style')
    : null;
  return option?.value === 'check' ? 'check' : 'x';
}

function drawCheckMark(page, { x, y, size, color }) {
  page.drawLine({
    start: { x: x + size * 0.22, y: y + size * 0.48 },
    end: { x: x + size * 0.42, y: y + size * 0.25 },
    thickness: Math.max(1.4, size * 0.12),
    color
  });
  page.drawLine({
    start: { x: x + size * 0.42, y: y + size * 0.25 },
    end: { x: x + size * 0.8, y: y + size * 0.76 },
    thickness: Math.max(1.4, size * 0.12),
    color
  });
}

function isSignatureField(field) {
  const label = String(field?.label || '').trim().toLowerCase();
  const name = String(field?.name || '').trim().toLowerCase();
  return label.includes('signature') || name.includes('signature') || label === 'signed' || /^signed(_\d+)?$/.test(name);
}

function signatureFieldValueKey(field) {
  return `${field.name}__field_${field.id}`;
}

function getFieldValue(field, data) {
  if (!isSignatureField(field)) return data[field.name];
  return data[signatureFieldValueKey(field)] ?? data[field.name];
}

function parseDataImage(value) {
  const match = String(value || '').match(/^data:image\/(png|jpe?g);base64,(.+)$/);
  if (!match) return null;
  return {
    type: match[1].startsWith('jp') ? 'jpg' : 'png',
    bytes: Buffer.from(match[2], 'base64')
  };
}

export function validateDataAgainstFields(fields, data, { rejectUnknown = false } = {}) {
  const errors = [];
  const fieldNames = new Set(fields.map((field) => field.name));
  fields.filter(isSignatureField).forEach((field) => fieldNames.add(signatureFieldValueKey(field)));

  for (const field of fields) {
    const value = getFieldValue(field, data);
    if (field.required && !hasValue(value)) {
      errors.push(`${field.label || field.name} is required`);
    }
  }

  if (rejectUnknown) {
    for (const key of Object.keys(data)) {
      if (!fieldNames.has(key)) errors.push(`Unknown field: ${key}`);
    }
  }

  return errors;
}

export async function generateFilledPdf({ template, fields, data, userId, sourceType, rowNumber = null }) {
  const originalPath = resolveInside(originalsDir, template.stored_filename);
  const sourceBytes = await fs.readFile(originalPath);
  const pdfDoc = await PDFDocument.load(sourceBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const signatureFont = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const pages = pdfDoc.getPages();

  for (const field of fields) {
    const page = pages[field.page_number - 1];
    if (!page) continue;

    const value = getFieldValue(field, data) ?? field.default_value ?? '';
    const pageHeight = page.getHeight();
    const x = Number(field.x) + 3;
    // The editor stores coordinates from the top-left, while pdf-lib draws
    // from the bottom-left. This conversion keeps placement consistent.
    const y = pageHeight - Number(field.y) - Number(field.height) + 6;
    const signatureField = isSignatureField(field);
    const fontSize = Math.max(8, Math.min(signatureField ? 15 : 12, Number(field.height) * (signatureField ? 0.58 : 0.45)));
    const signatureImage = signatureField ? parseDataImage(value) : null;

    if (field.field_type === 'checkbox') {
      const boxSize = Number(field.height);
      const boxX = Number(field.x);
      const boxY = pageHeight - Number(field.y) - Number(field.height);
      page.drawRectangle({
        x: boxX,
        y: boxY,
        width: boxSize,
        height: boxSize,
        borderColor: rgb(0.15, 0.2, 0.28),
        borderWidth: 1
      });
      if (truthy(value)) {
        if (checkboxMarkStyle(field) === 'check') {
          drawCheckMark(page, {
            x: boxX,
            y: boxY,
            size: boxSize,
            color: rgb(0.03, 0.09, 0.18)
          });
        } else {
          page.drawText('X', { x: boxX + 4, y: boxY + 3, size: fontSize + 2, font });
        }
      }
      continue;
    }

    if (signatureImage) {
      const embeddedImage = signatureImage.type === 'jpg'
        ? await pdfDoc.embedJpg(signatureImage.bytes)
        : await pdfDoc.embedPng(signatureImage.bytes);
      const maxWidth = Math.max(20, Number(field.width) - 6);
      const maxHeight = Math.max(12, Number(field.height) - 4);
      const ratio = Math.min(maxWidth / embeddedImage.width, maxHeight / embeddedImage.height);
      const drawWidth = embeddedImage.width * ratio;
      const drawHeight = embeddedImage.height * ratio;
      page.drawImage(embeddedImage, {
        x,
        y: pageHeight - Number(field.y) - Number(field.height) + ((Number(field.height) - drawHeight) / 2),
        width: drawWidth,
        height: drawHeight
      });
      continue;
    }

    if (field.field_type === 'repeatable') {
      const childBoxes = groupedInputBoxes(field);
      if (childBoxes.length > 0) {
        const lines = normalizeValue(value).split(/\r?\n/);
        childBoxes.forEach((box, index) => {
          drawTextInBox(page, box, lines[index] || '', pageHeight, font);
        });
        continue;
      }

      const maxWidth = Math.max(20, Number(field.width) - 6);
      const maxHeight = Math.max(12, Number(field.height) - 8);
      const textareaFontSize = Math.max(8, Math.min(11, Number(field.height) / 6));
      const lineHeight = textareaFontSize * 1.25;
      const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
      const lines = groupedTextLines(value, font, textareaFontSize, maxWidth, maxLines);
      lines.forEach((line, index) => {
        page.drawText(line, {
          x,
          y: pageHeight - Number(field.y) - 6 - ((index + 1) * lineHeight),
          size: textareaFontSize,
          font,
          color: rgb(0.03, 0.09, 0.18),
          maxWidth
        });
      });
      continue;
    }

    page.drawText(fitText(value), {
      x,
      y,
      size: fontSize,
      font: signatureField ? signatureFont : font,
      color: rgb(0.03, 0.09, 0.18),
      maxWidth: Math.max(20, Number(field.width) - 6)
    });
  }

  const bytes = await pdfDoc.save();
  const storedFilename = `${randomUUID()}.pdf`;
  const outputPath = path.join(generatedDir, storedFilename);
  await fs.writeFile(outputPath, bytes);

  const fileName = `${template.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'document'}-${Date.now()}.pdf`;
  const result = db.prepare(`
    INSERT INTO generated_documents (template_id, user_id, source_type, file_name, stored_filename, input_json, row_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(template.id, userId, sourceType, fileName, storedFilename, JSON.stringify(data), rowNumber);

  return serializeDocument(db.prepare(`
    SELECT generated_documents.*, document_templates.name AS template_name
    FROM generated_documents
    JOIN document_templates ON document_templates.id = generated_documents.template_id
    WHERE generated_documents.id = ?
  `).get(result.lastInsertRowid));
}
