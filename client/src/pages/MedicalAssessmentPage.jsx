import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, FileText, Maximize2, Minimize2, Save, ShieldCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ButtonSpinner } from '../components/LoadingSpinner.jsx';
import PdfWorkspace from '../components/PdfWorkspace.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';
import { buildTemplateInputPreview, getUpdatedGroupedInputValue, scaleGroupedBoxesForRenderedField } from '../lib/templateFieldHelpers.js';

const emptyAssessmentForm = {
  examination_date: '',
  injuries: '',
  clinical_findings: '',
  diagnosis: '',
  treatment: '',
  impairment: '',
  recommendations: '',
  notes: ''
};

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function MedicalAssessmentPage() {
  const { token } = useParams();
  const [payload, setPayload] = useState(null);
  const [assessmentForm, setAssessmentForm] = useState(emptyAssessmentForm);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templateFullscreen, setTemplateFullscreen] = useState(false);
  const [patientContextOpen, setPatientContextOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiRequest(`/api/medical-assessments/${token}`)
      .then((result) => {
        setPayload(result);
        setAssessmentForm({ ...emptyAssessmentForm, ...(result.assessment?.values || {}) });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  function updateAssessmentField(field, value) {
    setAssessmentForm((current) => ({ ...current, [field]: value }));
  }

  function updateDocumentFieldValue(field, value) {
    if (field.locked) return;
    if (value === '__open_signature_pad__') {
      setMessage('Signature fields can be completed with the typed assessment values for now.');
      return;
    }
    const valueKey = field.source_value_key || field.name;
    if (Number.isInteger(field.source_line_index)) {
      setAssessmentForm((current) => {
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
    updateAssessmentField(valueKey, value);
  }

  const templatePreview = useMemo(() => (
    payload?.template
      ? buildTemplateInputPreview(payload.template.fields || [], assessmentForm)
      : { fields: [], values: assessmentForm }
  ), [payload?.template, assessmentForm]);

  async function submitAssessment(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');

    try {
      const result = await apiRequest(`/api/medical-assessments/${token}`, {
        method: 'PATCH',
        body: { values: assessmentForm, submit: true }
      });
      setPayload(result);
      setAssessmentForm({ ...emptyAssessmentForm, ...(result.assessment?.values || {}) });
      setMessage('Assessment submitted successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={`client-upload-page ${templateFullscreen ? 'medical-document-fullscreen-active' : ''}`}>
      <section className="client-upload-panel medical-assessment-panel">
        {payload && (
          <div className="medical-access-note top-warning">
            <ShieldCheck size={18} />
            <span><strong>Warning:</strong> This link only opens the assigned patient assessment.</span>
          </div>
        )}

        <div className="medical-assessment-hero">
          <div className="auth-brand">
            <div className="brand-mark large"><FileText size={28} /></div>
            <div>
              <span className="eyebrow">Medical assessment</span>
              <h1>{payload?.assessment?.report_label || 'Secure doctor workspace'}</h1>
              {payload && <p>{payload.patient.first_name} {payload.patient.surname} · {payload.claim.case_reference}</p>}
            </div>
          </div>
          {payload && <span className={`medical-status-pill ${payload.assessment.status}`}>{payload.assessment.status}</span>}
        </div>

        {loading && (
          <div className="advanced-loader" role="status" aria-live="polite">
            <span className="advanced-loader-ring" aria-hidden="true" />
            <div>
              <strong>Loading assessment</strong>
              <p>Opening the assigned patient request.</p>
            </div>
          </div>
        )}

        <StatusMessage type="error">{error}</StatusMessage>
        <StatusMessage type="success">{message}</StatusMessage>

        {payload && (
          <div className="medical-assessment-view">
            <section className="client-intake-section medical-context-card">
              <div className="client-intake-section-title">
                <div>
                  <FileText size={17} />
                  <h4>Patient context</h4>
                </div>
                <button
                  className="medical-context-toggle"
                  type="button"
                  onClick={() => setPatientContextOpen((current) => !current)}
                  aria-expanded={patientContextOpen}
                >
                  {patientContextOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  <span>{patientContextOpen ? 'Hide' : 'Show'}</span>
                </button>
              </div>
              {patientContextOpen && <div className="medical-readonly-grid">
                <div>
                  <span>Patient</span>
                  <strong>{payload.patient.first_name} {payload.patient.surname}</strong>
                </div>
                <div>
                  <span>Date of birth</span>
                  <strong>{formatDate(payload.patient.date_of_birth)}</strong>
                </div>
                <div>
                  <span>Claim reference</span>
                  <strong>{payload.claim.case_reference || '-'}</strong>
                </div>
                <div>
                  <span>Accident date</span>
                  <strong>{formatDate(payload.claim.accident_date)}</strong>
                </div>
                <div className="span-2">
                  <span>Accident location</span>
                  <strong>{payload.claim.accident_location || '-'}</strong>
                </div>
                <div className="span-2">
                  <span>Collision details</span>
                  <strong>{payload.claim.collision_description || '-'}</strong>
                </div>
              </div>}
            </section>

            <form className={`client-documents-panel medical-assessment-form ${payload.template ? 'template-form' : ''} ${templateFullscreen ? 'fullscreen' : ''}`} onSubmit={submitAssessment}>
              <div className="medical-form-heading">
                <div>
                  <span className="eyebrow">Medical report</span>
                  <h3>{payload.template ? 'Fill on document' : 'Assessment details'}</h3>
                  <p>
                    {payload.template
                      ? `${payload.template.name} · ${payload.template.fields?.length || 0} inputs`
                      : 'Complete the clinical information for this assigned patient.'}
                  </p>
                </div>
                <div className="medical-form-heading-actions">
                  <div className="medical-inline-request">
                    <div>
                      <strong>{payload.assessment.report_label}</strong>
                      <small>{payload.assessment.deadline ? `Due ${formatDate(payload.assessment.deadline)}` : 'No deadline set'}</small>
                    </div>
                  </div>
                  <button className="primary-button medical-header-submit" disabled={saving}>
                    {saving ? <ButtonSpinner label="Submitting..." /> : payload.assessment.status === 'submitted' ? <CheckCircle2 size={16} /> : <Save size={16} />}
                    {!saving && (payload.assessment.status === 'submitted' ? 'Update' : 'Submit')}
                  </button>
                  {payload.template && (
                    <button
                      className="icon-button ghost"
                      type="button"
                      onClick={() => setTemplateFullscreen((current) => !current)}
                      title={templateFullscreen ? 'Exit full screen' : 'Open document in full screen'}
                      aria-label={templateFullscreen ? 'Exit document full screen' : 'Open document in full screen'}
                    >
                      {templateFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                    </button>
                  )}
                </div>
              </div>

              {payload.template ? (
                <div className="medical-template-preview">
                  <PdfWorkspace
                    pdfPath={`/api/medical-assessments/${token}/template/pdf`}
                    fields={templatePreview.fields}
                    onFieldsChange={() => {}}
                    selectedFieldId={null}
                    onSelectField={() => {}}
                    entryMode
                    onEntryValueChange={updateDocumentFieldValue}
                    values={templatePreview.values}
                  />
                </div>
              ) : (
                <div className="client-intake-grid">
                  <label>
                    Examination date
                    <input type="date" value={assessmentForm.examination_date} onChange={(event) => updateAssessmentField('examination_date', event.target.value)} />
                  </label>
                  <label>
                    Diagnosis
                    <input value={assessmentForm.diagnosis} onChange={(event) => updateAssessmentField('diagnosis', event.target.value)} placeholder="Primary diagnosis" />
                  </label>
                  <label className="span-2">
                    Injuries
                    <textarea value={assessmentForm.injuries} onChange={(event) => updateAssessmentField('injuries', event.target.value)} placeholder="List injuries related to the accident" />
                  </label>
                  <label className="span-2">
                    Clinical findings
                    <textarea value={assessmentForm.clinical_findings} onChange={(event) => updateAssessmentField('clinical_findings', event.target.value)} placeholder="Assessment findings" />
                  </label>
                  <label className="span-2">
                    Treatment
                    <textarea value={assessmentForm.treatment} onChange={(event) => updateAssessmentField('treatment', event.target.value)} placeholder="Treatment already given or required" />
                  </label>
                  <label>
                    Impairment
                    <input value={assessmentForm.impairment} onChange={(event) => updateAssessmentField('impairment', event.target.value)} placeholder="If applicable" />
                  </label>
                  <label>
                    Recommendations
                    <input value={assessmentForm.recommendations} onChange={(event) => updateAssessmentField('recommendations', event.target.value)} placeholder="Follow-up or specialist care" />
                  </label>
                  <label className="span-2">
                    Notes
                    <textarea value={assessmentForm.notes} onChange={(event) => updateAssessmentField('notes', event.target.value)} placeholder="Any other relevant medical notes" />
                  </label>
                </div>
              )}

            </form>
          </div>
        )}
      </section>
    </main>
  );
}
