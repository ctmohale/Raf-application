import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, CircleDashed, FileText, FileUp, FolderOpen, Maximize2, Minimize2, Minus, Plus, Save, UploadCloud, X } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ButtonSpinner } from '../components/LoadingSpinner.jsx';
import PdfWorkspace from '../components/PdfWorkspace.jsx';
import SignatureInput from '../components/SignatureInput.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';
import { buildTemplateInputPreview, getUpdatedGroupedInputValue, scaleGroupedBoxesForRenderedField } from '../lib/templateFieldHelpers.js';

function isVisibleDocumentRequest(request) {
  return String(request?.label || '').trim().toLowerCase() !== 'medical report';
}

function claimFormOptionLabel(form) {
  return `${form.template?.name || form.document?.file_name || 'Attached template'} - ${form.case_reference}`;
}

function hasTemplateInputValue(value) {
  if (Array.isArray(value)) return value.some(hasTemplateInputValue);
  if (value && typeof value === 'object') return Object.values(value).some(hasTemplateInputValue);
  if (typeof value === 'boolean') return value;
  return value != null && String(value).trim() !== '';
}

function templateValueKey(field) {
  const label = String(field?.label || '').trim().toLowerCase();
  const name = String(field?.name || '').trim().toLowerCase();
  if (label.includes('signature') || name.includes('signature') || label === 'signed' || /^signed(_\d+)?$/.test(name)) {
    return `${field.name}__field_${field.id}`;
  }
  return field.name;
}

