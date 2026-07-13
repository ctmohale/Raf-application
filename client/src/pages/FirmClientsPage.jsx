import { useEffect, useState } from 'react';
import { BellRing, BriefcaseBusiness, Copy, FileCheck2, Filter, Mail, Plus, Search, Send, UploadCloud, Users, X } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
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

const emptyEmail = {
  subject: '',
  body: ''
};

export default function FirmClientsPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [workspace, setWorkspace] = useState(null);
  const [clientForm, setClientForm] = useState(emptyClient);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [documentFilter, setDocumentFilter] = useState('all');
  const [reminderFilter, setReminderFilter] = useState('all');
  const [emailClient, setEmailClient] = useState(null);
  const [emailForm, setEmailForm] = useState(emptyEmail);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  function loadWorkspace() {
    return apiRequest(`/api/firms/${id}/workspace`).then(setWorkspace);
  }

  useEffect(() => {
    loadWorkspace().catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => {
    setSearchTerm(searchParams.get('q') || '');
  }, [searchParams]);

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

  async function copyInvite(client) {
    await navigator.clipboard.writeText(client.invite_url);
    setMessage(`Upload link copied for ${client.first_name} ${client.surname}.`);
  }

  function openEmailModal(client) {
    setEmailClient(client);
    setEmailForm({
      subject: `RAF document request - ${client.first_name} ${client.surname}`,
      body: `Hi ${client.first_name},\n\nPlease use your upload link to send the outstanding RAF documents.\n\nUpload link: ${client.invite_url}\n\nRegards`
    });
  }

  function closeEmailModal() {
    setEmailClient(null);
    setEmailForm(emptyEmail);
  }

  async function sendClientEmail(event) {
    event.preventDefault();
    if (!emailClient) return;
    setSendingEmail(true);
    setError('');
    setMessage('');

    try {
      const result = await apiRequest(`/api/firms/${id}/clients/${emailClient.id}/email`, {
        method: 'POST',
        body: emailForm
      });
      setMessage(result.sent ? `Email sent to ${emailClient.first_name} ${emailClient.surname}.` : `Email logged for ${emailClient.first_name} ${emailClient.surname}.`);
      closeEmailModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingEmail(false);
    }
  }

  if (!workspace) return <PageLoader label="Loading clients..." />;
  const clients = workspace.clients || [];
  const filteredClients = clients.filter((client) => {
    const requestedDocuments = Number(client.requested_documents || 0);
    const uploadedDocuments = Number(client.uploaded_documents || 0);
    const pendingDocuments = Number(client.pending_documents || Math.max(requestedDocuments - uploadedDocuments, 0));
    const searchText = [
      client.first_name,
      client.surname,
      client.id_number,
      client.cell,
      client.email
    ].filter(Boolean).join(' ').toLowerCase();

    const matchesSearch = searchText.includes(searchTerm.trim().toLowerCase());
    const matchesDocuments =
      documentFilter === 'all' ||
      (documentFilter === 'pending' && pendingDocuments > 0) ||
      (documentFilter === 'complete' && requestedDocuments > 0 && pendingDocuments === 0);
    const matchesReminders =
      reminderFilter === 'all' ||
      (reminderFilter === 'on' && client.auto_reminders_enabled) ||
      (reminderFilter === 'due' && client.reminder_due) ||
      (reminderFilter === 'off' && !client.auto_reminders_enabled);

    return matchesSearch && matchesDocuments && matchesReminders;
  });

  return (
    <section className="page-stack">
      <div className="section-header">
        <div>
          <h2>Clients</h2>
          <p>Client records and upload links for {workspace.firm.name}.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setClientModalOpen(true)}>
          <Plus size={17} />
          Onboard client
        </button>
      </div>

      <StatusMessage type="error">{error}</StatusMessage>
      <StatusMessage type="success">{message}</StatusMessage>

      <div className="firm-stats">
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><Users size={22} /></span>
            <strong>{workspace.stats.clients}</strong>
          </div>
          <div className="metric-body">
            <span>Clients</span>
          </div>
          <small>People onboarded by this firm</small>
        </div>
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><FileCheck2 size={22} /></span>
            <strong>{workspace.stats.uploadedDocuments}</strong>
          </div>
          <div className="metric-body">
            <span>Uploaded docs</span>
          </div>
          <small>Received client files</small>
        </div>
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><BriefcaseBusiness size={22} /></span>
            <strong>{workspace.stats.openCases}</strong>
          </div>
          <div className="metric-body">
            <span>Open RAF cases</span>
          </div>
          <small>Active client applications</small>
        </div>
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><UploadCloud size={22} /></span>
            <strong>{workspace.stats.requestedDocuments}</strong>
          </div>
          <div className="metric-body">
            <span>Pending docs</span>
          </div>
          <small>Outstanding client files</small>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header firm-table-header">
          <div>
            <h3>Firm clients</h3>
            <p>Onboarded clients and upload links for RAF applications.</p>
          </div>
          <div className="firm-table-tools">
            <label className="table-search" aria-label="Search clients">
              <Search size={16} />
              <input
                type="search"
                placeholder="Search clients"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>
            <label className="table-filter" aria-label="Filter clients by document status">
              <Filter size={16} />
              <select value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)}>
                <option value="all">All documents</option>
                <option value="pending">Pending docs</option>
                <option value="complete">Complete docs</option>
              </select>
            </label>
            <label className="table-filter" aria-label="Filter clients by reminder status">
              <BellRing size={16} />
              <select value={reminderFilter} onChange={(event) => setReminderFilter(event.target.value)}>
                <option value="all">All reminders</option>
                <option value="on">Reminders on</option>
                <option value="due">Reminder due</option>
                <option value="off">Reminders off</option>
              </select>
            </label>
          </div>
        </div>
        <div className="firm-table-wrap">
          {clients.length === 0 && <p className="muted">No clients onboarded yet.</p>}
          {clients.length > 0 && filteredClients.length === 0 && <p className="muted">No clients match the selected filters.</p>}
          {filteredClients.length > 0 && (
            <table className="firm-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>ID number</th>
                  <th>Cell</th>
                  <th>Email</th>
                  <th>Cases</th>
                  <th>Documents</th>
                  <th>Reminders</th>
	                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.map((client) => (
                  <tr key={client.id}>
                    <td data-label="Client">
                      <strong>{client.first_name} {client.surname}</strong>
                      <span>Added {new Date(client.created_at).toLocaleDateString()}</span>
                    </td>
                    <td data-label="ID number">{client.id_number}</td>
                    <td data-label="Cell">{client.cell}</td>
                    <td data-label="Email">{client.email}</td>
                    <td data-label="Cases">{client.case_count}</td>
                    <td data-label="Documents">{client.uploaded_documents}/{client.requested_documents}</td>
                    <td data-label="Reminders">
                      <span className={`status-pill ${client.auto_reminders_enabled ? client.reminder_due ? 'warning' : 'active' : 'neutral'}`}>
                        {client.auto_reminders_enabled ? client.reminder_due ? 'Due' : 'On' : 'Off'}
                      </span>
                      {client.auto_reminders_enabled && <span>{client.reminder_time}</span>}
                    </td>
	                    <td data-label="Actions">
	                      <button type="button" onClick={() => openEmailModal(client)} title="Email client" aria-label={`Email ${client.first_name}`}>
	                        <Mail size={15} />
	                      </button>
	                      <button type="button" onClick={() => copyInvite(client)} title="Copy client upload link" aria-label={`Copy upload link for ${client.first_name}`}>
	                        <Copy size={15} />
	                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
	      {emailClient && (
	        <div className="modal-backdrop" role="presentation">
	          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="email-client-title">
	            <div className="modal-header">
	              <div>
	                <h3 id="email-client-title">Email client</h3>
	                <p>{emailClient.first_name} {emailClient.surname} · {emailClient.email}</p>
	              </div>
	              <button className="icon-button ghost" type="button" onClick={closeEmailModal} aria-label="Close email modal">
	                <X size={18} />
	              </button>
	            </div>
	            <form className="form-stack firm-form" onSubmit={sendClientEmail}>
	              <label>
	                Subject
	                <input
	                  value={emailForm.subject}
	                  onChange={(event) => setEmailForm((current) => ({ ...current, subject: event.target.value }))}
	                  required
	                />
	              </label>
	              <label>
	                Message
	                <textarea
	                  value={emailForm.body}
	                  onChange={(event) => setEmailForm((current) => ({ ...current, body: event.target.value }))}
	                  rows={8}
	                  required
	                />
	              </label>
	              <div className="modal-actions">
	                <button className="secondary-button" type="button" onClick={closeEmailModal}>Cancel</button>
	                <button className="primary-button" disabled={sendingEmail}>
	                  {sendingEmail ? <ButtonSpinner label="Sending..." /> : <Send size={17} />}
	                  {!sendingEmail && 'Send email'}
	                </button>
	              </div>
	            </form>
	          </section>
	        </div>
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
