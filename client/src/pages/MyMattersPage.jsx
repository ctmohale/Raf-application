import { useEffect, useState } from 'react';
import { BriefcaseBusiness, Filter } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { PageLoader } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

const filters = [
  ['all', 'All matters'], ['new', 'New'], ['documents', 'Documents outstanding'],
  ['client', 'Waiting for client'], ['doctor', 'Waiting for doctor'], ['review', 'Ready for review'],
  ['submission', 'Ready for submission'], ['submitted', 'Submitted'], ['closed', 'Closed']
];

function matterStage(matter) {
  const requested = Number(matter.requested_documents || 0);
  const uploaded = Number(matter.uploaded_documents || 0);
  if (matter.status === 'closed') return 'closed';
  if (matter.status === 'submitted') return 'submitted';
  if (matter.status === 'ready_for_submission') return 'submission';
  if (requested > 0 && uploaded >= requested) return 'review';
  if (requested > uploaded) return 'documents';
  return 'new';
}

export default function MyMattersPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest(`/api/firms/${id}/my-matters`).then(setData).catch((err) => setError(err.message));
  }, [id]);

  if (!data && !error) return <PageLoader label="Loading assigned matters..." />;
  const matters = data?.matters || [];
  const visibleMatters = matters.filter((matter) => {
    if (filter === 'all') return true;
    const stage = matterStage(matter);
    if (filter === 'client') return stage === 'documents';
    return stage === filter;
  });

  return (
    <section className="page-stack">
      <div className="section-header"><div><h2>My Matters</h2><p>RAF matters assigned to you in {data?.firm?.name || 'this firm'}.</p></div></div>
      <StatusMessage type="error">{error}</StatusMessage>
      {(data?.notifications || []).length > 0 && <div className="assignment-notice-list">{data.notifications.map((notification) => <div className="assignment-notice" key={notification.id}><BriefcaseBusiness size={16} /><span>{notification.message}</span><time>{new Date(notification.created_at).toLocaleString()}</time></div>)}</div>}
      <section className="panel">
        <div className="panel-header"><div><h3>Assigned matters</h3><p>{visibleMatters.length} of {matters.length} matters</p></div><label className="table-filter"><Filter size={16} /><select value={filter} onChange={(event) => setFilter(event.target.value)}>{filters.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
        <div className="firm-table-wrap">
          {visibleMatters.length === 0 ? <div className="empty-state"><BriefcaseBusiness size={26} /><h3>No assigned matters</h3><p>No matters match this filter.</p></div> : (
            <table className="firm-table firm-records-table my-matters-table">
              <thead><tr><th>Matter</th><th>Client</th><th>Status</th><th>Responsible lawyer</th><th>Assistant</th><th>Readiness</th><th>Missing docs</th><th>Next action</th><th>Deadline</th></tr></thead>
              <tbody>{visibleMatters.map((matter) => {
                const requested = Number(matter.requested_documents || 0);
                const uploaded = Number(matter.uploaded_documents || 0);
                const missing = Math.max(requested - uploaded, 0);
                const readiness = requested ? Math.round((uploaded / requested) * 100) : 0;
                const nextAction = missing > 0 ? 'Collect documents' : matter.lawyer_review_status === 'not_reviewed' ? 'Lawyer review' : 'Prepare submission';
                return <tr key={matter.id}><td data-label="Matter"><strong>{matter.case_reference}</strong><span>Case #{matter.id}</span></td><td data-label="Client">{matter.first_name} {matter.surname}</td><td data-label="Status"><span className={`status-pill ${matter.status}`}>{matter.status}</span></td><td data-label="Responsible lawyer">{matter.responsible_lawyer?.name || 'Unassigned'}</td><td data-label="Assistant">{matter.assigned_assistant?.name || 'None'}</td><td data-label="Readiness"><span className={`claim-forms-average-status ${readiness === 100 ? 'complete' : readiness > 50 ? 'high' : readiness > 0 ? 'mid' : 'low'}`}>{readiness}%</span></td><td data-label="Missing docs">{missing}</td><td data-label="Next action">{nextAction}</td><td data-label="Deadline">{matter.internal_deadline ? new Date(`${matter.internal_deadline}T00:00:00`).toLocaleDateString() : 'Not set'}</td></tr>;
              })}</tbody>
            </table>
          )}
        </div>
      </section>
    </section>
  );
}
