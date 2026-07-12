import fs from 'node:fs/promises';
import { resolveInside, originalsDir } from '../config.js';

function normalizeName(text, fallback) {
  const clean = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return clean || `field_${fallback}`;
}

function fieldTypeFromLabel(label) {
  const value = label.toLowerCase();
  if (value.includes('date')) return 'date';
  if (value.includes('amount') || value.includes('total') || value.includes('number')) return 'number';
  if (value.includes('sign')) return 'signature';
  if (value.includes('yes') || value.includes('no') || value.includes('check')) return 'checkbox';
  return 'text';
}

function cleanLabel(text) {
  return String(text || '').replace(/[:_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const knownFieldLabels = [
  'Name and surname',
  'ID number',
  'Claim number (if available)',
  'Contact number',
  'Date of assessment',
  'Date of accident',
  'Name & Surname',
  'Practice number (HPCSA and/or BHF)',
  'Telephone number',
  'E-mail address',
  'Number',
  'Description of injury',
  'Describe the nature of the motor vehicle accident',
  'Medical treatment rendered from date of accident to present',
  'Current symptoms and complaints',
  'Diagnosis',
  'Conclusion regarding physical examination',
  'Medical history',
  'Social and personal history',
  'Educational and occupational history',
  'Specify details regarding apportionment, if any',
  'Exceptions',
  'Signature of medical practitioner',
  'Signed at',
  'Evaluator (printed name)'
].sort((a, b) => b.length - a.length);

const knownSectionLabels = [
  'DETAILS OF PATIENT',
  'DETAILS OF MEDICAL PRACTITIONER',
  'LIST OF NON-SERIOUS INJURIES',
  'DETAILS OF ACCIDENT AND TREATMENT',
  'SERIOUS INJURY ASSESSMENT REPORT RAF 4'
];

const knownTextLabels = [...knownFieldLabels, ...knownSectionLabels].sort((a, b) => b.length - a.length);
const knownSectionLabelKeys = new Set(knownSectionLabels.map((label) => label.toLowerCase()));

const pageOneBelowInputLabels = new Set([
  'name and surname',
  'id number',
  'claim number (if available)',
  'contact number',
  'date of assessment',
  'date of accident',
  'name & surname',
  'practice number (hpcsa and/or bhf)',
  'telephone number',
  'e-mail address'
]);

function normalizedLabelText(text) {
  return String(text || '')
    .replace(/(YYYY\/MM\/DD)(?=[A-Z])/g, '$1 ')
    .replace(/(?<=[a-z0-9)])(?=[A-Z][a-z])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitKnownLabels(item) {
  const text = normalizedLabelText(item.text);
  const lowerText = text.toLowerCase();
  const matches = [];

  for (const label of knownTextLabels) {
    const needle = label.toLowerCase();
    let fromIndex = 0;
    while (fromIndex < lowerText.length) {
      const index = lowerText.indexOf(needle, fromIndex);
      if (index === -1) break;
      const end = index + needle.length;
      const overlaps = matches.some((match) => index < match.end && end > match.index);
      if (!overlaps) matches.push({ index, end, label });
      fromIndex = end;
    }
  }

  const ordered = matches.sort((a, b) => (a.index - b.index) || (b.end - b.index) - (a.end - a.index));
  if (ordered.length < 2) return [{ ...item, text }];

  const textLength = Math.max(text.length, 1);
  return ordered.map((match) => {
    const startRatio = match.index / textLength;
    const endRatio = match.end / textLength;
    const x = item.x + (item.width * startRatio);
    const width = Math.max(item.width * (endRatio - startRatio), match.label.length * item.height * 0.38, 8);
    return {
      ...item,
      text: match.label,
      x,
      width,
      right: x + width
    };
  });
}

function textItemBounds(pageHeight, item) {
  const text = String(item.str || '').trim();
  const [, , , fontY, left, baseline] = item.transform;
  const fontHeight = Math.max(Math.abs(fontY || 12), 8);
  const width = Math.max(item.width || text.length * fontHeight * 0.45, 8);
  return {
    text,
    x: left,
    y: pageHeight - baseline - fontHeight,
    width,
    height: fontHeight
  };
}

function groupTextRows(items) {
  const rows = [];
  const sorted = items
    .filter((item) => item.text.length > 0)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));

  for (const item of sorted) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 3);
    if (!row) {
      rows.push({
        y: item.y,
        x: item.x,
        right: item.x + item.width,
        height: item.height,
        items: [item]
      });
      continue;
    }
    row.items.push(item);
    row.x = Math.min(row.x, item.x);
    row.right = Math.max(row.right, item.x + item.width);
    row.height = Math.max(row.height, item.height);
  }

  return rows.map((row) => ({
    ...row,
    text: row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim()
  }));
}

function isUsefulFieldLabel(text) {
  return /(name|surname|date|e-?mail|email|phone|telephone|cell|address|signature|amount|total|\bid\b|number|claim|contact|practice|description|injury|diagnosis|symptoms|complaints|treatment|signed)/iu.test(text);
}

