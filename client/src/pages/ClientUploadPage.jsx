import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleDashed, FileUp, Save, UploadCloud } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ButtonSpinner } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

const emptyIntakeForm = {
  cell: '',
  email: '',
  passport_number: '',
  date_of_birth: '',
  residential_address: '',
  occupation: '',
  employer_details: '',
  accident_time: '',
  accident_location: '',
  police_station: '',
  police_case_number: '',
  collision_description: '',
  vehicle_description: '',
  driver_name: '',
  driver_contact: '',
  witness_name: '',
  witness_contact: '',
  witness_statement: ''
};

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function ClientPortalLoader() {
  return (
    <main className="client-upload-page">
      <section className="client-upload-panel client-upload-loader" role="status" aria-live="polite">
        <div className="auth-brand">
          <div className="brand-mark large"><FileUp size={28} /></div>
          <div>
            <span className="eyebrow">Client document upload</span>
            <h1>Preparing your intake workspace</h1>
          </div>
        </div>
        <div className="advanced-loader">
          <span className="advanced-loader-ring" aria-hidden="true" />
          <div>
            <strong>Loading claim data</strong>
            <p>Checking requested documents, intake details, and upload status.</p>
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
  const [intakeForm, setIntakeForm] = useState(emptyIntakeForm);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [uploadingId, setUploadingId] = useState(null);
  const [savingInfo, setSavingInfo] = useState(false);
  const [loadingPortal, setLoadingPortal] = useState(true);

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
    const latestCase = result.cases?.[0] || {};
    const vehicle = parseJson(latestCase.vehicle_json);
    const driver = parseJson(latestCase.driver_json);
    const witnesses = parseJson(latestCase.witnesses_json, []);
    const witness = Array.isArray(witnesses) ? witnesses[0] || {} : {};

    setPortal(result);
    setIntakeForm({
      cell: result.client?.cell || '',
      email: result.client?.email || '',
      passport_number: result.client?.passport_number || '',
      date_of_birth: result.client?.date_of_birth || '',
      residential_address: result.client?.residential_address || '',
      occupation: result.client?.occupation || '',
      employer_details: result.client?.employer_details || '',
      accident_time: latestCase.accident_time || '',
      accident_location: latestCase.accident_location || '',
      police_station: latestCase.police_station || '',
      police_case_number: latestCase.police_case_number || '',
      collision_description: latestCase.collision_description || '',
      vehicle_description: vehicle.description || '',
      driver_name: driver.name || '',
      driver_contact: driver.contact || '',
      witness_name: witness.name || '',
      witness_contact: witness.contact || '',
      witness_statement: witness.statement || ''
    });
  }

  function updateIntakeField(field, value) {
    setIntakeForm((current) => ({ ...current, [field]: value }));
  }

  function chooseDocumentFile(requestId) {
    fileInputRefs.current[requestId]?.click();
  }

  useEffect(() => {
    loadPortal().catch((err) => setError(err.message));
  }, [token]);

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

  async function saveIntakeInfo(event) {
    event.preventDefault();
    setSavingInfo(true);
    setError('');
    setMessage('');

    try {
      const result = await apiRequest(`/api/client-portal/${token}/intake`, {
        method: 'PATCH',
        body: intakeForm
      });
      applyPortal(result);
      setMessage('Claim information saved successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingInfo(false);
    }
  }

  if (loadingPortal && !portal && !error) return <ClientPortalLoader />;
  const uploadedCount = portal?.requests?.filter((request) => request.status === 'uploaded' || request.original_filename).length || 0;
  const requestCount = portal?.requests?.length || 0;
  const uploadProgress = requestCount ? Math.round((uploadedCount / requestCount) * 100) : 0;

  return (
    <main className="client-upload-page">
      <section className="client-upload-panel">
        <div className="auth-brand">
          <div className="brand-mark large"><FileUp size={28} /></div>
          <div>
            <span className="eyebrow">Client document upload</span>
            <h1>{portal?.firm?.name || 'Upload portal'}</h1>
          </div>
        </div>

        <StatusMessage type="error">{error}</StatusMessage>
        <StatusMessage type="success">{message}</StatusMessage>

        {portal && (
          <>
            <div className="client-upload-intro">
              <h2>{portal.client.first_name} {portal.client.surname}</h2>
              <p>Confirm your details, add missing claim information, and upload the requested documents for your RAF application.</p>
            </div>

            <form className="client-intake-form" onSubmit={saveIntakeInfo}>
              <div className="client-intake-header">
                <div>
                  <h3>Client intake information</h3>
                  <p>Add anything missing so the law firm can prepare the correct RAF forms.</p>
                </div>
                <button className="primary-button" type="submit" disabled={savingInfo}>
                  <Save size={17} />
                  {savingInfo ? <ButtonSpinner label="Saving..." /> : 'Save information'}
                </button>
              </div>
              <div className="client-intake-grid">
                <label>
                  Contact number
                  <input value={intakeForm.cell} onChange={(event) => updateIntakeField('cell', event.target.value)} />
                </label>
                <label>
                  Email
                  <input type="email" value={intakeForm.email} onChange={(event) => updateIntakeField('email', event.target.value)} />
                </label>
                <label>
                  Passport number
                  <input value={intakeForm.passport_number} onChange={(event) => updateIntakeField('passport_number', event.target.value)} />
                </label>
                <label>
                  Date of birth
                  <input type="date" value={intakeForm.date_of_birth || ''} onChange={(event) => updateIntakeField('date_of_birth', event.target.value)} />
                </label>
                <label className="span-2">
                  Residential address
                  <textarea value={intakeForm.residential_address} onChange={(event) => updateIntakeField('residential_address', event.target.value)} />
                </label>
                <label>
                  Occupation
                  <input value={intakeForm.occupation} onChange={(event) => updateIntakeField('occupation', event.target.value)} />
                </label>
                <label>
                  Employer details
                  <input value={intakeForm.employer_details} onChange={(event) => updateIntakeField('employer_details', event.target.value)} />
                </label>
                <label>
                  Accident time
                  <input type="time" value={intakeForm.accident_time || ''} onChange={(event) => updateIntakeField('accident_time', event.target.value)} />
                </label>
                <label>
                  Police station
                  <input value={intakeForm.police_station} onChange={(event) => updateIntakeField('police_station', event.target.value)} />
                </label>
                <label>
                  Police case number
                  <input value={intakeForm.police_case_number} onChange={(event) => updateIntakeField('police_case_number', event.target.value)} />
                </label>
                <label className="span-2">
                  Accident location
                  <input value={intakeForm.accident_location} onChange={(event) => updateIntakeField('accident_location', event.target.value)} />
                </label>
                <label className="span-2">
                  Description of collision
                  <textarea value={intakeForm.collision_description} onChange={(event) => updateIntakeField('collision_description', event.target.value)} />
                </label>
                <label className="span-2">
                  Vehicle details
                  <textarea value={intakeForm.vehicle_description} onChange={(event) => updateIntakeField('vehicle_description', event.target.value)} />
                </label>
                <label>
                  Driver name
                  <input value={intakeForm.driver_name} onChange={(event) => updateIntakeField('driver_name', event.target.value)} />
                </label>
                <label>
                  Driver contact
                  <input value={intakeForm.driver_contact} onChange={(event) => updateIntakeField('driver_contact', event.target.value)} />
                </label>
                <label>
                  Witness name
                  <input value={intakeForm.witness_name} onChange={(event) => updateIntakeField('witness_name', event.target.value)} />
                </label>
                <label>
                  Witness contact
                  <input value={intakeForm.witness_contact} onChange={(event) => updateIntakeField('witness_contact', event.target.value)} />
                </label>
                <label className="span-2">
                  Witness information
                  <textarea value={intakeForm.witness_statement} onChange={(event) => updateIntakeField('witness_statement', event.target.value)} />
                </label>
              </div>
            </form>

            <section className="client-documents-panel">
              <div className="client-documents-header">
                <div>
                  <span className="eyebrow">Supporting documents</span>
                  <h3>Upload checklist</h3>
                  <p>{uploadedCount} of {requestCount} document(s) received by the law firm.</p>
                </div>
                <div className="client-upload-progress" aria-label={`${uploadProgress}% complete`}>
                  <strong>{uploadProgress}%</strong>
                  <span>complete</span>
                </div>
              </div>
              <div className="client-upload-progress-bar" aria-hidden="true">
                <i style={{ width: `${uploadProgress}%` }} />
              </div>

              <div className="client-request-list">
                {portal.requests.map((request) => (
                  <article className={`client-request-card ${request.status === 'uploaded' ? 'uploaded' : ''} ${files[request.id] ? 'ready' : ''}`} key={request.id}>
                    <div className="client-request-copy">
                      <div className="client-request-title-row">
                        <h3>{request.label}</h3>
                      </div>
                      <p>{request.original_filename ? `Uploaded: ${request.original_filename}` : 'PDF, image, Word document, or scan accepted.'}</p>
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
            </section>
          </>
        )}
      </section>
    </main>
  );
}
