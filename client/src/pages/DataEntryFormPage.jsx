import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ButtonSpinner, PageLoader } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

function groupedInputCount(field, value) {
  const filledLines = String(Array.isArray(value) ? value.join('\n') : value || '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .length;
  const heightCount = Math.round(Number(field.height || 72) / 26);
  return Math.max(filledLines, Math.max(2, Math.min(12, heightCount)));
}

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
      <select value={value || ''} onChange={(event) => onChange(event.target.value)} required={field.required}>
        <option value="">Select...</option>
        {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }

  if (field.field_type === 'repeatable') {
    const textValue = Array.isArray(value) ? value.join('\n') : String(value || '');
    const inputCount = groupedInputCount(field, textValue);
    const lines = textValue.split(/\r?\n/);
    while (lines.length < inputCount) lines.push('');

    function updateLine(index, nextValue) {
      const nextLines = [...lines];
      nextLines[index] = nextValue;
      onChange(nextLines.join('\n'));
    }

    return (
      <div className="repeatable-field grouped-input-fields">
        <span className="grouped-input-title">{field.label}{field.required ? ' *' : ''}</span>
        {lines.slice(0, inputCount).map((line, index) => (
          <label className="grouped-input-line" key={`${field.id}-${index}`}>
            <span>{field.label} {index + 1}</span>
            <input
              type="text"
              value={line}
              onChange={(event) => updateLine(index, event.target.value)}
              required={field.required && index === 0}
            />
          </label>
        ))}
      </div>
    );
  }

  const type = field.field_type === 'date' ? 'date' : field.field_type === 'number' ? 'number' : 'text';
  return <input type={type} value={value || ''} onChange={(event) => onChange(event.target.value)} required={field.required} />;
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
