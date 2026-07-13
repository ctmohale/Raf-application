import { useEffect, useState } from 'react';
import { Table2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { ButtonSpinner } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

export default function SpreadsheetMappingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [template, setTemplate] = useState(null);
  const [fields, setFields] = useState([]);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiRequest(`/api/templates/${id}`)
      .then((result) => {
        setTemplate(result.template);
        setFields(result.fields);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  async function previewSpreadsheet() {
    if (!file) return setError('Choose a CSV or Excel file');
    const formData = new FormData();
    formData.append('spreadsheet', file);
    setError('');
    setLoading(true);
    try {
      const result = await apiRequest(`/api/templates/${id}/spreadsheet/preview`, { method: 'POST', body: formData });
      setPreview(result);
      const autoMap = {};
      fields.forEach((field) => {
        const found = result.columns.find((column) => column.toLowerCase().replace(/[^a-z0-9]/g, '') === field.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
        autoMap[field.name] = found || '';
      });
      setMapping(autoMap);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function generateBulk() {
    if (!file) return setError('Choose a CSV or Excel file');
    const formData = new FormData();
    formData.append('spreadsheet', file);
    formData.append('mapping', JSON.stringify(mapping));
    setError('');
    setStatus('');
    setLoading(true);
    try {
      const result = await apiRequest(`/api/templates/${id}/generate/spreadsheet`, { method: 'POST', body: formData });
      setStatus(`Generated ${result.count} documents.`);
      if (result.documents[0]) navigate(`/documents/${result.documents[0].id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page-stack">
      <div className="section-header">
        <div>
          <h2>{template?.name || 'Spreadsheet mapping'}</h2>
          <p>Upload CSV or Excel data, map columns to fields, and generate PDFs in bulk.</p>
        </div>
      </div>

      <div className="two-column wide-left">
        <section className="panel form-stack">
          <label className="file-drop compact-drop">
            <Table2 size={24} />
            <span>{file ? file.name : 'Choose CSV or Excel file'}</span>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setPreview(null);
            }} />
          </label>
          <button className="secondary-button" onClick={previewSpreadsheet} disabled={loading}>
            {loading ? <ButtonSpinner label="Reading..." /> : 'Preview columns'}
          </button>
          <StatusMessage type="error">{error}</StatusMessage>
          <StatusMessage type="success">{status}</StatusMessage>
          {preview && (
            <div className="preview-table-wrap">
              <div className="panel-header">
                <h3>{preview.sheetName}</h3>
                <span>{preview.rowCount} rows</span>
              </div>
              <table className="responsive-preview-table">
                <thead>
                  <tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.sampleRows.map((row, index) => (
                    <tr key={index}>
                      {preview.columns.map((column) => <td key={column} data-label={column}>{String(row[column] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel form-stack">
          <div className="panel-header">
            <h3>Column mapping</h3>
            <span>{fields.length} fields</span>
          </div>
          {fields.map((field) => (
            <label key={field.id}>
              {field.label}
              <select value={mapping[field.name] || ''} onChange={(event) => setMapping((current) => ({ ...current, [field.name]: event.target.value }))}>
                <option value="">No column</option>
                {(preview?.columns || []).map((column) => <option value={column} key={column}>{column}</option>)}
              </select>
            </label>
          ))}
          <button className="primary-button" onClick={generateBulk} disabled={!preview || loading}>
            {loading ? <ButtonSpinner label="Generating..." /> : 'Generate bulk PDFs'}
          </button>
        </section>
      </div>
    </section>
  );
}
