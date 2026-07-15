import { useEffect, useState } from 'react';
import { BellRing, BriefcaseBusiness, FileCheck2, Filter, FolderOpen, Plus, UploadCloud, Users, X } from 'lucide-react';
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
  const [pipelineFilter, setPipelineFilter] = useState('all');
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
  const pipelineFilterOptions = [
    { value: 'all', label: 'All matters' },
    { value: 'waiting', label: 'Waiting docs' },
    { value: 'ready', label: 'Ready' },
    { value: 'claims', label: 'Claim-linked' },
    { value: 'unlinked', label: 'No claim yet' },
    { value: 'reminders', label: 'Reminders due' }
  ];
  const filteredPipelineClients = workspace.clients.filter((client) => {
    const requested = Number(client.requested_documents || 0);
    const pending = Number(client.pending_documents || 0);
    const hasClaim = Number(client.case_count || 0) > 0;

    if (pipelineFilter === 'waiting') return pending > 0;
    if (pipelineFilter === 'ready') return requested > 0 && pending === 0;
    if (pipelineFilter === 'claims') return hasClaim;
    if (pipelineFilter === 'unlinked') return !hasClaim;
    if (pipelineFilter === 'reminders') return Boolean(client.reminder_due);
    return true;
  });
  const filteredPipelineClientIds = new Set(filteredPipelineClients.map((client) => String(client.id)));
  const filteredPipelineCases = (workspace.cases || []).filter((caseRecord) => filteredPipelineClientIds.has(String(caseRecord.client_id)));
  const filteredPipelineLabel = pipelineFilterOptions.find((option) => option.value === pipelineFilter)?.label || 'All matters';
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
  const filteredTotalClients = filteredPipelineClients.length;
  const filteredTotalClaims = filteredPipelineCases.length;
  const filteredOpenClaims = filteredPipelineCases.filter((caseRecord) => caseRecord.status !== 'closed').length;
  const filteredRequestedDocuments = filteredPipelineClients.reduce((sum, client) => sum + Number(client.requested_documents || 0), 0);
  const filteredUploadedDocuments = filteredPipelineClients.reduce((sum, client) => sum + Number(client.uploaded_documents || 0), 0);
  const filteredPendingDocuments = filteredPipelineClients.reduce((sum, client) => sum + Number(client.pending_documents || 0), 0);
  const filteredClientsWithClaims = filteredPipelineClients.filter((client) => Number(client.case_count || 0) > 0).length;
  const filteredRemindersDue = filteredPipelineClients.filter((client) => client.reminder_due).length;
  const filteredDocumentCompletionRate = filteredRequestedDocuments > 0 ? Math.round((filteredUploadedDocuments / filteredRequestedDocuments) * 100) : 0;
  const filteredClaimCoverageRate = filteredTotalClients > 0 ? Math.round((filteredClientsWithClaims / filteredTotalClients) * 100) : 0;
  const filteredAverageDocsPerClient = filteredTotalClients > 0 ? (filteredRequestedDocuments / filteredTotalClients).toFixed(1) : '0.0';
  const pipelineMax = Math.max(filteredTotalClients, filteredTotalClaims, filteredRequestedDocuments, filteredUploadedDocuments, filteredPendingDocuments, 1);
  const pipelineRows = [
    { label: 'Clients', shortLabel: 'Clients', value: filteredTotalClients, detail: `${filteredClientsWithClaims} linked` },
    { label: 'Claims', shortLabel: 'Claims', value: filteredTotalClaims, detail: `${filteredOpenClaims} open` },
    { label: 'Documents requested', shortLabel: 'Requested', value: filteredRequestedDocuments, detail: `${filteredAverageDocsPerClient}/client` },
    { label: 'Documents received', shortLabel: 'Received', value: filteredUploadedDocuments, detail: `${filteredDocumentCompletionRate}% ready` },
    { label: 'Outstanding', value: filteredPendingDocuments, detail: `${filteredRemindersDue} reminders due`, tone: 'warning' }
  ];
  const pipelineChart = {
    width: 640,
    height: 230,
    top: 30,
    right: 34,
    bottom: 34,
    left: 40
  };
  const pipelineMidLabel = Math.ceil(pipelineMax / 2);
  const pipelineInnerWidth = pipelineChart.width - pipelineChart.left - pipelineChart.right;
  const pipelineInnerHeight = pipelineChart.height - pipelineChart.top - pipelineChart.bottom;
  const pipelinePoints = pipelineRows.map((item, index) => {
    const x = pipelineChart.left + (index / Math.max(pipelineRows.length - 1, 1)) * pipelineInnerWidth;
    const y = pipelineChart.top + (1 - item.value / pipelineMax) * pipelineInnerHeight;
    return { ...item, x, y };
  });
  const pipelineLine = pipelinePoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const pipelineCurve = pipelinePoints.map((point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = pipelinePoints[index - 1];
    const controlOffset = (point.x - previous.x) / 2;
    return `C ${previous.x + controlOffset} ${previous.y}, ${point.x - controlOffset} ${point.y}, ${point.x} ${point.y}`;
  }).join(' ');
  const pipelineFill = `${pipelineCurve} L ${pipelinePoints.at(-1).x} ${pipelineChart.height - pipelineChart.bottom} L ${pipelinePoints[0].x} ${pipelineChart.height - pipelineChart.bottom} Z`;
  const collectionPriorities = [
    { label: 'Outstanding files', value: pendingDocuments, detail: `${clientsWaitingForDocs} client${clientsWaitingForDocs === 1 ? '' : 's'} waiting` },
    { label: 'Follow-ups due', value: remindersDue, detail: `${workspace.stats.autoReminders || 0} auto-reminder${Number(workspace.stats.autoReminders || 0) === 1 ? '' : 's'} active` },
    { label: 'Ready clients', value: clientsReady, detail: 'complete document sets' }
  ];
  const collectionFilesLabel = requestedDocuments > 0
    ? `${uploadedDocuments}/${requestedDocuments} files received`
    : 'No files requested yet';
  const collectionNote = pendingDocuments > 0
    ? 'Chase outstanding files before RAF lodgement prep.'
    : 'Document collection is clear for the current requests.';

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
              <h3>Pipeline Snapshot</h3>
              <p>{filteredPipelineLabel} client matters and document movement.</p>
            </div>
            <label className="table-filter pipeline-filter" aria-label="Filter pipeline snapshot">
              <Filter size={16} />
              <select value={pipelineFilter} onChange={(event) => setPipelineFilter(event.target.value)}>
                {pipelineFilterOptions.map((option) => (
                  <option value={option.value} key={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="pipeline-filter-summary" aria-label="Pipeline filter summary">
            <span><strong>{filteredTotalClients}</strong> clients</span>
            <span><strong>{filteredTotalClaims}</strong> claims</span>
            <span><strong>{filteredRequestedDocuments}</strong> requested</span>
            <span><strong>{filteredPendingDocuments}</strong> outstanding</span>
          </div>
          <div className="chart-wrap firm-pipeline-chart" aria-label="Firm pipeline line chart">
            <div className="chart-plot" role="img" aria-label={`Pipeline by stage, up to ${pipelineMax}`}>
              <div className="chart-scale" aria-hidden="true">
                <span>{pipelineMax}</span>
                <span>{pipelineMidLabel}</span>
                <span>0</span>
              </div>
              <div className="line-chart">
                <svg viewBox={`0 0 ${pipelineChart.width} ${pipelineChart.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Firm pipeline line graph">
                  <defs>
                    <linearGradient id="firmPipelineGradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#1593E7" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#1593E7" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path className="chart-grid" d={`M ${pipelineChart.left} ${pipelineChart.top} H ${pipelineChart.width - pipelineChart.right} M ${pipelineChart.left} ${pipelineChart.top + pipelineInnerHeight / 2} H ${pipelineChart.width - pipelineChart.right} M ${pipelineChart.left} ${pipelineChart.height - pipelineChart.bottom} H ${pipelineChart.width - pipelineChart.right}`} />
                  <path className="chart-fill firm-pipeline-fill" d={pipelineFill} />
                  <path className="chart-line" d={pipelineCurve || pipelineLine} />
                  {pipelinePoints.map((point) => (
                    <g className="chart-point" key={point.label}>
                      <circle cx={point.x} cy={point.y} r="5" />
                      <text x={point.x} y={point.y - 13}>{point.value}</text>
                    </g>
                  ))}
                  {pipelinePoints.map((point) => (
                    <text className="chart-month-label" x={point.x} y={pipelineChart.height - 8} key={point.label}>{point.shortLabel || point.label}</text>
                  ))}
                </svg>
              </div>
            </div>
          </div>
          <div className="firm-line-summary">
            <span><strong>{filteredClaimCoverageRate}%</strong> claim coverage</span>
            <span><strong>{filteredDocumentCompletionRate}%</strong> readiness</span>
            <span><strong>{filteredAverageDocsPerClient}</strong> docs/client</span>
            <span><strong>{filteredPendingDocuments}</strong> outstanding</span>
          </div>
        </section>

        <section className="panel firm-graph-card firm-collection-card">
          <div className="panel-header">
            <div>
              <h3>Document Collection</h3>
              <p>Readiness, follow-ups, and the next admin priority.</p>
            </div>
            <BellRing size={18} />
          </div>
          <div className="firm-collection-progress">
            <div>
              <strong>{documentCompletionRate}%</strong>
              <span>document readiness</span>
            </div>
            <small>{collectionFilesLabel}</small>
            <div className="firm-collection-meter" aria-hidden="true">
              <i style={{ width: `${Math.min(100, Math.max(0, documentCompletionRate))}%` }} />
            </div>
          </div>
          <div className="firm-collection-priority">
            {collectionPriorities.map((item) => (
              <div className="firm-collection-row" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>
          <p className="firm-collection-note">{collectionNote}</p>
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
