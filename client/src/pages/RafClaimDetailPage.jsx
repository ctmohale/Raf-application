import { ArrowLeft, BriefcaseBusiness, CalendarDays, ClipboardCheck, FileCheck2, FileText, Stethoscope } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { PageLoader } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

function formatDate(value) {
  if (!value) return 'Not set';
  return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString();
}

function includesRequiredForm(claim, formName) {
  return String(claim?.required_forms_json || '').includes(formName);
}

export default function RafClaimDetailPage() {
  const { id, caseId } = useParams();
  const location = useLocation();
  const basePath = location.pathname.startsWith('/firms/') ? `/firms/${id}` : `/firm/${id}`;
  const [workspace, setWorkspace] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest(`/api/firms/${id}/workspace`).then(setWorkspace).catch((err) => setError(err.message));
  }, [id]);

  const claim = useMemo(() => (workspace?.cases || []).find((item) => String(item.id) === String(caseId)), [workspace, caseId]);
  const requests = (workspace?.documentRequests || []).filter((request) => String(request.case_id) === String(caseId));
  const uploaded = requests.filter((request) => Number(request.upload_count || 0) > 0).length;
  const readiness = requests.length ? Math.round((uploaded / requests.length) * 100) : 0;
  const missing = Math.max(requests.length - uploaded, 0);
  const medicalRequest = (workspace?.medicalAssessmentRequests || []).find((request) => String(request.case_id) === String(caseId));
  const submissionStatus = claim?.status === 'submitted' ? 'Submitted' : claim?.status === 'closed' ? 'Finalised' : 'Not submitted';

  if (!workspace && !error) return <PageLoader label="Loading RAF claim..." />;

  return (
    <section className="page-stack">
      <div className="claim-detail-hero">
        <div>
          <Link className="inline-link" to={`${basePath}/claims`}><ArrowLeft size={14} /> RAF Claims</Link>
          <span className="eyebrow">RAF claim file</span>
          <h2>{claim?.case_reference || 'RAF Claim'}</h2>
          <p>{claim ? `${claim.first_name} ${claim.surname} · Accident ${formatDate(claim.accident_date)}` : 'Claim not found'}</p>
        </div>
        {claim && <span className={`status-pill ${claim.status}`}>{claim.status}</span>}
      </div>

      <StatusMessage type="error">{error}</StatusMessage>

      {claim && (
        <>
          <section className="panel">
            <div className="linked-record-strip">
              <span className="linked-record-icon"><BriefcaseBusiness size={18} /></span>
              <div>
                <span>Linked matter</span>
                <strong>{claim.matter_reference || 'No linked matter reference'}</strong>
                <small>{claim.matter_title || 'Matter title not set'} · {claim.matter_status || 'No matter status'}</small>
              </div>
              {claim.matter_id && (
                <Link className="primary-button" to={`${basePath}/matters/${claim.matter_id}`}>
                  <BriefcaseBusiness size={16} /> View Matter
                </Link>
              )}
            </div>
          </section>

          <section className="claim-detail-summary">
            <div>
              <span><ClipboardCheck size={17} /> Readiness</span>
              <strong>{readiness}%</strong>
              <div className="mini-meter"><i style={{ width: `${readiness}%` }} /></div>
            </div>
            <div>
              <span><FileCheck2 size={17} /> Documents</span>
              <strong>{uploaded}/{requests.length}</strong>
              <small>{missing} missing</small>
            </div>
            <div>
              <span><Stethoscope size={17} /> Medical</span>
              <strong>{medicalRequest?.status || 'Not requested'}</strong>
              <small>Doctor assessment</small>
            </div>
            <div>
              <span><FileText size={17} /> Submission</span>
              <strong>{submissionStatus}</strong>
              <small>{claim.submission_date || 'No date'}</small>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div><h3>RAF claim process</h3><p>Road Accident Fund claim workflow and readiness.</p></div>
            </div>
            <div className="claim-detail-layout">
              <div className="claim-detail-section">
                <h4>Claim details</h4>
                <div className="detail-list">
                  <div><span>Claim reference</span><strong>{claim.case_reference}</strong></div>
                  <div><span>Claimant</span><strong>{claim.first_name} {claim.surname}</strong></div>
                  <div><span>Accident date</span><strong>{formatDate(claim.accident_date)}</strong></div>
                  <div><span>Accident location</span><strong>{claim.accident_location || 'Not set'}</strong></div>
                  <div><span>Police case number</span><strong>{claim.police_case_number || 'Not set'}</strong></div>
                </div>
              </div>
              <div className="claim-detail-section">
                <h4>Prescribed forms</h4>
                <div className="form-status-list">
                  {['RAF 1', 'RAF 3', 'RAF 4'].map((formName) => (
                    <div key={formName}>
                      <span>{formName}</span>
                      <strong className={includesRequiredForm(claim, formName) ? 'required' : ''}>
                        {includesRequiredForm(claim, formName) ? 'Required' : 'Not required'}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
              <div className="claim-detail-section">
                <h4>Submission tracking</h4>
                <div className="detail-list">
                  <div><span>Status</span><strong>{submissionStatus}</strong></div>
                  <div><span>Submission date</span><strong>{claim.submission_date || 'Not set'}</strong></div>
                  <div><span>RAF reference</span><strong>{claim.raf_reference_number || 'Not set'}</strong></div>
                  <div><span>Opened</span><strong><CalendarDays size={14} /> {formatDate(claim.opened_at)}</strong></div>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
