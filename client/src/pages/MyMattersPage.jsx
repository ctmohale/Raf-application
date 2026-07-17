import { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, ExternalLink, Filter } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { PageLoader } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

const filters = [
  ['my', 'My Matters'],
  ['all', 'All Matters'],
  ['assigned_to_me', 'Assigned to Me'],
  ['unassigned', 'Unassigned'],
  ['open', 'Open'],
  ['pending', 'Pending'],
  ['closed', 'Closed']
];

function formatDate(value) {
  if (!value) return 'Not set';
  return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString();
}

function filterMatter(matter, filter, userId, canViewAll) {
  const assignedToMe = Number(matter.responsible_lawyer_user_id || 0) === Number(userId)
    || Number(matter.assigned_assistant_user_id || 0) === Number(userId);
  if (filter === 'all') return canViewAll;
  if (filter === 'my' || filter === 'assigned_to_me') return assignedToMe;
  if (filter === 'unassigned') return !matter.responsible_lawyer_user_id && !matter.assigned_assistant_user_id;
  return matter.status === filter;
}

export default function MyMattersPage() {
  const { id } = useParams();
  const location = useLocation();
  const basePath = location.pathname.startsWith('/firms/') ? `/firms/${id}` : `/firm/${id}`;
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest(`/api/firms/${id}/matters`).then(setData).catch((err) => setError(err.message));
  }, [id]);

  const matters = data?.matters || [];
  const canViewAll = Boolean(data?.permissions?.can_view_all_matters);
  const userId = data?.current_user_id;
  const visibleMatters = useMemo(() => matters.filter((matter) => filterMatter(matter, filter, userId, canViewAll)), [matters, filter, userId, canViewAll]);

  if (!data && !error) return <PageLoader label="Loading matters..." />;

  return (
    <section className="page-stack">
      <div className="section-header">
        <div>
          <h2>Matters</h2>
          <p>Internal legal case files for {data?.firm?.name || 'this firm'}.</p>
        </div>
      </div>

      <StatusMessage type="error">{error}</StatusMessage>
      {(data?.notifications || []).length > 0 && (
        <div className="assignment-notice-list">
          {data.notifications.map((notification) => (
            <div className="assignment-notice" key={notification.id}>
              <BriefcaseBusiness size={16} />
              <span>{notification.message}</span>
              <time>{new Date(notification.created_at).toLocaleString()}</time>
            </div>
          ))}
        </div>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Legal matters</h3>
            <p>{visibleMatters.length} of {matters.length} matter(s)</p>
          </div>
          <label className="table-filter" aria-label="Filter matters">
            <Filter size={16} />
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              {filters.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <div className="firm-table-wrap">
          {visibleMatters.length === 0 ? (
            <div className="empty-state">
              <BriefcaseBusiness size={26} />
              <h3>No matters found</h3>
              <p>No internal matters match this filter.</p>
            </div>
          ) : (
            <table className="firm-table firm-records-table my-matters-table">
              <thead>
                <tr>
                  <th>Matter</th>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Lawyer</th>
                  <th>Assistant</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Opened</th>
                  <th>Deadline</th>
                  <th>RAF claim</th>
                </tr>
              </thead>
              <tbody>
                {visibleMatters.map((matter) => {
                  const nextDeadline = matter.deadlines?.[0];
                  return (
                    <tr key={matter.id}>
                      <td data-label="Matter">
                        <strong>{matter.matter_reference}</strong>
                        <span>{matter.matter_title}</span>
                      </td>
                      <td data-label="Client">{matter.client_name}</td>
                      <td data-label="Type">{matter.matter_type}</td>
                      <td data-label="Lawyer">{matter.responsible_lawyer?.name || 'Unassigned'}</td>
                      <td data-label="Assistant">{matter.assigned_assistant?.name || 'Unassigned'}</td>
                      <td data-label="Status"><span className={`status-pill ${matter.status}`}>{matter.status}</span></td>
                      <td data-label="Priority">{matter.priority}</td>
                      <td data-label="Opened">{formatDate(matter.opened_at)}</td>
                      <td data-label="Deadline">{nextDeadline ? `${nextDeadline.label}: ${formatDate(nextDeadline.date)}` : 'Not set'}</td>
                      <td data-label="RAF claim">
                        <Link className="inline-link" to={`${basePath}/matters/${matter.id}`}>
                          {matter.linked_raf_claim?.claim_reference || 'Create RAF Claim'} <ExternalLink size={13} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </section>
  );
}
