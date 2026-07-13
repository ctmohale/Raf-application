import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Clock3,
  RefreshCw,
  Search,
  ServerCrash,
  ShieldAlert
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import StatusMessage from '../components/StatusMessage.jsx';
import { PageLoader } from '../components/LoadingSpinner.jsx';
import { apiRequest } from '../lib/api.js';

const formatter = new Intl.DateTimeFormat('en-ZA', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

function Metric({ icon, label, value, note }) {
  return (
    <div className="metric activity-metric">
      <span className="metric-icon">{icon}</span>
      <div className="metric-body">
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
      <small>{note}</small>
    </div>
  );
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return formatter.format(date);
}

function formatMetadata(metadata) {
  if (!metadata) return '';
  return JSON.stringify(metadata, null, 2);
}

export default function ActivityLogsPage() {
  const [searchParams] = useSearchParams();
  const [payload, setPayload] = useState(null);
  const [level, setLevel] = useState('all');
  const [firmId, setFirmId] = useState('all');
  const [method, setMethod] = useState('all');
  const [eventType, setEventType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: '120' });
    if (level !== 'all') params.set('level', level);
    if (firmId !== 'all') params.set('firm_id', firmId);
    if (method !== 'all') params.set('method', method);
    if (eventType !== 'all') params.set('event_type', eventType);
    if (searchTerm.trim()) params.set('q', searchTerm.trim());
    return params.toString();
  }, [level, firmId, method, eventType, searchTerm]);

  async function loadLogs() {
    setError('');
    setLoading(true);
    try {
      const result = await apiRequest(`/api/activity-logs?${query}`);
      setPayload(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSearchTerm(searchParams.get('q') || '');
  }, [searchParams]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadLogs();
    }, 180);
    return () => clearTimeout(timeout);
  }, [query]);

  const logs = payload?.logs || [];
  const summary = payload?.summary || {};
  const firms = summary.firms || [];

  if (!payload && loading) return <PageLoader label="Loading activity logs..." />;

  return (
    <section className="page-stack activity-page">
      <div className="section-header">
        <div>
          <h2>Activity logs</h2>
          <p>Track firm activity, API requests, access checks, and server errors across the admin workspace.</p>
        </div>
        <button className="secondary-button" type="button" onClick={loadLogs} disabled={loading}>
          <RefreshCw size={17} /> Refresh
        </button>
      </div>

      <StatusMessage type="error">{error}</StatusMessage>

      <div className="metrics-grid activity-metrics">
        <Metric icon={<Activity size={22} />} label="Events" value={summary.total || 0} note="Matching current filters" />
        <Metric icon={<ServerCrash size={22} />} label="Errors" value={summary.errors || 0} note="Server and failed requests" />
        <Metric icon={<AlertTriangle size={22} />} label="Warnings" value={summary.warnings || 0} note="Rejected or invalid activity" />
        <Metric icon={<Clock3 size={22} />} label="Today" value={summary.today || 0} note={`${summary.firm_count || 0} firm(s) involved`} />
      </div>

      <section className="panel activity-panel">
        <div className="panel-header firm-table-header">
          <div>
            <h3>Audit trail</h3>
            <p>Newest activity first, including timing, user, firm, endpoint, and sanitized request context.</p>
          </div>
          <div className="firm-table-tools activity-tools">
            <label className="table-search" aria-label="Search activity logs">
              <Search size={16} />
              <input
                type="search"
                placeholder="Search logs"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>
            <label className="table-filter" aria-label="Filter logs by level">
              <ShieldAlert size={16} />
              <select value={level} onChange={(event) => setLevel(event.target.value)}>
                <option value="all">All levels</option>
                <option value="error">Errors</option>
                <option value="warn">Warnings</option>
                <option value="info">Info</option>
              </select>
            </label>
            <label className="table-filter" aria-label="Filter logs by firm">
              <Activity size={16} />
              <select value={firmId} onChange={(event) => setFirmId(event.target.value)}>
                <option value="all">All firms</option>
                {firms.map((firm) => (
                  <option value={firm.id} key={firm.id}>{firm.name}</option>
                ))}
              </select>
            </label>
            <label className="table-filter" aria-label="Filter logs by method">
              <select value={method} onChange={(event) => setMethod(event.target.value)}>
                <option value="all">All methods</option>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PATCH">PATCH</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
            </label>
            <label className="table-filter" aria-label="Filter logs by event type">
              <select value={eventType} onChange={(event) => setEventType(event.target.value)}>
                <option value="all">All events</option>
                <option value="request">Requests</option>
                <option value="error">Errors</option>
              </select>
            </label>
          </div>
        </div>

        <div className="activity-log-list" aria-busy={loading}>
          {logs.length === 0 && !loading && (
            <p className="muted">No activity logs match the selected filters.</p>
          )}
          {logs.map((log) => (
            <article className={`activity-log-row ${log.level}`} key={log.id}>
              <div className="activity-log-status">
                <span className={`activity-level ${log.level}`}>{log.level}</span>
                <strong>{log.status_code || '-'}</strong>
                <small>{log.duration_ms == null ? '-' : `${log.duration_ms}ms`}</small>
              </div>
              <div className="activity-log-main">
                <div className="activity-log-head">
                  <div>
                    <strong>{log.action}</strong>
                    <span>{formatDate(log.created_at)}</span>
                  </div>
                  <code>{log.method || 'SYS'} {log.path || ''}</code>
                </div>
                <p>{log.message || 'Activity recorded'}</p>
                <div className="activity-log-meta">
                  <span>{log.firm_name || 'No firm'}</span>
                  <span>{log.user_name || log.user_email || 'Unauthenticated'}</span>
                  <span>{log.event_type}</span>
                </div>
                {(log.metadata || log.error_stack) && (
                  <details className="activity-details">
                    <summary>Details</summary>
                    {log.metadata && <pre>{formatMetadata(log.metadata)}</pre>}
                    {log.error_stack && <pre>{log.error_stack}</pre>}
                  </details>
                )}
              </div>
            </article>
          ))}
          {loading && payload && <p className="muted">Refreshing activity logs...</p>}
        </div>
      </section>
    </section>
  );
}
