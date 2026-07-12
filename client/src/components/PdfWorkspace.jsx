import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Plus } from 'lucide-react';
import { LoadingSpinner } from './LoadingSpinner.jsx';
import { apiBinary } from '../lib/api.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeName(label, fallback) {
  const clean = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return clean || `field_${fallback}`;
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
    const segmentWidth = Math.max(item.width * (endRatio - startRatio), match.label.length * item.height * 0.38, 8);
    return {
      ...item,
      text: match.label,
      x,
      width: segmentWidth
    };
  });
}

function normalizeTileKey(text) {
  return String(text || '').trim().toLowerCase().replace(/[:\s]+$/g, '');
}

function isLikelyLabelTile(item) {
  const text = String(item?.text || '').trim();
  const key = normalizeTileKey(text);
  if (!text || /^YYYY\/MM\/DD$/i.test(text)) return false;
  if (knownTextLabels.some((label) => normalizeTileKey(label) === key)) return true;
  if (text.length > 80 || /\.$/.test(text)) return false;
  return /:$|name|surname|date|e-?mail|email|phone|telephone|cell|address|signature|amount|total|\bid\b|number|claim|contact|practice|description|injury|diagnosis|symptoms|complaints|treatment|signed/i.test(text);
}

function newField(pageNumber, x, y, count, patch = {}) {
  const label = patch.label || `Field ${count + 1}`;
  return {
    id: `new-${Date.now()}-${count}`,
    name: normalizeName(patch.name || label, count + 1),
    label,
    page_number: pageNumber,
    x,
    y,
    width: 170,
    height: 30,
    field_type: 'text',
    required: false,
    default_value: '',
    ...patch
  };
}

function formatPreviewValue(value) {
  if (Array.isArray(value)) return value.filter((item) => String(item ?? '').trim() !== '').join(', ');
  if (value === true) return 'Yes';
  if (value === false) return '';
  return String(value ?? '').trim();
}