function isLikelyInstructionText(text) {
  const value = String(text || '').trim();
  if (value.length > 90 && !/:$/u.test(value) && !/_{4,}/u.test(value)) return true;
  if (value.length > 35 && /\.$/u.test(value) && !/:$/u.test(value)) return true;
  if (
    value.length > 12
    && value === value.toUpperCase()
    && !knownTextLabels.some((label) => label.toLowerCase() === value.toLowerCase())
  ) {
    return true;
  }
  return false;
}

function rowLabelSegments(row) {
  const itemSegments = row.items
    .sort((a, b) => a.x - b.x)
    .flatMap((item) => splitKnownLabels({
      ...item,
      right: item.x + item.width
    }))
    .map((item) => ({
      ...item,
      text: cleanLabel(item.text),
      right: item.x + item.width
    }))
    .filter((item) => item.text.length > 0 && !/^YYYY\/MM\/DD$/i.test(item.text));

  const usefulSegments = itemSegments.filter((item) => isUsefulFieldLabel(item.text) || /_{4,}/u.test(item.text));
  if (usefulSegments.length >= 2) return usefulSegments;

  return [{
    ...row,
    text: cleanLabel(row.text),
    right: row.right
  }];
}

function injuryTableHeaderRow(segments) {
  const labels = segments.map((segment) => segment.text.toLowerCase());
  return labels.includes('number') && labels.includes('description of injury');
}

function isPageOneBelowInputLabel(pageNumber, segment) {
  const label = segment.text.toLowerCase();
  return pageNumber === 1
    && segment.y >= 300
    && segment.y <= 565
    && pageOneBelowInputLabels.has(label);
}

function pageOneBelowInputBox(segment, viewportWidth) {
  const leftColumn = segment.x < 260;
  const x = leftColumn ? 40 : 310;
  const width = leftColumn ? 250 : Math.max(90, viewportWidth - x - 36);
  return {
    x,
    y: segment.y + segment.height + 5,
    width,
    height: 18
  };
}

function pathHorizontalLines(pdfjsLib, operatorList, pageHeight) {
  const lines = [];
  const { OPS } = pdfjsLib;
  let current = null;

  function addLine(x1, y1, x2, y2) {
    if (Math.abs(y1 - y2) > 2) return;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const width = right - left;
    if (width < 90) return;
    lines.push({
      x: left,
      y: pageHeight - y1,
      width
    });
  }

  operatorList.fnArray.forEach((fnId, index) => {
    const args = operatorList.argsArray[index];
    if (fnId === OPS.moveTo) {
      current = { x: Number(args[0]), y: Number(args[1]) };
      return;
    }

    if (fnId === OPS.lineTo && current) {
      const next = { x: Number(args[0]), y: Number(args[1]) };
      addLine(current.x, current.y, next.x, next.y);
      current = next;
      return;
    }

    if (fnId !== OPS.constructPath) return;
    const pathOps = args?.[0] || [];
    const pathArgs = args?.[1] || [];
    let argIndex = 0;
    let point = null;

    for (const op of pathOps) {
      if (op === OPS.moveTo) {
        point = { x: Number(pathArgs[argIndex]), y: Number(pathArgs[argIndex + 1]) };
        argIndex += 2;
      } else if (op === OPS.lineTo) {
        const next = { x: Number(pathArgs[argIndex]), y: Number(pathArgs[argIndex + 1]) };
        argIndex += 2;
        if (point) addLine(point.x, point.y, next.x, next.y);
        point = next;
      } else if (op === OPS.rectangle) {
        const x = Number(pathArgs[argIndex]);
        const y = Number(pathArgs[argIndex + 1]);
        const width = Number(pathArgs[argIndex + 2]);
        const height = Number(pathArgs[argIndex + 3]);
        argIndex += 4;
        if (height <= 18 && width >= 90) {
          addLine(x, y, x + width, y);
          addLine(x, y + height, x + width, y + height);
        }
      } else if (op === OPS.curveTo) {
        argIndex += 6;
      } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
        argIndex += 4;
      }
    }
  });

  return lines
    .filter((line) => Number.isFinite(line.x) && Number.isFinite(line.y) && Number.isFinite(line.width))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

function groupRuledLines(lines) {
  const groups = [];

  for (const line of lines) {
    const previous = groups[groups.length - 1];
    const lastLine = previous?.lines.at(-1);
    const gap = lastLine ? line.y - lastLine.y : Infinity;
    const aligned = lastLine
      && Math.abs(line.x - lastLine.x) <= 18
      && Math.abs(line.width - lastLine.width) <= 36
      && gap >= 8
      && gap <= 28;

    if (aligned) previous.lines.push(line);
    else groups.push({ lines: [line] });
  }

  return groups.filter((group) => {
    if (group.lines.length < 2) return false;
    const first = group.lines[0];
    const last = group.lines.at(-1);
    const height = last.y - first.y + 16;
    return group.lines.length >= 3 || (first.width >= 250 && height >= 54);
  });
}

