import { ArrowLeft, BriefcaseBusiness, CalendarDays, ClipboardList, ExternalLink, FileText, Plus, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { PageLoader } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

function formatDate(value) {
  if (!value) return 'Not set';
  return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString();
}

function formatStatus(value) {
  return String(value || 'not set').replace(/_/g, ' ');
}

export default function MatterDetailPage() {
  const { id, matterId } = useParams();
  const location = useLocation();
  const basePath = location.pathname.startsWith('/firms/') ? `/firms/${id}` : `/firm/${id}`;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest(`/api/firms/${id}/matters/${matterId}`).then(setData).catch((err) => setError(err.message));
  }, [id, matterId]);

  if (!data && !error) return <PageLoader label="Loading matter..." />;
  const matter = data?.matter;
  const linkedClaim = matter?.linked_raf_claim;
  const nextDeadline = matter?.deadlines?.[0];

  return (
    <section className="page-stack">
      <div className="claim-detail-hero matter-detail-hero">
        <div>
          <Link className="inline-link" to={`${basePath}/matters`}><ArrowLeft size={14} /> Matters</Link>
          <span className="eyebrow">Matter file</span>
          <h2>{matter?.matter_title || 'Matter'}</h2>
          <p>{matter?.matter_reference} · {matter?.client_name}</p>
        </div>
        {matter && <span className={`status-pill ${matter.status}`}>{formatStatus(matter.status)}</span>}
      </div>

      <StatusMessage type="error">{error}</StatusMessage>

      {matter && (
        <>
          <section className="claim-detail-summary matter-detail-summary">
            <div>
              <span><BriefcaseBusiness size={17} /> Type</span>
              <strong>{matter.matter_type}</strong>
              <small>{formatStatus(matter.status)}</small>
            </div>
            <div>
              <span><UserRound size={17} /> Lawyer</span>
              <strong>{matter.responsible_lawyer?.name || 'Unassigned'}</strong>
              <small>{matter.assigned_assistant?.name ? `Assistant: ${matter.assigned_assistant.name}` : 'No assistant assigned'}</small>
            </div>
            <div>
              <span><CalendarDays size={17} /> Opened</span>
              <strong>{formatDate(matter.opened_at)}</strong>
              <small>{matter.priority} priority</small>
            </div>
            <div>
              <span><ClipboardList size={17} /> Next deadline</span>
              <strong>{nextDeadline ? formatDate(nextDeadline.date) : 'Not set'}</strong>
              <small>{nextDeadline?.label || 'No deadline captured'}</small>
            </div>
          </section>

          <section className="panel">
            <div className="linked-record-strip matter-record-strip">
              <span className="linked-record-icon"><FileText size={18} /></span>
              <div>
                <span>Linked RAF claim</span>
                <strong>{linkedClaim?.claim_reference || 'No RAF claim linked'}</strong>
                <small>
                  {linkedClaim
                    ? `${formatStatus(linkedClaim.claim_status)} · ${linkedClaim.readiness_percentage}% ready · ${linkedClaim.missing_documents_count} missing document${linkedClaim.missing_documents_count === 1 ? '' : 's'}`
                    : 'Create a RAF claim when this matter is ready.'}
                </small>
              </div>
              {linkedClaim ? (
                <Link className="primary-button" to={`${basePath}/claims/${matter.linked_raf_case_id}`}><FileText size={16} /> Open RAF Claim</Link>
              ) : (
                <Link className="primary-button" to={`${basePath}/claims`}><Plus size={16} /> Create RAF Claim</Link>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>Matter details</h3>
                <p>Internal legal case information kept separate from RAF claim workflow.</p>
              </div>
            </div>
            <div className="claim-detail-layout matter-detail-layout">
              <div className="claim-detail-section">
                <h4>Team</h4>
                <div className="detail-list">
                  <div><span>Assigned lawyer</span><strong>{matter.responsible_lawyer?.name || 'Unassigned'}</strong></div>
                  <div><span>Assigned assistant</span><strong>{matter.assigned_assistant?.name || 'Unassigned'}</strong></div>
                  <div><span>Priority</span><strong>{formatStatus(matter.priority)}</strong></div>
                </div>
              </div>
              <div className="claim-detail-section">
                <h4>Deadlines</h4>
                <div className="detail-list">
                  {matter.deadlines?.length ? matter.deadlines.map((deadline) => (
                    <div key={`${deadline.label}-${deadline.date}`}><span>{deadline.label}</span><strong>{formatDate(deadline.date)}</strong></div>
                  )) : <div><span>Deadline</span><strong>Not set</strong></div>}
                </div>
              </div>
              <div className="claim-detail-section">
                <h4>RAF link</h4>
                <div className="detail-list">
                  <div><span>Claim status</span><strong>{formatStatus(linkedClaim?.claim_status)}</strong></div>
                  <div><span>Doctor status</span><strong>{formatStatus(linkedClaim?.doctor_status)}</strong></div>
                  <div><span>Submission</span><strong>{formatStatus(linkedClaim?.submission_status)}</strong></div>
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div><h3>Activity history</h3><p>Recent assignment and matter activity.</p></div>
            </div>
            {(data.activity_history || []).length === 0 ? (
              <div className="empty-state matter-activity-empty">
                <BriefcaseBusiness size={26} />
                <h3>No activity recorded yet</h3>
                <p>Assignments and matter updates will appear here.</p>
              </div>
            ) : (
              <div className="activity-list">
                {data.activity_history.map((item) => (
                  <div className="activity-item" key={item.id}>
                    <ExternalLink size={14} />
                    <span>{item.assignment_note || item.reason || 'Matter assignment updated'}</span>
                    <time>{new Date(item.created_at).toLocaleString()}</time>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
