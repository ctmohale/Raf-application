import { useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, BellRing, BriefcaseBusiness, FileCheck2, FolderOpen, Plus, UploadCloud, Users, X } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ButtonSpinner, PageLoader } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

const emptyClient = {
  first_name: '',
  surname: '',
  id_number: '',
  cell: '',
  email: '',
  accident_date: '',
  auto_reminders_enabled: false,
  reminder_time: '09:00'
};

function WorkspaceMetric({ icon, label, value, detail }) {
  return (
    <div className="metric">
      <div className="firm-stat-top">
        <span className="metric-icon">{icon}</span>
        <strong>{value}</strong>
      </div>
      <div className="metric-body">
        <span>{label}</span>
      </div>
      <small>{detail}</small>
    </div>
  );
}

export default function FirmWorkspacePage() {
  const { id } = useParams();
  const [workspace, setWorkspace] = useState(null);
  const [clientForm, setClientForm] = useState(emptyClient);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  function loadWorkspace() {
    return apiRequest(`/api/firms/${id}/workspace`).then(setWorkspace);
  }

  useEffect(() => {
    loadWorkspace().catch((err) => setError(err.message));
  }, [id]);

  function updateClientField(field, value) {
    setClientForm((current) => ({ ...current, [field]: value }));
  }

  function closeClientModal() {
    setClientModalOpen(false);
    setClientForm(emptyClient);
  }

  async function onboardClient(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const result = await apiRequest(`/api/firms/${id}/clients`, { method: 'POST', body: clientForm });
      setWorkspace(result.workspace);
      setMessage(`${result.client.first_name} ${result.client.surname} was onboarded. Client upload link is ready${clientForm.auto_reminders_enabled ? ` and automatic reminders are set for ${clientForm.reminder_time}` : ''}.`);
      closeClientModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!workspace) return <PageLoader label="Loading firm workspace..." />;
  const totalClients = Number(workspace.stats.clients || 0);
  const totalClaims = Number(workspace.cases?.length || workspace.stats.openCases || 0);
  const openClaims = Number(workspace.stats.openCases || 0);
  const requestedDocuments = workspace.clients.reduce((sum, client) => sum + Number(client.requested_documents || 0), 0);
  const uploadedDocuments = Number(workspace.stats.uploadedDocuments || workspace.clients.reduce((sum, client) => sum + Number(client.uploaded_documents || 0), 0));
  const pendingDocuments = workspace.clients.reduce((sum, client) => sum + Number(client.pending_documents || 0), 0);
  const clientsWithClaims = workspace.clients.filter((client) => Number(client.case_count || 0) > 0).length;
  const clientsReady = workspace.clients.filter((client) => Number(client.requested_documents || 0) > 0 && Number(client.pending_documents || 0) === 0).length;
  const clientsWaitingForDocs = workspace.clients.filter((client) => Number(client.pending_documents || 0) > 0).length;
  const remindersDue = Number(workspace.stats.remindersDue || 0);
  const documentCompletionRate = requestedDocuments > 0 ? Math.round((uploadedDocuments / requestedDocuments) * 100) : 0;
  const claimCoverageRate = totalClients > 0 ? Math.round((clientsWithClaims / totalClients) * 100) : 0;
  const averageDocsPerClient = totalClients > 0 ? (requestedDocuments / totalClients).toFixed(1) : '0.0';
  const graphMax = Math.max(totalClients, totalClaims, requestedDocuments, uploadedDocuments, pendingDocuments, 1);
  const lineGraph = [
    { label: 'Clients', value: totalClients },
    { label: 'Claims', value: totalClaims },
    { label: 'Requests', value: requestedDocuments },
    { label: 'Received', value: uploadedDocuments },
    { label: 'Outstanding', value: pendingDocuments }
  ];
  const lineChartWidth = 620;
  const lineChartHeight = 210;
  const lineChartPadding = { top: 26, right: 26, bottom: 34, left: 34 };
  const lineChartInnerWidth = lineChartWidth - lineChartPadding.left - lineChartPadding.right;
  const lineChartInnerHeight = lineChartHeight - lineChartPadding.top - lineChartPadding.bottom;
  const lineChartMax = Math.max(5, Math.ceil(graphMax / 5) * 5);
  const linePoints = lineGraph.map((item, index) => ({
    ...item,
    x: lineChartPadding.left + (index / (lineGraph.length - 1)) * lineChartInnerWidth,
    y: lineChartPadding.top + (1 - item.value / lineChartMax) * lineChartInnerHeight
  }));
  const firmLinePath = linePoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const firmLineFill = `${firmLinePath} L ${linePoints.at(-1).x} ${lineChartHeight - lineChartPadding.bottom} L ${linePoints[0].x} ${lineChartHeight - lineChartPadding.bottom} Z`;
  const activityGraph = [
    { label: 'Ready', value: clientsReady, detail: 'clients complete' },
    { label: 'Waiting', value: clientsWaitingForDocs, detail: 'need documents' },
    { label: 'Due', value: remindersDue, detail: 'reminders due' }
  ];
  const activityGraphMax = Math.max(...activityGraph.map((item) => item.value), 1);

  return (
    <section className="page-stack">
      <div className="section-header">
        <div>
          <h2>{workspace.firm.name}</h2>
          <p>Law firm analytics for RAF client intake, claim activity, and document readiness.</p>
        </div>
      </div>

      <div className="firm-stats firm-workspace-stats">
        <WorkspaceMetric icon={<Users size={22} />} label="Clients" value={totalClients} detail={`${clientsWithClaims} linked to claim applications`} />
        <WorkspaceMetric icon={<BriefcaseBusiness size={22} />} label="Open RAF cases" value={openClaims} detail={`${claimCoverageRate}% client claim coverage`} />
        <WorkspaceMetric icon={<FolderOpen size={22} />} label="Outstanding documents" value={pendingDocuments} detail={`${remindersDue} reminder(s) due`} />
        <WorkspaceMetric icon={<FileCheck2 size={22} />} label="Document readiness" value={`${documentCompletionRate}%`} detail={`${uploadedDocuments}/${requestedDocuments} files received`} />
      </div>

      <StatusMessage type="error">{error}</StatusMessage>
      <StatusMessage type="success">{message}</StatusMessage>

      <div className="firm-graph-grid">
        <section className="panel firm-line-card">
          <div className="panel-header">
            <div>
              <h3>Firm Performance</h3>
              <p>Client-to-claim pipeline and document collection progress.</p>
            </div>
            <BarChart3 size={18} />
          </div>
          <div className="firm-line-chart" role="img" aria-label="Firm clients claims and document intake line graph">
            <svg viewBox={`0 0 ${lineChartWidth} ${lineChartHeight}`} preserveAspectRatio="xMidYMid meet">
              <defs>
                <linearGradient id="firmLineFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#1593E7" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#1593E7" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path className="firm-line-grid" d={`M ${lineChartPadding.left} ${lineChartPadding.top} H ${lineChartWidth - lineChartPadding.right} M ${lineChartPadding.left} ${lineChartPadding.top + lineChartInnerHeight / 2} H ${lineChartWidth - lineChartPadding.right} M ${lineChartPadding.left} ${lineChartHeight - lineChartPadding.bottom} H ${lineChartWidth - lineChartPadding.right}`} />
              <path className="firm-line-fill" d={firmLineFill} />
              <path className="firm-line-path" d={firmLinePath} />
              {linePoints.map((point) => (
                <g className="firm-line-point" key={point.label}>
                  <circle cx={point.x} cy={point.y} r="4" />
                  <text x={point.x} y={point.y - 10}>{point.value}</text>
                </g>
              ))}
              {linePoints.map((point) => (
                <text className="firm-line-label" x={point.x} y={lineChartHeight - 8} key={point.label}>{point.label}</text>
              ))}
            </svg>
          </div>
          <div className="firm-line-summary">
            <span><strong>{claimCoverageRate}%</strong> claim coverage</span>
            <span><strong>{documentCompletionRate}%</strong> readiness</span>
            <span><strong>{averageDocsPerClient}</strong> docs/client</span>
            <span><strong>{pendingDocuments}</strong> outstanding</span>
          </div>
        </section>

        <section className="panel firm-graph-card">
          <div className="panel-header">
            <div>
              <h3>Attention Needed</h3>
              <p>Clients ready, waiting for documents, and reminders due.</p>
            </div>
            <AlertTriangle size={18} />
          </div>
          <div className="firm-mini-columns">
            {activityGraph.map((item) => (
              <div className="firm-mini-column" key={item.label}>
                <div><i style={{ height: `${Math.max(8, (item.value / activityGraphMax) * 100)}%` }} /></div>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>
          <div className="firm-attention-summary">
            <span><strong>{uploadedDocuments}</strong> received</span>
            <span><strong>{pendingDocuments}</strong> outstanding</span>
            <span><strong>{workspace.stats.autoReminders || 0}</strong> auto-reminders</span>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header firm-table-header">
          <div>
            <h3>Client onboarding</h3>
            <p>Create client records and RAF intake requests for this firm.</p>
          </div>
          <div className="firm-table-tools">
            <button className="primary-button" type="button" onClick={() => setClientModalOpen(true)}>
              <Plus size={17} />
              Onboard client
            </button>
          </div>
        </div>
      </section>

      {clientModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="client-modal-title">
            <div className="modal-header">
              <div>
                <h3 id="client-modal-title">Onboard client</h3>
                <p>Create the RAF case and document upload requests.</p>
              </div>
              <button className="icon-button ghost" type="button" onClick={closeClientModal} aria-label="Close modal">
                <X size={18} />
              </button>
            </div>
            <form className="form-stack firm-form" onSubmit={onboardClient}>
              <div className="form-grid">
                <label>
                  First name
                  <input value={clientForm.first_name} onChange={(event) => updateClientField('first_name', event.target.value)} required />
                </label>
                <label>
                  Surname
                  <input value={clientForm.surname} onChange={(event) => updateClientField('surname', event.target.value)} required />
                </label>
              </div>
              <label>
                ID number
                <input value={clientForm.id_number} onChange={(event) => updateClientField('id_number', event.target.value)} required />
              </label>
              <div className="form-grid">
                <label>
                  Cell
                  <input value={clientForm.cell} onChange={(event) => updateClientField('cell', event.target.value)} required />
                </label>
                <label>
                  Email
                  <input type="email" value={clientForm.email} onChange={(event) => updateClientField('email', event.target.value)} required />
                </label>
              </div>
              <label>
                Accident date
                <input type="date" value={clientForm.accident_date} onChange={(event) => updateClientField('accident_date', event.target.value)} />
              </label>
              <section className="reminder-settings">
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={clientForm.auto_reminders_enabled}
                    onChange={(event) => updateClientField('auto_reminders_enabled', event.target.checked)}
                  />
                  <span>Enable automatic reminders for pending documents</span>
                </label>
                {clientForm.auto_reminders_enabled && (
                  <label>
                    Reminder time
                    <input
                      type="time"
                      value={clientForm.reminder_time}
                      onChange={(event) => updateClientField('reminder_time', event.target.value)}
                      required
                    />
                  </label>
                )}
              </section>
              <div className="modal-actions">
                <button className="secondary-button" type="button" onClick={closeClientModal}>Cancel</button>
                <button className="primary-button" disabled={loading}>
                  {loading ? <ButtonSpinner label="Creating..." /> : clientForm.auto_reminders_enabled ? <BellRing size={17} /> : <UploadCloud size={17} />}
                  {!loading && 'Create client intake'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
