import { useEffect, useMemo, useState } from 'react';
import { Combine, Highlighter, Save, Trash2, Ungroup } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { ButtonSpinner, PageLoader } from '../components/LoadingSpinner.jsx';
import PdfWorkspace from '../components/PdfWorkspace.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

const fieldTypes = [
  { value: 'text', label: 'text' },
  { value: 'number', label: 'number' },
  { value: 'date', label: 'date' },
  { value: 'checkbox', label: 'checkbox' },
  { value: 'select', label: 'select' },
  { value: 'signature', label: 'signature' },
  { value: 'repeatable', label: 'grouped input' }
];

function fieldTypeLabel(type) {
  return fieldTypes.find((fieldType) => fieldType.value === type)?.label || type;
}

function normalizeName(label, existingFields, fallback) {
  const base = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || `grouped_input_${fallback}`;
  const existingNames = new Set(existingFields.map((field) => field.name));
  let name = base;
  let suffix = 2;
  while (existingNames.has(name)) {
    name = `${base}_${suffix}`;
    suffix += 1;
  }
  return name;
}

function isGenericFieldLabel(label) {
  return /^field\s*\d+$/i.test(String(label || '').trim());
}

function findContextLabelForGroup(selectedFields, allFields) {
  const meaningfulSelected = selectedFields.find((field) => !isGenericFieldLabel(field.label));
  if (meaningfulSelected) return meaningfulSelected.label;

  const top = Math.min(...selectedFields.map((field) => Number(field.y)));
  const pageNumber = selectedFields[0]?.page_number;
  const selectedIds = new Set(selectedFields.map((field) => field.id));
  const candidates = allFields
    .filter((field) => (
      field.page_number === pageNumber
      && !selectedIds.has(field.id)
      && !isGenericFieldLabel(field.label)
      && Number(field.y) <= top + 8
    ))
    .sort((a, b) => Number(b.y) - Number(a.y));

  return candidates[0]?.label || selectedFields[0]?.label || 'Grouped input';
}

function groupedBoxesFromField(field) {
  const groupConfig = Array.isArray(field.options)
    ? field.options.find((option) => option && option.kind === 'grouped-input-boxes')
    : null;
  if (Array.isArray(groupConfig?.boxes) && groupConfig.boxes.length > 0) return groupConfig.boxes;
  return [{
    label: field.label,
    name: field.name,
    page_number: field.page_number,
    x: field.x,
    y: field.y,
    width: field.width,
    height: field.height,
    field_type: field.field_type
  }];
}