function findHeadingForGroup(group, textRows) {
  const firstLine = group.lines[0];
  const left = firstLine.x;
  const right = firstLine.x + firstLine.width;
  const candidates = textRows.filter((row) => {
    const rowBottom = row.y + row.height;
    const above = rowBottom <= firstLine.y - 2 && firstLine.y - rowBottom <= 95;
    const overlaps = row.right >= left - 60 && row.x <= right + 30;
    const useful = /^(\d+(\.\d+)*)\b/.test(row.text) || /[a-z]{4,}/i.test(row.text);
    return above && overlaps && useful;
  });

  return candidates.at(-1)?.text || 'Paragraph response';
}

function textFieldsFromRows(textRows, pageNumber, viewportWidth, existingFields) {
  const fields = [];

  for (const row of textRows) {
    const segments = rowLabelSegments(row);
    const tableHeaderRow = injuryTableHeaderRow(segments);

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const text = segment.text;
      if (knownSectionLabelKeys.has(text.toLowerCase())) continue;
      if (!text || text.length < 3 || isLikelyInstructionText(text)) continue;
      const labelLooksUseful = /:$/u.test(text) || isUsefulFieldLabel(text);
      const underline = /_{4,}/u.exec(text);
      if (!labelLooksUseful && !underline) continue;

      const nextSegment = segments[index + 1];
      let x = segment.right + 12;
      let y = segment.y;
      let width = 180;
      let height = Math.max(segment.height + 10, 24);

      if (isPageOneBelowInputLabel(pageNumber, segment)) {
        const box = pageOneBelowInputBox(segment, viewportWidth);
        x = box.x;
        y = box.y;
        width = box.width;
        height = box.height;
      } else if (tableHeaderRow) {
        x = segment.x;
        y = segment.y + segment.height + 6;
        width = nextSegment ? Math.max(70, nextSegment.x - segment.x - 8) : Math.max(90, viewportWidth - segment.x - 24);
      } else if (nextSegment && nextSegment.x > x + 80) {
        width = Math.min(width, nextSegment.x - x - 10);
      }

      if (underline) {
        x = segment.x + Math.max(text.indexOf(underline[0]), 0) * 6;
        width = Math.max(underline[0].length * 6, 90);
      }

      if (x + width > viewportWidth - 24) {
        width = Math.max(90, viewportWidth - x - 24);
      }

      const overlapsParagraphField = existingFields.some((field) => (
        field.page_number === pageNumber
        && field.field_type === 'repeatable'
        && segment.y >= field.y - 4
        && segment.y <= field.y + field.height + 4
        && segment.right >= field.x
        && segment.x <= field.x + field.width
      ));
      if (overlapsParagraphField || width < 70) continue;

      const label = cleanLabel(text);
      fields.push({
        name: normalizeName(label, existingFields.length + fields.length + 1),
        label,
        page_number: pageNumber,
        x,
        y,
        width,
        height,
        field_type: fieldTypeFromLabel(label),
        required: false,
        default_value: ''
      });
    }
  }

  return fields;
}

// This is local layout detection, not a paid OCR/API call. It extracts text
// and vector line positions from text-based PDFs and guesses input regions.
export async function detectFieldsFromPdf(storedFilename, options = {}) {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const filePath = resolveInside(originalsDir, storedFilename);
    const bytes = await fs.readFile(filePath);
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const pdf = await loadingTask.promise;
    const fields = [];
    const pageNumbers = Array.isArray(options.pageNumbers)
      ? new Set(options.pageNumbers.map((pageNumber) => Number(pageNumber)).filter((pageNumber) => pageNumber >= 1 && pageNumber <= pdf.numPages))
      : null;
    const maxFields = Math.max(1, Math.min(500, Number(options.maxFields || 90)));

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (pageNumbers && !pageNumbers.has(pageNumber)) continue;
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const textRows = groupTextRows(content.items.map((item) => textItemBounds(viewport.height, item)));

      const operatorList = await page.getOperatorList();
      const ruledGroups = groupRuledLines(pathHorizontalLines(pdfjsLib, operatorList, viewport.height));

      for (const group of ruledGroups) {
        const label = cleanLabel(findHeadingForGroup(group, textRows));
        group.lines.forEach((line, index) => {
          const itemLabel = group.lines.length === 1 ? label : `${label} ${index + 1}`;
          fields.push({
            name: normalizeName(itemLabel, fields.length + 1),
            label: itemLabel,
            page_number: pageNumber,
            x: line.x,
            y: Math.max(0, line.y - 18),
            width: Math.min(line.width, viewport.width - line.x - 12),
            height: 24,
            field_type: 'text',
            required: false,
            default_value: ''
          });
        });
      }

      fields.push(...textFieldsFromRows(textRows, pageNumber, viewport.width, fields));
      if (fields.length >= maxFields) break;
    }

    return fields.slice(0, maxFields);
  } catch (error) {
    console.warn('PDF layout detection skipped:', error.message);
    return [];
  }
}
