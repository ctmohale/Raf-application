export function getGroupedFieldBoxes(field) {
  const groupConfig = Array.isArray(field?.options)
    ? field.options.find((option) => option && option.kind === 'grouped-input-boxes')
    : null;
  return Array.isArray(groupConfig?.boxes) ? groupConfig.boxes : [];
}

export function normalizeGroupedText(value) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '')).join('\n');
  return String(value ?? '');
}

export function normalizeDateInputValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const [, year, month, day] = slashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const localMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (localMatch) {
    const [, day, month, year] = localMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const monthLookup = {
    jan: '01',
    january: '01',
    feb: '02',
    february: '02',
    mar: '03',
    march: '03',
    apr: '04',
    april: '04',
    may: '05',
    jun: '06',
    june: '06',
    jul: '07',
    july: '07',
    aug: '08',
    august: '08',
    sep: '09',
    sept: '09',
    september: '09',
    oct: '10',
    october: '10',
    nov: '11',
    november: '11',
    dec: '12',
    december: '12'
  };
  const monthNameMatch = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (monthNameMatch) {
    const [, day, monthName, year] = monthNameMatch;
    const month = monthLookup[monthName.toLowerCase()];
    if (month) return `${year}-${month}-${day.padStart(2, '0')}`;
  }

  return '';
}

let groupedMeasureContext = null;

function measureGroupedTextWidth(value) {
  if (typeof document === 'undefined') return String(value || '').length * 6;
  if (!groupedMeasureContext) {
    groupedMeasureContext = document.createElement('canvas').getContext('2d');
  }
  groupedMeasureContext.font = '760 12px Inter, system-ui, sans-serif';
  return groupedMeasureContext.measureText(String(value || '')).width;
}

function getGroupedBoxLineLimit(box) {
  const boxWidth = Math.max(30, Number(box?.width || 160));
  return Math.max(22, boxWidth - 6);
}

function splitTextForGroupedBox(value, box) {
  const text = String(value ?? '');
  const lineLimit = getGroupedBoxLineLimit(box);
  if (measureGroupedTextWidth(text) <= lineLimit) return { line: text, remaining: '' };

  let low = 1;
  let high = text.length;
  let best = 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (measureGroupedTextWidth(text.slice(0, mid)) <= lineLimit) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const chunk = text.slice(0, best + 1);
  const breakAt = Math.max(chunk.lastIndexOf(' '), chunk.lastIndexOf(','));
  const splitAt = breakAt > Math.floor(best * 0.45) ? breakAt : best;

  return {
    line: text.slice(0, splitAt),
    remaining: text.slice(splitAt)
  };
}

export function distributeGroupedText(value, boxes, count) {
  const safeCount = Math.max(0, Number(count || 0));
  const sourceLines = normalizeGroupedText(value).split(/\r?\n/);
  if (sourceLines.length >= safeCount) return sourceLines.slice(0, safeCount);

  const lines = Array.from({ length: safeCount }, () => '');
  let slotIndex = 0;
  let remaining = sourceLines.join(' ');

  while (remaining && slotIndex < safeCount) {
    const box = boxes[slotIndex] || boxes[0] || {};
    const result = splitTextForGroupedBox(remaining, box);
    lines[slotIndex] = result.line;
    remaining = result.remaining;
    slotIndex += 1;
  }

  return lines;
}

export function groupedInputCount(field, value) {
  const groupedBoxes = getGroupedFieldBoxes(field);
  if (groupedBoxes.length > 0) return groupedBoxes.length;
  const filledLines = normalizeGroupedText(value)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .length;
  const heightCount = Math.round(Number(field?.height || 72) / 26);
  return Math.max(filledLines, Math.max(2, Math.min(12, heightCount)));
}

export function buildTemplateInputPreview(fields, values, options = {}) {
  const getValueKey = options.getValueKey || ((field) => field.name);
  const getReadableLabel = options.getReadableLabel || ((field) => field.label || field.name || 'Field');
  const previewValues = { ...values };
  const previewFields = [];

  fields.forEach((field) => {
    const readableLabel = getReadableLabel(field, fields);
    const valueKey = getValueKey(field);
    if (field.field_type !== 'repeatable') {
      previewFields.push({ ...field, label: readableLabel, source_value_key: valueKey });
      return;
    }

    const repeatValue = normalizeGroupedText(values?.[valueKey]);
    const groupedBoxes = getGroupedFieldBoxes(field);
    const inputCount = groupedBoxes.length || groupedInputCount(field, repeatValue);
    const lines = distributeGroupedText(repeatValue, groupedBoxes, inputCount);

    lines.slice(0, inputCount).forEach((line, index) => {
      const box = groupedBoxes[index];
      const previewName = `${field.name}__preview_${index}`;
      previewValues[previewName] = line;
      previewFields.push({
        ...field,
        id: `${field.id}-preview-${index}`,
        name: previewName,
        label: index === 0 ? readableLabel : '',
        aria_label: `${readableLabel} ${index + 1}`,
        page_number: Number(box?.page_number || field.page_number),
        x: Number(box?.x ?? field.x),
        y: Number(box?.y ?? field.y),
        width: Number(box?.width ?? field.width),
        height: Number(box?.height ?? Math.max(18, Math.min(28, Number(field.height || 72) / inputCount - 4))),
        field_type: 'text',
        required: Boolean(field.required) && index === 0,
        default_value: '',
        source_value_key: valueKey,
        source_line_index: index,
        source_line_count: inputCount,
        source_grouped_boxes: groupedBoxes
      });
    });
  });

  return { fields: previewFields, values: previewValues };
}

export function scaleGroupedBoxesForRenderedField(field) {
  const renderScale = Math.max(0.2, Number(field?.source_render_scale || 1));
  return (field?.source_grouped_boxes || []).map((box) => ({
    ...box,
    width: Number(box.width || field.width || 0) * renderScale,
    height: Number(box.height || field.height || 0) * renderScale
  }));
}

export function getUpdatedGroupedInputValue(currentValue, index, nextValue, count, boxes = []) {
  const existingLines = distributeGroupedText(currentValue, boxes, count);
  const prefix = existingLines.slice(0, index);
  const suffix = existingLines.slice(index + 1).filter((line) => line !== '');
  const flowingText = [nextValue, ...suffix].join(' ');
  const nextLines = [
    ...prefix,
    ...distributeGroupedText(flowingText, boxes.slice(index), count - index)
  ].slice(0, count);
  return nextLines.join('\n');
}
