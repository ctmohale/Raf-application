import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ButtonSpinner, PageLoader } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';
import { distributeGroupedText, getGroupedFieldBoxes, getUpdatedGroupedInputValue, groupedInputCount, normalizeDateInputValue, normalizeGroupedText } from '../lib/templateFieldHelpers.js';

function inputForField(field, value, onChange) {
  if (field.field_type === 'checkbox') {
    return (
      <label className="checkbox-line">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        {field.label}
      </label>
    );
  }

  if (field.field_type === 'select') {
    return (
      <select value={value || ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select...</option>
        {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }

  if (field.field_type === 'repeatable') {
    const textValue = normalizeGroupedText(value);
    const groupedBoxes = getGroupedFieldBoxes(field);
    const inputCount = groupedInputCount(field, textValue);
    const lines = distributeGroupedText(textValue, groupedBoxes, inputCount);

    function updateLine(index, nextValue) {
      onChange(getUpdatedGroupedInputValue(textValue, index, nextValue, inputCount, groupedBoxes));
    }

    return (
      <div className="repeatable-field grouped-input-fields">
        <span className="grouped-input-title">{field.label}{field.required ? ' *' : ''}</span>
        {lines.slice(0, inputCount).map((line, index) => (
          <label className="grouped-input-line" key={`${field.id}-${index}`}>
            {index === 0 ? <span>{field.label}</span> : null}
            <input
              type="text"
              aria-label={`${field.label} ${index + 1}`}
              value={line}
              onChange={(event) => updateLine(index, event.target.value)}
            />
          </label>
        ))}
      </div>
    );
  }

  const inputProps = field.field_type === 'date'
    ? { type: 'date', value: normalizeDateInputValue(value) }
    : field.field_type === 'number'
      ? { type: 'text', inputMode: 'decimal', value: value || '' }
      : { type: 'text', value: value || '' };
  return <input {...inputProps} onChange={(event) => onChange(event.target.value)} />;
}

export default function DataEntryFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [template, setTemplate] = useState(null);
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiRequest(`/api/templates/${id}`)
      .then((result) => {
        setTemplate(result.template);
        setFields(result.fields);
        const defaults = {};
        result.fields.forEach((field) => {
          if (field.field_type === 'checkbox') {
            defaults[field.name] = false;
          } else if (field.field_type === 'repeatable') {
            defaults[field.name] = field.default_value || '';
          } else {
            defaults[field.name] = field.default_value || '';
          }
        });
        setValues(defaults);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest(`/api/templates/${id}/generate/form`, {
        method: 'POST',
        body: { data: values }
      });
      navigate(`/documents/${result.document.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!template && !error) return <PageLoader label="Loading form..." />;

  return (
    <section className="page-stack narrow">
      <div className="section-header">
        <div>
          <h2>{template?.name}</h2>
          <p>Generated custom form from saved template fields.</p>
        </div>
      </div>
      <StatusMessage type="error">{error}</StatusMessage>
      {template && (
        <form className="panel form-stack" onSubmit={handleSubmit}>
          {fields.map((field) => {
            const input = inputForField(field, values[field.name], (value) => setValues((current) => ({ ...current, [field.name]: value })));
            if (field.field_type === 'checkbox' || field.field_type === 'repeatable') {
              return <div key={field.id}>{input}</div>;
            }
            return (
              <label key={field.id}>
                <span>{field.label}{field.required ? ' *' : ''}</span>
                {input}
              </label>
            );
          })}
          <button className="primary-button" disabled={loading || fields.length === 0}>
            {loading ? <ButtonSpinner label="Generating..." /> : 'Generate filled PDF'}
          </button>
        </form>
      )}
    </section>
  );
}
