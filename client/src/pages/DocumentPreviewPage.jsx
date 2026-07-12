import { useEffect, useState } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { PageLoader } from '../components/LoadingSpinner.jsx';
import PdfWorkspace from '../components/PdfWorkspace.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest, downloadDocument } from '../lib/api.js';

export default function DocumentPreviewPage() {
  const { id } = useParams();
  const [document, setDocument] = useState(null);
  const [fields, setFields] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest(`/api/documents/${id}`)
      .then((result) => {
        setDocument(result.document);
        setFields(result.fields);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) return <StatusMessage type="error">{error}</StatusMessage>;
  if (!document) return <PageLoader label="Loading document..." />;

  return (
    <section className="page-stack">
      <div className="section-header">
        <div>
          <h2>{document.file_name}</h2>
          <p>Review filled field placement before downloading.</p>
        </div>
        <div className="toolbar-actions">
          <Link className="secondary-button" to={`/templates/${document.template_id}/form`}><RotateCcw size={16} /> Regenerate</Link>
          <button className="primary-button" onClick={() => downloadDocument(document.id, document.file_name)}><Download size={16} /> Download PDF</button>
        </div>
      </div>
      <PdfWorkspace
        pdfPath={`/api/documents/${id}/download?inline=1`}
        fields={fields}
        onFieldsChange={() => {}}
        selectedFieldId={null}
        onSelectField={() => {}}
        readOnly
        values={document.input}
      />
    </section>
  );
}
