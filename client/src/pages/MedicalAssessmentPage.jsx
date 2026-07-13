import { useEffect, useState } from 'react';
import { CheckCircle2, FileText, Save, ShieldCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ButtonSpinner } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

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
    <main className="client-upload-page">
      <section className="client-upload-panel medical-assessment-panel">
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
            <div className="medical-access-note">
              <ShieldCheck size={18} />
              <span>This link only opens the assigned patient assessment.</span>
            </div>

            <section className="client-intake-section medical-context-card">
              <div className="client-intake-section-title">
                <FileText size={17} />
                <h4>Patient context</h4>
              </div>
              <div className="medical-readonly-grid">
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
              </div>
            </section>

            <form className="client-documents-panel medical-assessment-form" onSubmit={submitAssessment}>
              <div className="medical-request-heading">
                <div>
                  <span className="eyebrow">Request</span>
                  <h3>{payload.assessment.report_label}</h3>
                  <p>{payload.assessment.deadline ? `Due ${formatDate(payload.assessment.deadline)}` : 'No deadline set'}</p>
                </div>
                <span className={`medical-status-pill ${payload.assessment.status}`}>{payload.assessment.status}</span>
              </div>

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

              <button className="primary-button" disabled={saving}>
                {saving ? <ButtonSpinner label="Submitting..." /> : payload.assessment.status === 'submitted' ? <CheckCircle2 size={17} /> : <Save size={17} />}
                {!saving && (payload.assessment.status === 'submitted' ? 'Update assessment' : 'Submit assessment')}
              </button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
