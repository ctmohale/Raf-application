import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardList, FileInput, FileText, Filter, Layers3, PencilRuler, Search, Table2, UploadCloud, X } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { ButtonSpinner, PageLoader } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

export default function TemplatesPage() {
  const { id: firmId } = useParams();
  const isFirmTemplates = Boolean(firmId);
  const [templates, setTemplates] = useState([]);
  const [firm, setFirm] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [error, setError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [message, setMessage] = useState('');
  const [pageLoading, setPageLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  function loadTemplates() {
    return apiRequest(isFirmTemplates ? `/api/firms/${firmId}/templates` : '/api/templates')
      .then((result) => {
        setTemplates(result.templates);
        setFirm(result.firm || null);
      });
  }

  useEffect(() => {
    setPageLoading(true);
    loadTemplates()
      .catch((err) => setError(err.message))
      .finally(() => setPageLoading(false));
  }, [firmId, isFirmTemplates]);

  const readyTemplates = templates.filter((template) => template.status === 'ready').length;
  const totalFields = templates.reduce((sum, template) => sum + Number(template.field_count || 0), 0);
  const totalPages = templates.reduce((sum, template) => sum + Number(template.page_count || 0), 0);
  const templateStatuses = [...new Set(templates.map((template) => template.status))];
  const filteredTemplates = templates.filter((template) => {
    const searchText = [
      template.name,
      template.original_filename,
      template.status
    ].filter(Boolean).join(' ').toLowerCase();

    const matchesSearch = searchText.includes(searchTerm.trim().toLowerCase());
    const matchesStatus = statusFilter === 'all' || template.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  function closeUploadModal() {
    setUploadModalOpen(false);
    setUploadName('');
    setUploadFile(null);
    setUploadError('');
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (!uploadFile) {
      setUploadError('Choose a PDF file');
      return;
    }

    const formData = new FormData();
    formData.append('name', uploadName);
    formData.append('pdf', uploadFile);

    setUploading(true);
    setUploadError('');
    setError('');
    setMessage('');

    try {
      const result = await apiRequest('/api/templates/upload', { method: 'POST', body: formData });
      setMessage(`${result.template.name} uploaded. ${result.detectedFields} fields detected.`);
      await loadTemplates();
      closeUploadModal();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  if (pageLoading && !error) return <PageLoader label="Loading templates..." />;

  return (
    <section className="page-stack">
      <div className="section-header">
        <div>
          <h2>{isFirmTemplates ? 'Firm templates' : 'Templates'}</h2>
          <p>{isFirmTemplates ? `Templates available to ${firm?.name || 'this firm'}.` : 'Reusable PDF templates with saved field positions and data mappings.'}</p>
        </div>
      </div>

      <StatusMessage type="error">{error}</StatusMessage>
      <StatusMessage type="success">{message}</StatusMessage>

      <div className="firm-stats template-stats">
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><FileText size={22} /></span>
            <strong>{templates.length}</strong>
          </div>
          <div className="metric-body">
            <span>Total templates</span>
          </div>
          <small>Uploaded reusable PDF templates</small>
        </div>
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><CheckCircle2 size={22} /></span>
            <strong>{readyTemplates}</strong>
          </div>
          <div className="metric-body">
            <span>Ready</span>
          </div>
          <small>Templates ready for generation</small>
        </div>
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><PencilRuler size={22} /></span>
            <strong>{totalFields}</strong>
          </div>
          <div className="metric-body">
            <span>Fields mapped</span>
          </div>
          <small>Detected and positioned fields</small>
        </div>
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><Layers3 size={22} /></span>
            <strong>{totalPages}</strong>
          </div>
          <div className="metric-body">
            <span>Pages stored</span>
          </div>
          <small>Total pages across templates</small>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header firm-table-header">
          <div>
            <h3>All templates</h3>
            <p>Complete template records from the workspace.</p>
          </div>
          <div className="firm-table-tools">
            <label className="table-search" aria-label="Search templates">
              <Search size={16} />
              <input
                type="search"
                placeholder="Search templates"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>
            <label className="table-filter" aria-label="Filter templates by status">
              <Filter size={16} />
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All status</option>
                {templateStatuses.map((status) => (
                  <option value={status} key={status}>{status.replace('_', ' ')}</option>
                ))}
              </select>
            </label>
            {!isFirmTemplates && <button className="primary-button" type="button" onClick={() => setUploadModalOpen(true)}><UploadCloud size={17} /> Upload template</button>}
          </div>
        </div>
        {templates.length === 0 && (
          <div className="empty-state">
            <UploadCloud size={28} />
            <h3>No templates yet</h3>
            <p>Upload a standard PDF to start defining reusable fields.</p>
            {!isFirmTemplates && <button className="primary-button" type="button" onClick={() => setUploadModalOpen(true)}>Upload PDF</button>}
          </div>
        )}
        {templates.length > 0 && filteredTemplates.length === 0 && <p className="muted table-empty-text">No templates match the selected filters.</p>}
        {filteredTemplates.length > 0 && (
          <div className="firm-table-wrap template-table-wrap">
            <table className="firm-table template-table">
              <thead>
                <tr>
                  <th>Template</th>
                  <th>Pages</th>
                  <th>Fields</th>
                  <th>Status</th>
                  <th>Created</th>
                  {!isFirmTemplates && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredTemplates.map((template) => (
                  <tr key={template.id}>
                    <td>
                      <strong>{template.name}</strong>
                      <span>{template.original_filename}</span>
                    </td>
                    <td>{template.page_count}</td>
                    <td>{template.field_count}</td>
                    <td><span className={`status-pill ${template.status}`}>{template.status.replace('_', ' ')}</span></td>
                    <td>{new Date(template.created_at).toLocaleDateString()}</td>
                    {!isFirmTemplates && <td>
                      <div className="table-actions">
                        <Link to={`/templates/${template.id}/edit`} title="Edit fields" aria-label={`Edit fields for ${template.name}`}>
                          <PencilRuler size={15} />
                        </Link>
                        <Link to={`/templates/${template.id}/form`} title="Open form" aria-label={`Open form for ${template.name}`}>
                          <FileInput size={15} />
                        </Link>
                        <Link to={`/templates/${template.id}/spreadsheet`} title="Spreadsheet mapping" aria-label={`Spreadsheet mapping for ${template.name}`}>
                          <Table2 size={15} />
                        </Link>
                        <Link to={`/templates/${template.id}/form`} title="Generate document" aria-label={`Generate document from ${template.name}`}>
                          <ClipboardList size={15} />
                        </Link>
                      </div>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {uploadModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="upload-template-title">
            <div className="modal-header">
              <div>
                <h3 id="upload-template-title">Upload template</h3>
                <p>Store an original PDF, run local layout detection, then confirm fields once.</p>
              </div>
              <button className="icon-button ghost" type="button" onClick={closeUploadModal} aria-label="Close modal">
                <X size={18} />
              </button>
            </div>

            <form className="form-stack firm-form" onSubmit={handleUpload}>
              <label>
                Template name
                <input value={uploadName} onChange={(event) => setUploadName(event.target.value)} placeholder="Client intake form" />
              </label>
              <label className="file-drop compact-drop">
                <UploadCloud size={28} />
                <span>{uploadFile ? uploadFile.name : 'Choose PDF template'}</span>
                <input type="file" accept="application/pdf,.pdf" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} />
              </label>
              <StatusMessage type="error">{uploadError}</StatusMessage>
              <div className="modal-actions">
                <button className="secondary-button" type="button" onClick={closeUploadModal}>Cancel</button>
                <button className="primary-button" disabled={uploading}>
                  {uploading ? <ButtonSpinner label="Uploading..." /> : <UploadCloud size={17} />}
                  {!uploading && 'Upload and detect fields'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