function ClientPortalLoader() {
  return (
    <main className="client-upload-page">
      <section className="client-upload-panel client-upload-loader" role="status" aria-live="polite">
        <div className="auth-brand">
          <div className="brand-mark large"><FileUp size={28} /></div>
          <div>
            <span className="eyebrow">Client document upload</span>
            <h1>Preparing your document workspace</h1>
          </div>
        </div>
        <div className="advanced-loader">
          <span className="advanced-loader-ring" aria-hidden="true" />
          <div>
            <strong>Loading claim data</strong>
            <p>Checking attached templates, requested documents, and upload status.</p>
          </div>
        </div>
        <div className="client-loader-skeleton">
          {[1, 2, 3, 4].map((item) => (
            <div className="client-loader-card" key={item}>
              <span />
              <div>
                <i />
                <i />
              </div>
              <em />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default function ClientUploadPage() {
  const { token } = useParams();
  const fileInputRefs = useRef({});
  const [portal, setPortal] = useState(null);
  const [files, setFiles] = useState({});
  const [activeClaimFormId, setActiveClaimFormId] = useState('');
  const [claimFormValues, setClaimFormValues] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [uploadingId, setUploadingId] = useState(null);
  const [savingClaimForm, setSavingClaimForm] = useState(false);
  const [loadingPortal, setLoadingPortal] = useState(true);
  const [collapsedCards, setCollapsedCards] = useState({});
  const [templateFullscreen, setTemplateFullscreen] = useState(false);
  const [templateZoom, setTemplateZoom] = useState(1);
  const [editingSignatureField, setEditingSignatureField] = useState(null);

  async function loadPortal() {
    setLoadingPortal(true);
    try {
      const result = await apiRequest(`/api/client-portal/${token}`);
      applyPortal(result);
      return result;
    } finally {
      setLoadingPortal(false);
    }
  }

  function applyPortal(result) {
    setPortal(result);
    setActiveClaimFormId((current) => {
      const forms = result.claimForms || [];
      return forms.some((form) => String(form.id) === String(current)) ? current : forms[0]?.id ? String(forms[0].id) : '';
    });
  }

  function updateClaimFormField(field, value) {
    if (value === '__open_signature_pad__') {
      setEditingSignatureField(field);
      return;
    }
    const valueKey = field.source_value_key || field.name;
    if (Number.isInteger(field.source_line_index)) {
      setClaimFormValues((current) => {
        const count = Math.max(Number(field.source_line_count || 0), field.source_line_index + 1);
        return {
          ...current,
          [valueKey]: getUpdatedGroupedInputValue(
            current[valueKey],
            field.source_line_index,
            value,
            count,
            scaleGroupedBoxesForRenderedField(field)
          )
        };
      });
      return;
    }
    setClaimFormValues((current) => ({ ...current, [valueKey]: value }));
  }

  function signatureValueKey(field) {
    return `${field.name}__field_${field.id}`;
  }

  function updateSignatureValue(value) {
    if (!editingSignatureField) return;
    setClaimFormValues((current) => ({
      ...current,
      [signatureValueKey(editingSignatureField)]: value
    }));
  }

  function chooseDocumentFile(requestId) {
    fileInputRefs.current[requestId]?.click();
  }

  function toggleCard(card) {
    setCollapsedCards((current) => {
      const nextCollapsed = !current[card];
      if (card === 'templates' && nextCollapsed) setTemplateFullscreen(false);
      return { ...current, [card]: nextCollapsed };
    });
  }

  function isCardCollapsed(card) {
    return Boolean(collapsedCards[card]);
  }

  useEffect(() => {
    loadPortal().catch((err) => setError(err.message));
  }, [token]);

  const claimForms = portal?.claimForms || [];
  const activeClaimForm = claimForms.find((form) => String(form.id) === String(activeClaimFormId)) || null;
  const canViewTemplates = portal?.portal_permissions?.template_view_enabled !== false;
  const canEditTemplates = canViewTemplates && portal?.portal_permissions?.template_inputs_enabled !== false;
  const activeTemplatePreview = useMemo(() => (
    activeClaimForm?.template
      ? buildTemplateInputPreview(activeClaimForm.template.fields || [], claimFormValues)
      : { fields: [], values: claimFormValues }
  ), [activeClaimForm?.id, activeClaimForm?.template, claimFormValues]);
  const templateProgress = useMemo(() => {
    const fields = activeClaimForm?.template?.fields || [];
    const fillableFields = fields.filter((field) => field.field_type !== 'checkbox' || field.required);
    const total = fillableFields.length;
    const filled = fillableFields.filter((field) => {
      const key = templateValueKey(field);
      return hasTemplateInputValue(claimFormValues[key] ?? claimFormValues[field.name]);
    }).length;
    return {
      filled,
      total,
      missing: Math.max(0, total - filled),
      percent: total ? Math.round((filled / total) * 100) : 0
    };
  }, [activeClaimForm?.template, claimFormValues]);

  useEffect(() => {
    setClaimFormValues(activeClaimForm?.document?.input || {});
    setTemplateZoom(1);
  }, [activeClaimForm?.id, activeClaimForm?.document?.id]);

  async function uploadDocument(requestId) {
    const file = files[requestId];
    if (!file) {
      setError('Choose a file before uploading');
      return;
    }

    const body = new FormData();
    body.append('document', file);
    setUploadingId(requestId);
    setError('');
    setMessage('');

    try {
      const result = await apiRequest(`/api/client-portal/${token}/requests/${requestId}/upload`, { method: 'POST', body });
      applyPortal(result);
      setFiles((current) => ({ ...current, [requestId]: null }));
      setMessage('Document uploaded successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingId(null);
    }
  }

  async function saveClaimForm(event) {
    event.preventDefault();
    if (!activeClaimForm || !canEditTemplates) return;
    setSavingClaimForm(true);
    setError('');
    setMessage('');

    try {
      const result = await apiRequest(`/api/client-portal/${token}/forms/${activeClaimForm.id}`, {
        method: 'PATCH',
        body: { data: claimFormValues }
      });
      applyPortal(result);
      setMessage(`${activeClaimForm.template?.name || 'Template'} saved successfully.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingClaimForm(false);
    }
  }

  if (loadingPortal && !portal && !error) return <ClientPortalLoader />;
  const visibleRequests = portal?.requests?.filter(isVisibleDocumentRequest) || [];
  const uploadedCount = visibleRequests.filter((request) => request.status === 'uploaded' || request.original_filename).length;
  const requestCount = visibleRequests.length;
  const uploadProgress = requestCount ? Math.round((uploadedCount / requestCount) * 100) : 0;

  return (
    <main className="client-upload-page">
      <section className="client-upload-panel">
        <div className="client-upload-header">
          <div className="auth-brand">
            <div className="brand-mark large"><FileUp size={28} /></div>
            <div>
              <span className="eyebrow">Client document upload</span>
              <h1>{portal?.firm?.name || 'Upload portal'}</h1>
            </div>
          </div>
          {portal && (
            <div className="client-upload-intro">
              <h2>{portal.client.first_name} {portal.client.surname}</h2>
              <p>Forms and uploads</p>
            </div>
          )}
        </div>

        <StatusMessage type="error">{error}</StatusMessage>
        <StatusMessage type="success">{message}</StatusMessage>

        {portal && (
          <>
            {canViewTemplates && <form className={`client-documents-panel client-template-panel client-collapsible-card ${isCardCollapsed('templates') ? 'collapsed' : ''} ${templateFullscreen ? 'fullscreen' : ''}`} onSubmit={saveClaimForm}>
              <div className="client-documents-header">
                <div>
                  <span className="eyebrow">Attached templates</span>
                  <h3>Claim forms</h3>
                  {activeClaimForm?.template && (
                    <div className="client-template-progress" aria-label={`${templateProgress.percent}% complete`}>
                      <strong>{templateProgress.percent}%</strong>
                      <span>{templateProgress.filled}/{templateProgress.total || 0} done</span>
                      <em>{templateProgress.missing} missing</em>
                    </div>
                  )}
                </div>
                <div className="client-card-actions">
                  {claimForms.length > 0 && (
                    <label className="client-template-picker" title="Select template">
                      <FileText size={16} />
                      <select value={activeClaimFormId} onChange={(event) => setActiveClaimFormId(event.target.value)} aria-label="Select attached template">
                        {claimForms.map((form) => (
                          <option value={String(form.id)} key={form.id}>
                            {claimFormOptionLabel(form)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {canEditTemplates && (
                    <button className="primary-button" type="submit" disabled={savingClaimForm || !activeClaimForm}>
                      <Save size={17} />
                      {savingClaimForm ? <ButtonSpinner label="Saving..." /> : 'Save template'}
                    </button>
                  )}
                  {activeClaimForm?.template && !isCardCollapsed('templates') && (
                    <div className="client-template-zoom" aria-label="Template zoom controls">
                      <button
                        className="icon-button ghost"
                        type="button"
                        onClick={() => setTemplateZoom((current) => Math.max(0.7, Number((current - 0.1).toFixed(2))))}
                        aria-label="Zoom out"
                        title="Zoom out"
                      >
                        <Minus size={16} />
                      </button>
                      <button
                        className="template-zoom-value"
                        type="button"
                        onClick={() => setTemplateZoom(1)}
                        aria-label="Reset zoom"
                        title="Reset zoom"
                      >
                        {Math.round(templateZoom * 100)}%
                      </button>
                      <button
                        className="icon-button ghost"
                        type="button"
                        onClick={() => setTemplateZoom((current) => Math.min(1.8, Number((current + 0.1).toFixed(2))))}
                        aria-label="Zoom in"
                        title="Zoom in"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  )}
                  {activeClaimForm?.template && !isCardCollapsed('templates') && (
                    <button
                      className="icon-button ghost"
                      type="button"
                      onClick={() => setTemplateFullscreen((current) => !current)}
                      aria-label={templateFullscreen ? 'Exit template full screen' : 'View template full screen'}
                      title={templateFullscreen ? 'Exit full screen' : 'View full screen'}
                    >
                      {templateFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                    </button>
                  )}
                  <button
                    className="icon-button ghost client-collapse-button"
                    type="button"
                    onClick={() => toggleCard('templates')}
                    aria-expanded={!isCardCollapsed('templates')}
                    aria-label={isCardCollapsed('templates') ? 'Expand attached templates' : 'Collapse attached templates'}
                    title={isCardCollapsed('templates') ? 'Expand' : 'Collapse'}
                  >
                    <ChevronDown size={17} />
                  </button>
                </div>
              </div>

              <div className="client-card-body client-template-body" hidden={isCardCollapsed('templates')}>
                {claimForms.length > 0 ? (
                  <>
                  {activeClaimForm?.template && (
                    <div className="client-template-preview medical-template-preview">
                      <PdfWorkspace
                        className="client-fit-pdf-workspace"
                        pdfPath={`/api/client-portal/${token}/forms/${activeClaimForm.id}/template/pdf`}
                        fields={activeTemplatePreview.fields}
                        onFieldsChange={() => {}}
                        selectedFieldId={null}
                        onSelectField={() => {}}
                        entryMode={canEditTemplates}
                        readOnly={!canEditTemplates}
                        onEntryValueChange={updateClaimFormField}
                        values={activeTemplatePreview.values}
                        minScale={0.25}
                        fitPadding={8}
                        zoom={templateZoom}
                      />
                    </div>
                  )}
                  </>
                ) : (
                  <p className="muted">No template forms are attached to your claim yet.</p>
                )}
                {editingSignatureField && (
                  <div className="signature-draw-popover" role="dialog" aria-modal="true" aria-label={`Draw ${editingSignatureField.label}`}>
                    <div className="signature-draw-panel">
                      <div className="signature-draw-header">
                        <div>
                          <strong>{editingSignatureField.label}</strong>
                          <span>Handwritten signature</span>
                        </div>
                        <button className="icon-button ghost" type="button" onClick={() => setEditingSignatureField(null)} aria-label="Close signature pad">
                          <X size={18} />
                        </button>
                      </div>
                      <SignatureInput
                        id={`client-template-signature-${editingSignatureField.id}`}
                        value={String(claimFormValues[signatureValueKey(editingSignatureField)] || claimFormValues[editingSignatureField.name] || '')}
                        onChange={updateSignatureValue}
                      />
                      <div className="signature-draw-actions">
                        <button className="primary-button" type="button" onClick={() => setEditingSignatureField(null)}>Done</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </form>}

            <section className={`client-documents-panel client-collapsible-card ${isCardCollapsed('documents') ? 'collapsed' : ''}`}>
              <div className="client-documents-header">
                <div>
                  <span className="eyebrow">Supporting documents</span>
                  <h3>Upload checklist</h3>
                  <p>{uploadedCount} of {requestCount} document(s) received by the law firm.</p>
                </div>
                <div className="client-card-actions">
                  <div className="client-upload-progress" aria-label={`${uploadProgress}% complete`}>
                    <strong>{uploadProgress}%</strong>
                    <span>complete</span>
                  </div>
                  <button
                    className="icon-button ghost client-collapse-button"
                    type="button"
                    onClick={() => toggleCard('documents')}
                    aria-expanded={!isCardCollapsed('documents')}
                    aria-label={isCardCollapsed('documents') ? 'Expand supporting documents' : 'Collapse supporting documents'}
                    title={isCardCollapsed('documents') ? 'Expand' : 'Collapse'}
                  >
                    <ChevronDown size={17} />
                  </button>
                </div>
              </div>
              <div className="client-card-body" hidden={isCardCollapsed('documents')}>
                <div className="client-upload-progress-bar" aria-hidden="true">
                  <i style={{ width: `${uploadProgress}%` }} />
                </div>

                <div className="client-request-list">
                  {visibleRequests.map((request) => (
                    <article className={`client-request-card ${request.status === 'uploaded' ? 'uploaded' : ''} ${files[request.id] ? 'ready' : ''}`} key={request.id}>
                      <span className="client-request-icon" aria-hidden="true">
                        {request.status === 'uploaded' ? <CheckCircle2 size={18} /> : <FolderOpen size={18} />}
                      </span>
                      <div className="client-request-copy">
                        <div className="client-request-title-row">
                          <h3>{request.label}</h3>
                        </div>
                        {request.instructions && <p className="client-request-guidance">{request.instructions}</p>}
                        <p>{request.original_filename ? `${request.upload_count || 1} file(s) received · Latest: ${request.original_filename}` : 'PDF, image, or Word file. Upload additional files one at a time.'}</p>
                        {request.ai_status === 'completed' && <p>AI extraction complete. The claim record and attached forms were updated from verified fields.</p>}
                        {request.ai_status === 'failed' && <p>The file was received, but AI extraction needs staff review.</p>}
                        <div className="client-selected-file-row">
                          <div className={`client-selected-file ${files[request.id] ? 'ready' : ''}`} title={files[request.id]?.name || 'No file selected yet'}>
                            {files[request.id] ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}
                            <span>{files[request.id]?.name || 'No file selected yet'}</span>
                          </div>
                        </div>
                      </div>
                      <div className="client-request-actions">
                        {!files[request.id] && (
                          <span className={`client-request-status ${request.status === 'uploaded' ? 'active' : 'pending'}`}>
                            {request.status === 'uploaded' ? 'Received' : 'Requested'}
                          </span>
                        )}
                        <button className="secondary-button file-picker-button" type="button" onClick={() => chooseDocumentFile(request.id)}>
                          {files[request.id] ? 'Change' : 'Choose file'}
                        </button>
                        <input
                          className="file-picker-input"
                          id={`client-document-input-${request.id}`}
                          ref={(node) => {
                            if (node) fileInputRefs.current[request.id] = node;
                            else delete fileInputRefs.current[request.id];
                          }}
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                          onChange={(event) => setFiles((current) => ({ ...current, [request.id]: event.target.files?.[0] || null }))}
                        />
                        <button className={`primary-button ${files[request.id] ? 'success-button' : ''}`} type="button" disabled={uploadingId === request.id || !files[request.id]} onClick={() => uploadDocument(request.id)}>
                          <UploadCloud size={17} />
                          {uploadingId === request.id ? <ButtonSpinner label="Uploading..." /> : request.status === 'uploaded' ? 'Upload another' : 'Upload'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
