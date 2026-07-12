import { useEffect, useState } from 'react';
import { Download, Eye, FileCheck2, FileText, Filter, Search, Table2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { PageLoader } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest, downloadDocument } from '../lib/api.js';

export default function DocumentsPage() {
  const { id: firmId } = useParams();
  const isFirmDocuments = Boolean(firmId);
  const [documents, setDocuments] = useState([]);
  const [firm, setFirm] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [error, setError] = useState('');
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    setPageLoading(true);
    apiRequest(isFirmDocuments ? `/api/firms/${firmId}/documents` : '/api/documents')
      .then((result) => {
        setDocuments(result.documents);
        setFirm(result.firm || null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setPageLoading(false));
  }, [firmId, isFirmDocuments]);

  const sourceTypes = [...new Set(documents.map((doc) => doc.source_type))];
  const filteredDocuments = documents.filter((doc) => {
    const searchText = [
      doc.file_name,
      doc.template_name,
      doc.source_type
    ].filter(Boolean).join(' ').toLowerCase();

    const matchesSearch = searchText.includes(searchTerm.trim().toLowerCase());
    const matchesSource = sourceFilter === 'all' || doc.source_type === sourceFilter;
    return matchesSearch && matchesSource;
  });
  const templateCount = new Set(documents.map((doc) => doc.template_id)).size;
  const formCount = documents.filter((doc) => doc.source_type === 'form').length;
  const spreadsheetCount = documents.filter((doc) => doc.source_type === 'spreadsheet').length;

  if (pageLoading && !error) return <PageLoader label="Loading documents..." />;

  return (
    <section className="page-stack">
      <div className="section-header">
        <div>
          <h2>{isFirmDocuments ? 'Firm documents' : 'Generated documents'}</h2>
          <p>{isFirmDocuments ? `Document records for ${firm?.name || 'this firm'}.` : 'Preview, confirm, and download filled PDFs.'}</p>
        </div>
      </div>
      <StatusMessage type="error">{error}</StatusMessage>

      <div className="firm-stats document-stats">
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><FileText size={22} /></span>
            <strong>{documents.length}</strong>
          </div>
          <div className="metric-body">
            <span>Total documents</span>
          </div>
          <small>Generated filled PDFs</small>
        </div>
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><FileCheck2 size={22} /></span>
            <strong>{formCount}</strong>
          </div>
          <div className="metric-body">
            <span>Form generated</span>
          </div>
          <small>Created from manual forms</small>
        </div>
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><Table2 size={22} /></span>
            <strong>{spreadsheetCount}</strong>
          </div>
          <div className="metric-body">
            <span>Spreadsheet</span>
          </div>
          <small>Created from spreadsheet data</small>
        </div>
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><FileText size={22} /></span>
            <strong>{templateCount}</strong>
          </div>
          <div className="metric-body">
            <span>Templates used</span>
          </div>
          <small>Unique source templates</small>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header firm-table-header">
          <div>
            <h3>All generated documents</h3>
            <p>Complete generated document records from the workspace.</p>
          </div>
          <div className="firm-table-tools">
            <label className="table-search" aria-label="Search generated documents">
              <Search size={16} />
              <input
                type="search"
                placeholder="Search documents"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>
            <label className="table-filter" aria-label="Filter documents by source">
              <Filter size={16} />
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                <option value="all">All sources</option>
                {sourceTypes.map((source) => (
                  <option value={source} key={source}>{source}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="firm-table-wrap document-table-wrap">
          {documents.length === 0 && <p className="muted">No generated documents yet.</p>}
          {documents.length > 0 && filteredDocuments.length === 0 && <p className="muted">No documents match the selected filters.</p>}
          {filteredDocuments.length > 0 && (
            <table className="firm-table document-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Template</th>
                  <th>Source</th>
                  <th>Generated</th>
                  <th>Status</th>
                  {!isFirmDocuments && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredDocuments.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <strong>{doc.file_name}</strong>
                      <span>Document #{doc.id}</span>
                    </td>
                    <td>{doc.template_name}</td>
                    <td>{doc.source_type}</td>
                    <td>{new Date(doc.created_at).toLocaleString()}</td>
                    <td><span className={`status-pill ${doc.status}`}>{doc.status}</span></td>
                    {!isFirmDocuments && <td>
                      <div className="table-actions">
                        <Link to={`/documents/${doc.id}`} title="Preview document" aria-label={`Preview ${doc.file_name}`}>
                          <Eye size={15} />
                        </Link>
                        <button type="button" onClick={() => downloadDocument(doc.id, doc.file_name)} title="Download document" aria-label={`Download ${doc.file_name}`}>
                          <Download size={15} />
                        </button>
                      </div>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </section>
  );
}