function groupedPreviewLines(value) {
  const text = Array.isArray(value) ? value.join('\n') : String(value ?? '');
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function isSignatureField(field) {
  const label = String(field?.label || '').trim().toLowerCase();
  const name = String(field?.name || '').trim().toLowerCase();
  return label.includes('signature') || name.includes('signature') || label === 'signed' || /^signed(_\d+)?$/.test(name);
}

function isDataImageValue(value) {
  return typeof value === 'string' && /^data:image\/(png|jpe?g);base64,/.test(value);
}

function getFieldValue(field, values) {
  if (!isSignatureField(field)) return values?.[field.name];
  const signatureKey = `${field.name}__field_${field.id}`;
  return values?.[signatureKey] ?? values?.[field.name];
}

function entryValueForField(field, values) {
  const directValue = getFieldValue(field, values);
  if (directValue !== undefined && directValue !== null) return directValue;
  return values?.[field.source_value_key] ?? '';
}

function entryInputProps(field) {
  if (field.field_type !== 'number') return { type: 'text' };
  return {
    type: 'text',
    inputMode: 'numeric',
    pattern: '[0-9]*'
  };
}

function isPageOneBelowInputLabel(pageNumber, item) {
  const label = item.text.toLowerCase();
  return pageNumber === 1
    && item.y >= 300
    && item.y <= 565
    && pageOneBelowInputLabels.has(label);
}

function pageOneBelowInputBox(item, pageWidth) {
  const leftColumn = item.x < 260;
  const x = leftColumn ? 40 : 310;
  const width = leftColumn ? 250 : Math.max(90, pageWidth - x - 36);
  return {
    x,
    y: item.y + item.height + 5,
    width
  };
}

function textItemBounds(page, item) {
  const viewport = page.getViewport({ scale: 1 });
  const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
  const fontHeight = Math.hypot(transform[2], transform[3]) || item.height || 12;
  return {
    text: item.str.trim(),
    x: transform[4],
    y: transform[5] - fontHeight,
    width: Math.max(item.width || 0, item.str.length * fontHeight * 0.38),
    height: Math.max(fontHeight, item.height || 12)
  };
}

function useContainerWidth(ref) {
  const [width, setWidth] = useState(920);
  useEffect(() => {
    if (!ref.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function PdfPage({
  page,
  pageNumber,
  width,
  height,
  containerWidth,
  fields,
  onFieldsChange,
  selectedFieldId,
  onSelectField,
  multiSelectedFieldIds = [],
  onToggleMultiSelect,
  mode,
  textTileMode,
  entryMode,
  onEntryValueChange,
  readOnly,
  values
}) {
  const canvasRef = useRef(null);
  const [textItems, setTextItems] = useState([]);
  const [selectedTextKey, setSelectedTextKey] = useState('');
  const scale = useMemo(() => clamp((containerWidth - 36) / width, 0.65, 1.35), [containerWidth, width]);
  const textPickMode = !entryMode && !readOnly && (mode === 'select' || mode === 'text');

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    const viewport = page.getViewport({ scale });
    const pixelRatio = window.devicePixelRatio || 1;

    canvas.width = Math.floor(viewport.width * pixelRatio);
    canvas.height = Math.floor(viewport.height * pixelRatio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const task = page.render({ canvasContext: context, viewport });
    task.promise.catch(() => {});
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [page, scale]);

  useEffect(() => {
    let cancelled = false;
    page.getTextContent().then((content) => {
      if (cancelled) return;
      setTextItems(
        content.items
          .map((item) => textItemBounds(page, item))
          .flatMap((item) => splitKnownLabels(item))
          .filter((item) => item.text.length > 1)
          .filter((item) => textTileMode === 'all' || isLikelyLabelTile(item))
      );
    });
    return () => {
      cancelled = true;
    };
  }, [page, textTileMode]);

  function handleAdd(event) {
    if (readOnly || mode !== 'add') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / scale, 0, width - 170);
    const y = clamp((event.clientY - rect.top) / scale, 0, height - 30);
    onFieldsChange([...fields, newField(pageNumber, x, y, fields.length)]);
  }

  function handleTextField(event, item) {
    if (!textPickMode) return;
    event.stopPropagation();
    const textKey = `${pageNumber}-${item.text}-${Math.round(item.x)}-${Math.round(item.y)}`;
    setSelectedTextKey(textKey);

    const gap = 12;
    const desiredWidth = 190;
    const fieldHeight = Math.max(24, Math.min(34, item.height + 10));
    let heightValue = fieldHeight;
    const rowItems = textItems
      .filter((candidate) => Math.abs(candidate.y - item.y) <= 3)
      .sort((a, b) => a.x - b.x);
    const rowLabels = rowItems.map((candidate) => candidate.text.toLowerCase());
    const isInjuryTableHeader = rowLabels.includes('number')
      && rowLabels.includes('description of injury')
      && ['number', 'description of injury'].includes(item.text.toLowerCase());
    const itemIndex = rowItems.findIndex((candidate) => candidate.text === item.text && Math.abs(candidate.x - item.x) < 1);
    const nextItem = itemIndex >= 0 ? rowItems[itemIndex + 1] : null;
    let x = item.x + item.width + gap;
    let y = item.y - Math.max(0, (fieldHeight - item.height) / 2);
    let widthValue = desiredWidth;

    if (isPageOneBelowInputLabel(pageNumber, item)) {
      const box = pageOneBelowInputBox(item, width);
      x = box.x;
      y = box.y;
      widthValue = box.width;
      heightValue = 18;
    } else if (isInjuryTableHeader) {
      x = item.x;
      y = item.y + item.height + 6;
      widthValue = nextItem ? Math.max(70, nextItem.x - item.x - 8) : Math.max(90, width - item.x - 24);
    }

    if (!isInjuryTableHeader && !isPageOneBelowInputLabel(pageNumber, item) && x + desiredWidth > width - 18) {
      x = item.x;
      y = item.y + item.height + 6;
    }

    const clampedX = clamp(x, 0, width - widthValue);
    const field = newField(
      pageNumber,
      clampedX,
      clamp(y, 0, height - fieldHeight),
      fields.length,
      {
        label: item.text.replace(/[:_*]+$/g, '').trim(),
        width: Math.min(widthValue, width - clampedX),
        height: heightValue,
        field_type: 'text'
      }
    );

    onFieldsChange([...fields, field]);
    onSelectField(field.id);
  }

  function handleDragStart(event, field) {
    if (readOnly) return;
    event.stopPropagation();
    if ((event.shiftKey || event.metaKey || event.ctrlKey) && onToggleMultiSelect) return;
    onSelectField(field.id);

    const start = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: field.x,
      y: field.y
    };

    function move(moveEvent) {
      const dx = (moveEvent.clientX - start.pointerX) / scale;
      const dy = (moveEvent.clientY - start.pointerY) / scale;
      onFieldsChange((current) => current.map((item) => (
        item.id === field.id
          ? { ...item, x: clamp(start.x + dx, 0, width - item.width), y: clamp(start.y + dy, 0, height - item.height) }
          : item
      )));
    }

    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function handleResizeStart(event, field) {
    if (readOnly) return;
    event.stopPropagation();

    const start = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      width: field.width,
      height: field.height
    };

    function move(moveEvent) {
      const dx = (moveEvent.clientX - start.pointerX) / scale;
      const dy = (moveEvent.clientY - start.pointerY) / scale;
      onFieldsChange((current) => current.map((item) => (
        item.id === field.id
          ? {
              ...item,
              width: clamp(start.width + dx, 16, width - item.x),
              height: clamp(start.height + dy, 16, height - item.y)
            }
          : item
      )));
    }

    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div className="pdf-page-wrap" style={{ width: width * scale }}>
      <div className="page-number">Page {pageNumber}</div>
      <div
        className={`pdf-page ${mode === 'add' && !readOnly ? 'adding' : ''} ${textPickMode ? 'text-pick' : ''}`}
        style={{ width: width * scale, height: height * scale }}
        onClick={handleAdd}
      >
        <canvas ref={canvasRef} />
        {textPickMode && (
          <div className="pdf-text-layer" aria-label="PDF text labels">
            {textItems.map((item, index) => {
              const textKey = `${pageNumber}-${item.text}-${Math.round(item.x)}-${Math.round(item.y)}`;
              return (
                <button
                  key={`${item.text}-${index}`}
                  type="button"
                  className={`pdf-text-item ${selectedTextKey === textKey ? 'selected' : ''}`}
                  style={{
                    left: item.x * scale,
                    top: item.y * scale,
                    width: Math.max(item.width * scale, 18),
                    height: Math.max(item.height * scale, 12)
                  }}
                  onClick={(event) => handleTextField(event, item)}
                  title={`Create field from "${item.text}"`}
                >
                  {item.text}
                </button>
              );
            })}
          </div>
        )}
        {fields.filter((field) => field.page_number === pageNumber).map((field) => {
          const selected = selectedFieldId === field.id;
          const multiSelected = multiSelectedFieldIds.includes(field.id);
          const rawValue = getFieldValue(field, values);
          const entryValue = entryValueForField(field, values);
          const previewValue = formatPreviewValue(rawValue);
          const hasValue = previewValue.length > 0;
          const displayText = readOnly ? (previewValue || field.label) : field.label;
          const signatureClass = (readOnly || entryMode) && isSignatureField(field) ? 'signature-field' : '';
          const signatureImage = readOnly && isSignatureField(field) && isDataImageValue(rawValue);
          const groupedField = field.field_type === 'repeatable';
          const groupedLines = groupedField ? groupedPreviewLines(rawValue) : [];
          const fieldClasses = `field-box ${selected ? 'selected' : ''} ${multiSelected ? 'multi-selected' : ''} ${readOnly ? 'readonly' : ''} ${entryMode ? 'entry-field' : ''} ${hasValue ? 'filled' : ''} ${signatureClass} ${groupedField ? 'grouped-field' : ''}`;
          const fieldStyle = {
            left: field.x * scale,
            top: field.y * scale,
            width: field.width * scale,
            height: field.height * scale
          };

          if (entryMode) {
            const inputId = `pdf-entry-${pageNumber}-${field.id}`;
            const inputProps = entryInputProps(field);
            const signatureDataImage = isSignatureField(field) && isDataImageValue(entryValue);
            return (
              <div
                key={field.id}
                className={fieldClasses}
                style={fieldStyle}
                title={field.label}
              >
                {field.field_type === 'checkbox' ? (
                  <input
                    id={inputId}
                    className="pdf-entry-checkbox"
                    type="checkbox"
                    checked={Boolean(entryValue)}
                    onChange={(event) => onEntryValueChange?.(field, event.target.checked)}
                    aria-label={field.label}
                  />
                ) : field.field_type === 'select' ? (
                  <select
                    id={inputId}
                    value={entryValue || ''}
                    onChange={(event) => onEntryValueChange?.(field, event.target.value)}
                    aria-label={field.label}
                  >
                    <option value=""></option>
                    {(field.options || []).map((option) => <option value={option} key={option}>{option}</option>)}
                  </select>
                ) : isSignatureField(field) ? (
                  <button
                    className={`pdf-entry-signature-button ${signatureDataImage ? 'has-signature' : ''}`}
                    type="button"
                    onClick={() => onEntryValueChange?.(field, '__open_signature_pad__')}
                    title={signatureDataImage ? `Edit ${field.label}` : `Draw ${field.label}`}
                    aria-label={signatureDataImage ? `Edit ${field.label}` : `Draw ${field.label}`}
                  >
                    {signatureDataImage ? <img src={entryValue} alt={field.label} /> : <span>Sign</span>}
                  </button>
                ) : (
                  <input
                    id={inputId}
                    {...inputProps}
                    value={entryValue || ''}
                    onChange={(event) => onEntryValueChange?.(field, event.target.value)}
                    aria-label={field.label}
                    placeholder={field.label}
                  />
                )}
              </div>
            );
          }

          return (
            <button
              key={field.id}
              type="button"
              className={fieldClasses}
              style={fieldStyle}
              onPointerDown={(event) => handleDragStart(event, field)}
              onClick={(event) => {
                event.stopPropagation();
                if ((event.shiftKey || event.metaKey || event.ctrlKey) && onToggleMultiSelect) {
                  onToggleMultiSelect(field.id);
                  return;
                }
                onSelectField(field.id);
              }}
              title={hasValue ? `${field.label}: ${previewValue}` : `${groupedField ? 'Grouped input: ' : ''}${field.label}. Shift-click to select for grouping.`}
            >
              {signatureImage ? (
                <img src={rawValue} alt={field.label} />
              ) : groupedField && !readOnly ? (
                <>
                  <span className="field-kind">Grouped input</span>
                  <span className="field-label-text">{displayText}</span>
                </>
              ) : groupedField && readOnly && groupedLines.length > 0 ? (
                <span className="grouped-preview-lines">
                  {groupedLines.map((line, index) => (
                    <span className="grouped-preview-line" key={`${line}-${index}`}>{line}</span>
                  ))}
                </span>
              ) : (
                <span>{displayText}</span>
              )}
              {!readOnly && <i onPointerDown={(event) => handleResizeStart(event, field)} />}
            </button>
          );
        })}
        {mode === 'add' && !readOnly && (
          <div className="add-cursor">
            <Plus size={15} /> Click to add field
          </div>
        )}
        {mode === 'text' && !readOnly && (
          <div className="add-cursor">
            <Plus size={15} /> Click text to create field
          </div>
        )}
      </div>
    </div>
  );
}

export default function PdfWorkspace({
  pdfPath,
  fields,
  onFieldsChange,
  selectedFieldId,
  onSelectField,
  multiSelectedFieldIds = [],
  onToggleMultiSelect,
  mode = 'select',
  textTileMode = 'labels',
  entryMode = false,
  onEntryValueChange,
  readOnly = false,
  values = {}
}) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const wrapRef = useRef(null);
  const containerWidth = useContainerWidth(wrapRef);

  useEffect(() => {
    let cancelled = false;
    async function loadPdf() {
      try {
        setLoading(true);
        setError('');
        const bytes = await apiBinary(pdfPath);
        const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
        const loadedPages = [];
        for (let index = 1; index <= doc.numPages; index += 1) {
          const page = await doc.getPage(index);
          const viewport = page.getViewport({ scale: 1 });
          loadedPages.push({ page, pageNumber: index, width: viewport.width, height: viewport.height });
        }
        if (!cancelled) setPages(loadedPages);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadPdf();
    return () => {
      cancelled = true;
    };
  }, [pdfPath]);

  if (loading) return <div className="pdf-loading" role="status" aria-live="polite"><LoadingSpinner size="lg" label="Loading PDF..." /> <span>Loading PDF...</span></div>;
  if (error) return <div className="pdf-loading error">{error}</div>;

  return (
    <div className="pdf-workspace" ref={wrapRef}>
      {pages.map((page) => (
        <PdfPage
          key={page.pageNumber}
          {...page}
          containerWidth={containerWidth}
          fields={fields}
          onFieldsChange={onFieldsChange}
          selectedFieldId={selectedFieldId}
          onSelectField={onSelectField}
          multiSelectedFieldIds={multiSelectedFieldIds}
          onToggleMultiSelect={onToggleMultiSelect}
          mode={mode}
          textTileMode={textTileMode}
          entryMode={entryMode}
          onEntryValueChange={onEntryValueChange}
          readOnly={readOnly}
          values={values}
        />
      ))}
    </div>
  );
}
