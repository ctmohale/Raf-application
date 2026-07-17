import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, FileText, Maximize2, Minimize2, Save } from 'lucide-react';
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

export default function MedicalAssessmentPage() {
  const { token } = useParams();
  const [payload, setPayload] = useState(null);
  const [assessmentForm, setAssessmentForm] = useState(emptyAssessmentForm);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templateFullscreen, setTemplateFullscreen] = useState(false);
  const [templateCollapsed, setTemplateCollapsed] = useState(false);

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
  const templateProgress = useMemo(() => {
    const fields = payload?.template?.fields || [];
    const fillableFields = fields.filter((field) => field.field_type !== 'checkbox' || field.required);
    const total = fillableFields.length;
    const filled = fillableFields.filter((field) => {
      const value = assessmentForm[field.name] ?? assessmentForm[field.source_value_key];
      if (Array.isArray(value)) return value.some((item) => String(item ?? '').trim() !== '');
      if (value && typeof value === 'object') return Object.values(value).some((item) => String(item ?? '').trim() !== '');
      if (typeof value === 'boolean') return value;
      return String(value ?? '').trim() !== '';
    }).length;

    return {
      filled,
      total,
      missing: Math.max(0, total - filled),
      percent: total ? Math.round((filled / total) * 100) : 0
    };
  }, [payload?.template, assessmentForm]);

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
            <div className="client-upload-header medical-assessment-title">
              <div className="medical-assessment-title-icon" aria-hidden="true">
                <FileText size={22} />
              </div>
              <div>
                <span className="eyebrow">Medical assessment</span>
                <h1>{payload.assessment?.report_label || 'RAF 4 serious-injury assessment'}</h1>
                <p>{payload.patient.first_name} {payload.patient.surname} · {payload.claim.case_reference}</p>
              </div>
            </div>

            <form
              className={payload.template
                ? `client-documents-panel client-template-panel medical-template-panel client-collapsible-card ${templateCollapsed ? 'collapsed' : ''} ${templateFullscreen ? 'fullscreen' : ''}`
                : 'client-documents-panel medical-assessment-form'}
              onSubmit={submitAssessment}
            >
              <div className="client-documents-header">
                <div>
                  <span className="eyebrow">Attached templates</span>
                  <h3>{payload.template ? 'Medical report' : 'Assessment details'}</h3>
                  {payload.template ? (
                    <div className="client-template-progress" aria-label={`${templateProgress.percent}% complete`}>
                      <strong>{templateProgress.percent}%</strong>
                      <span>{templateProgress.filled}/{templateProgress.total || 0} done</span>
                      <em>{templateProgress.missing} missing</em>
                    </div>
                  ) : (
                    <p>Complete the clinical information for this assigned patient.</p>
                  )}
                </div>
                <div className="client-card-actions">
                  {payload.template && (
                    <div className="client-template-picker" title={payload.template.name}>
                      <FileText size={16} />
                      <span>{payload.template.name}</span>
                    </div>
                  )}
                  <button className="primary-button" disabled={saving}>
                    {saving ? <ButtonSpinner label="Submitting..." /> : payload.assessment.status === 'submitted' ? <CheckCircle2 size={16} /> : <Save size={16} />}
                    {!saving && (payload.assessment.status === 'submitted' ? 'Update' : 'Submit')}
                  </button>
                  {payload.template && (
                    <div className="client-template-window-actions">
                      {!templateCollapsed && (
                        <button
                          className="icon-button ghost client-expand-button"
                          type="button"
                          onClick={() => setTemplateFullscreen((current) => !current)}
                          title={templateFullscreen ? 'Exit full screen' : 'Open document in full screen'}
                          aria-label={templateFullscreen ? 'Exit document full screen' : 'Open document in full screen'}
                        >
                          {templateFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                        </button>
                      )}
                      <button
                        className="icon-button ghost client-collapse-button"
                        type="button"
                        onClick={() => {
                          setTemplateCollapsed((current) => {
                            if (!current) setTemplateFullscreen(false);
                            return !current;
                          });
                        }}
                        aria-expanded={!templateCollapsed}
                        aria-label={templateCollapsed ? 'Expand attached templates' : 'Collapse attached templates'}
                        title={templateCollapsed ? 'Expand' : 'Collapse'}
                      >
                        <ChevronDown size={17} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {payload.template ? (
                <div className="client-card-body client-template-body" hidden={templateCollapsed}>
                  <div className="client-template-preview client-upload-template-preview">
                    <PdfWorkspace
                      className="client-fit-pdf-workspace"
                      pdfPath={`/api/medical-assessments/${token}/template/pdf`}
                      fields={templatePreview.fields}
                      onFieldsChange={() => {}}
                      selectedFieldId={null}
                      onSelectField={() => {}}
                      entryMode
                      onEntryValueChange={updateDocumentFieldValue}
                      values={templatePreview.values}
                      minScale={0.25}
                      fitPadding={0}
                      fitToPageWidth
                    />
                  </div>
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
