import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, CircleDashed, FileText, FileUp, FolderOpen, Maximize2, Minimize2, Save, UploadCloud, X } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ButtonSpinner } from '../components/LoadingSpinner.jsx';
import PdfWorkspace from '../components/PdfWorkspace.jsx';
import SignatureInput from '../components/SignatureInput.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

function isVisibleDocumentRequest(request) {
  return String(request?.label || '').trim().toLowerCase() !== 'medical report';
}

function claimFormOptionLabel(form) {
  return `${form.template?.name || form.document?.file_name || 'Attached template'} - ${form.case_reference}`;
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
    setClaimFormValues((current) => ({ ...current, [field.name]: value }));
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

  useEffect(() => {
    setClaimFormValues(activeClaimForm?.document?.input || {});
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
                        fields={activeClaimForm.template.fields || []}
                        onFieldsChange={() => {}}
                        selectedFieldId={null}
                        onSelectField={() => {}}
                        entryMode={canEditTemplates}
                        readOnly={!canEditTemplates}
                        onEntryValueChange={updateClaimFormField}
                        values={claimFormValues}
                        minScale={0.25}
                        fitPadding={28}
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
                        <p>{request.original_filename ? `Uploaded: ${request.original_filename}` : 'PDF, image, or Word file.'}</p>
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
                          {uploadingId === request.id ? <ButtonSpinner label="Uploading..." /> : request.status === 'uploaded' ? 'Replace' : 'Upload'}
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