export default function TemplateEditorPage() {
  const { id } = useParams();
  const [template, setTemplate] = useState(null);
  const [fields, setFields] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState(null);
  const [mode, setMode] = useState('select');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [groupSelectionIds, setGroupSelectionIds] = useState([]);

  useEffect(() => {
    apiRequest(`/api/templates/${id}`)
      .then((result) => {
        setTemplate(result.template);
        setFields(result.fields);
        setSelectedFieldId(result.fields[0]?.id || null);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  const selectedField = useMemo(
    () => fields.find((field) => field.id === selectedFieldId),
    [fields, selectedFieldId]
  );
  const groupSelection = useMemo(
    () => fields.filter((field) => groupSelectionIds.includes(field.id)),
    [fields, groupSelectionIds]
  );
  const groupSelectionPage = groupSelection[0]?.page_number;
  const canGroupSelection = groupSelection.length >= 2 && groupSelection.every((field) => field.page_number === groupSelectionPage);

  function setSelectedField(fieldId) {
    setSelectedFieldId(fieldId);
  }

  function updateSelected(patch) {
    setFields((current) => current.map((field) => (
      field.id === selectedFieldId ? { ...field, ...patch } : field
    )));
  }

  function deleteSelected() {
    setFields((current) => current.filter((field) => field.id !== selectedFieldId));
    setGroupSelectionIds((current) => current.filter((fieldId) => fieldId !== selectedFieldId));
    setSelectedFieldId(null);
  }

  function removeCheckedFields() {
    if (groupSelectionIds.length === 0) {
      setError('Check fields first, then remove them.');
      return;
    }
    const selectedIds = new Set(groupSelectionIds);
    setFields((current) => current.filter((field) => !selectedIds.has(field.id)));
    setGroupSelectionIds([]);
    setSelectedFieldId((current) => (selectedIds.has(current) ? null : current));
    setStatus(`Removed ${selectedIds.size} checked field${selectedIds.size === 1 ? '' : 's'}.`);
    setError('');
  }

  function toggleGroupSelection(fieldId) {
    setGroupSelectionIds((current) => (
      current.includes(fieldId)
        ? current.filter((idValue) => idValue !== fieldId)
        : [...current, fieldId]
    ));
  }

  function groupSelectedFields() {
    setStatus('');
    setError('');
    const selectedFields = fields.filter((field) => groupSelectionIds.includes(field.id));
    if (selectedFields.length < 2) {
      setError('Select at least two fields to group.');
      return;
    }
    const pageNumber = selectedFields[0].page_number;
    if (!selectedFields.every((field) => field.page_number === pageNumber)) {
      setError('Grouped inputs must be on the same page.');
      return;
    }

    const ordered = [...selectedFields].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const childBoxes = ordered.flatMap(groupedBoxesFromField).sort((a, b) => (Number(a.y) - Number(b.y)) || (Number(a.x) - Number(b.x)));
    const x = Math.min(...childBoxes.map((field) => Number(field.x)));
    const y = Math.min(...childBoxes.map((field) => Number(field.y)));
    const right = Math.max(...childBoxes.map((field) => Number(field.x) + Number(field.width)));
    const bottom = Math.max(...childBoxes.map((field) => Number(field.y) + Number(field.height)));
    const remainingFields = fields.filter((field) => !groupSelectionIds.includes(field.id));
    const label = findContextLabelForGroup(ordered, fields);
    const groupedField = {
      ...ordered[0],
      id: `group-${Date.now()}`,
      name: normalizeName(label, remainingFields, fields.length + 1),
      label,
      page_number: pageNumber,
      x,
      y,
      width: Math.max(24, right - x),
      height: Math.max(32, bottom - y),
      field_type: 'repeatable',
      required: ordered.some((field) => Boolean(field.required)),
      default_value: ordered.map((field) => field.default_value || '').filter(Boolean).join('\n'),
      options: [{
        kind: 'grouped-input-boxes',
        boxes: childBoxes.map((field) => ({
          label: field.label,
          name: field.name,
          page_number: Number(field.page_number || pageNumber),
          x: Number(field.x),
          y: Number(field.y),
          width: Number(field.width),
          height: Number(field.height),
          field_type: field.field_type || 'text'
        }))
      }]
    };
    let inserted = false;
    const selectedIdSet = new Set(groupSelectionIds);
    const nextFields = [];
    for (const field of fields) {
      if (selectedIdSet.has(field.id)) {
        if (!inserted) {
          nextFields.push(groupedField);
          inserted = true;
        }
        continue;
      }
      nextFields.push(field);
    }

    setFields(nextFields);
    setSelectedFieldId(groupedField.id);
    setGroupSelectionIds([]);
    setStatus(`Grouped ${selectedFields.length} fields into one input.`);
  }

  function splitSelectedGroupedField() {
    if (!selectedField || selectedField.field_type !== 'repeatable') return;

    const savedBoxes = groupedBoxesFromField(selectedField);
    const defaultLines = String(selectedField.default_value || '').split(/\r?\n/).filter((line) => line.trim() !== '');
    const height = Math.max(32, Number(selectedField.height || 72));
    const fallbackLineCount = Math.max(defaultLines.length, Math.max(2, Math.min(12, Math.round(height / 26))));
    const fallbackStep = height / fallbackLineCount;
    const fallbackRowHeight = Math.max(18, Math.min(28, fallbackStep - 4));
    const boxes = savedBoxes.length > 1 ? savedBoxes : Array.from({ length: fallbackLineCount }, (_item, index) => ({
      ...selectedField,
      y: Number(selectedField.y) + (index * fallbackStep),
      height: fallbackRowHeight
    }));
    const remainingFields = fields.filter((field) => field.id !== selectedField.id);
    const splitFields = [];

    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      const label = boxes.length === 1 ? selectedField.label : `${selectedField.label} ${index + 1}`;
      const name = normalizeName(label, [...remainingFields, ...splitFields], fields.length + index + 1);
      splitFields.push({
        ...selectedField,
        id: `split-${Date.now()}-${index}`,
        name,
        label,
        page_number: Number(box.page_number || selectedField.page_number),
        x: Number(box.x),
        y: Number(box.y),
        width: Number(box.width),
        height: Number(box.height),
        field_type: 'text',
        required: Boolean(selectedField.required) && index === 0,
        default_value: defaultLines[index] || '',
        options: []
      });
    }

    const nextFields = [];
    fields.forEach((field) => {
      if (field.id === selectedField.id) nextFields.push(...splitFields);
      else nextFields.push(field);
    });

    setFields(nextFields);
    setSelectedFieldId(splitFields[0]?.id || null);
    setStatus(`Split grouped input into ${splitFields.length} individual fields.`);
  }

  async function saveFields() {
    setStatus('');
    setError('');
    setSaving(true);
    try {
      const result = await apiRequest(`/api/templates/${id}/fields`, {
        method: 'POST',
        body: { fields }
      });
      setFields(result.fields);
      setSelectedFieldId(result.fields[0]?.id || null);
      setGroupSelectionIds([]);
      setStatus('Template fields saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (error && !template) return <StatusMessage type="error">{error}</StatusMessage>;
  if (!template) return <PageLoader label="Loading template..." />;

  return (
    <section className="editor-layout">
      <div className="editor-main">
        <div className="editor-toolbar">
          <div>
            <span className="eyebrow">Template editor</span>
            <h2>{template.name}</h2>
          </div>
          <div className="toolbar-actions">
            <div className="segmented compact">
              <button className={mode === 'select' ? 'active' : ''} onClick={() => setMode('select')}>Select</button>
              <button className={mode === 'add' ? 'active' : ''} onClick={() => setMode('add')}>Add field</button>
              <button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}><Highlighter size={15} /> Text field</button>
            </div>
            <button className="primary-button" onClick={saveFields} disabled={saving}>
              {saving ? <ButtonSpinner label="Saving..." /> : <><Save size={16} /> Save fields</>}
            </button>
          </div>
        </div>
        <StatusMessage type="success">{status}</StatusMessage>
        <StatusMessage type="error">{error}</StatusMessage>
        <PdfWorkspace
          pdfPath={`/api/templates/${id}/pdf`}
          fields={fields}
          onFieldsChange={setFields}
          selectedFieldId={selectedFieldId}
          onSelectField={setSelectedField}
          multiSelectedFieldIds={groupSelectionIds}
          onToggleMultiSelect={toggleGroupSelection}
          mode={mode}
        />
      </div>

      <aside className="field-panel">
        <div className="panel-header">
          <h3>Fields</h3>
          <span>{fields.length}</span>
        </div>
        <div className="field-group-tools">
          <button className="secondary-button compact-button" type="button" onClick={groupSelectedFields} disabled={!canGroupSelection}>
            <Combine size={15} /> Group selected
          </button>
          <button className="danger-button compact-button" type="button" onClick={removeCheckedFields} disabled={groupSelection.length === 0}>
            <Trash2 size={15} /> Remove checked
          </button>
          <small>{groupSelection.length} selected</small>
        </div>
        <div className="field-list">
          {fields.map((field) => (
            <div
              key={field.id}
              className={`field-list-row ${field.id === selectedFieldId ? 'active' : ''} ${groupSelectionIds.includes(field.id) ? 'selected-for-group' : ''}`}
            >
              <label className="field-select-check">
                <input
                  type="checkbox"
                  checked={groupSelectionIds.includes(field.id)}
                  onChange={() => toggleGroupSelection(field.id)}
                  aria-label={`Select ${field.label} for grouping`}
                />
              </label>
              <button
                type="button"
                onClick={() => setSelectedField(field.id)}
              >
                <span>{field.label}</span>
                <small>
                  Page {field.page_number} · {fieldTypeLabel(field.field_type)}
                  {field.field_type === 'repeatable' ? <strong>Grouped input</strong> : null}
                </small>
              </button>
            </div>
          ))}
        </div>

        {selectedField ? (
          <div className="field-form">
            <label>
              Field name
              <input value={selectedField.name} onChange={(event) => updateSelected({ name: event.target.value })} />
            </label>
            <label>
              Label
              <input value={selectedField.label} onChange={(event) => updateSelected({ label: event.target.value })} />
            </label>
            <div className="form-grid">
              <label>
                Page
                <input type="number" min="1" value={selectedField.page_number} onChange={(event) => updateSelected({ page_number: Number(event.target.value) })} />
              </label>
              <label>
                Type
                <select value={selectedField.field_type} onChange={(event) => updateSelected({ field_type: event.target.value })}>
                  {fieldTypes.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}
                </select>
              </label>
            </div>
            <div className="form-grid">
              <label>
                X
                <input type="number" value={Math.round(selectedField.x)} onChange={(event) => updateSelected({ x: Number(event.target.value) })} />
              </label>
              <label>
                Y
                <input type="number" value={Math.round(selectedField.y)} onChange={(event) => updateSelected({ y: Number(event.target.value) })} />
              </label>
              <label>
                W
                <input type="number" value={Math.round(selectedField.width)} onChange={(event) => updateSelected({ width: Number(event.target.value) })} />
              </label>
              <label>
                H
                <input type="number" value={Math.round(selectedField.height)} onChange={(event) => updateSelected({ height: Number(event.target.value) })} />
              </label>
            </div>
            <label>
              Default value
              <input value={selectedField.default_value || ''} onChange={(event) => updateSelected({ default_value: event.target.value })} />
            </label>
            <label className="checkbox-line">
              <input type="checkbox" checked={Boolean(selectedField.required)} onChange={(event) => updateSelected({ required: event.target.checked })} />
              Required
            </label>
            {selectedField.field_type === 'repeatable' && (
              <button className="secondary-button" type="button" onClick={splitSelectedGroupedField}>
                <Ungroup size={16} /> Split grouped input
              </button>
            )}
            <button className="danger-button" onClick={deleteSelected}><Trash2 size={16} /> Delete field</button>
          </div>
        ) : (
          <p className="muted">Select a field, use Add field, or use Text field to click missing labels on the PDF.</p>
        )}

        <div className="panel-actions">
          <Link className="secondary-button" to={`/templates/${id}/form`}>Open generated form</Link>
          <Link className="secondary-button" to={`/templates/${id}/spreadsheet`}>Spreadsheet mapping</Link>
        </div>
      </aside>
    </section>
  );
}
