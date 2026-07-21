import { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Database,
  Filter,
  LogIn,
  PauseCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  X
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { ButtonSpinner, PageLoader } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

const emptyForm = {
  name: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  address: ''
};

export default function FirmsPage() {
  const [searchParams] = useSearchParams();
  const [firms, setFirms] = useState([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, suspended: 0 });
  const [form, setForm] = useState(emptyForm);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingFirm, setEditingFirm] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pageLoading, setPageLoading] = useState(true);
  const [loading, setLoading] = useState(false);

  function loadFirms() {
    return apiRequest('/api/firms').then((result) => {
      setFirms(result.firms);
      setSummary(result.summary);
    });
  }

  useEffect(() => {
    setPageLoading(true);
    loadFirms()
      .catch((err) => setError(err.message))
      .finally(() => setPageLoading(false));
  }, []);

  useEffect(() => {
    setSearchTerm(searchParams.get('q') || '');
  }, [searchParams]);

  const filteredFirms = firms.filter((firm) => {
    const searchText = [
      firm.name,
      firm.slug,
      firm.contact_name,
      firm.contact_email,
      firm.contact_phone,
      firm.address,
      firm.database_name
    ].filter(Boolean).join(' ').toLowerCase();

    const matchesSearch = searchText.includes(searchTerm.trim().toLowerCase());
    const matchesStatus = statusFilter === 'all' || firm.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function closeModal() {
    setModalOpen(false);
    setEditingFirm(null);
    setForm(emptyForm);
  }

  function openCreateModal() {
    setEditingFirm(null);
    setForm(emptyForm);
    setError('');
    setMessage('');
    setModalOpen(true);
  }

  function openEditModal(firm) {
    setEditingFirm(firm);
    setForm({
      name: firm.name || '',
      contact_name: firm.contact_name || '',
      contact_email: firm.contact_email || '',
      contact_phone: firm.contact_phone || '',
      address: firm.address || ''
    });
    setError('');
    setMessage('');
    setModalOpen(true);
  }

  async function saveFirm() {
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const result = editingFirm
        ? await apiRequest(`/api/firms/${editingFirm.id}`, { method: 'PATCH', body: form })
        : await apiRequest('/api/firms', { method: 'POST', body: form });

      setMessage(
        editingFirm
          ? `${result.firm.name} was updated.`
          : `${result.firm.name} was onboarded with its own database.`
      );
      await loadFirms();
      closeModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();

    setConfirmDialog({
      title: editingFirm ? 'Save firm changes?' : 'Create firm database?',
      message: editingFirm
        ? `This will update ${form.name || 'this firm'} in the admin registry and its firm profile.`
        : `This will onboard ${form.name || 'this firm'} and create an isolated database for it.`,
      confirmLabel: editingFirm ? 'Save changes' : 'Create database',
      tone: 'info',
      onConfirm: saveFirm
    });
  }

  async function changeFirmStatus(firm, status) {
    setError('');
    setMessage('');

    try {
      await apiRequest(`/api/firms/${firm.id}/status`, { method: 'PATCH', body: { status } });
      setMessage(`${firm.name} is now ${status}.`);
      await loadFirms();
    } catch (err) {
      setError(err.message);
    }
  }

  function updateStatus(firm, status) {
    setConfirmDialog({
      title: `${status === 'active' ? 'Activate' : 'Suspend'} firm?`,
      message: `${firm.name} will be marked as ${status}. You can change this again later.`,
      confirmLabel: status === 'active' ? 'Activate firm' : 'Suspend firm',
      tone: status === 'active' ? 'success' : 'warning',
      onConfirm: () => changeFirmStatus(firm, status)
    });
  }

  async function removeFirm(firm) {
    setError('');
    setMessage('');

    try {
      await apiRequest(`/api/firms/${firm.id}`, { method: 'DELETE' });
      setMessage(`${firm.name} and its database were deleted.`);
      await loadFirms();
    } catch (err) {
      setError(err.message);
    }
  }

  function deleteFirm(firm) {
    setConfirmDialog({
      title: 'Delete firm?',
      message: `${firm.name} and its isolated database files will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Delete firm',
      tone: 'danger',
      onConfirm: () => removeFirm(firm)
    });
  }

  function confirmAction() {
    const action = confirmDialog?.onConfirm;
    setConfirmDialog(null);
    if (action) action();
  }

  if (pageLoading && !error) return <PageLoader label="Loading firms..." />;

  return (
    <section className="page-stack">
      <div className="section-header">
        <div>
          <h2>Law firms</h2>
          <p>Admin view of every onboarded firm and its database details.</p>
        </div>
      </div>

      <div className="firm-stats">
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><Building2 size={22} /></span>
            <strong>{summary.total}</strong>
          </div>
          <div className="metric-body">
            <span>Total firms</span>
          </div>
          <small>Registered law firm workspaces</small>
        </div>
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><CheckCircle2 size={22} /></span>
            <strong>{summary.active}</strong>
          </div>
          <div className="metric-body">
            <span>Active</span>
          </div>
          <small>Available for claim processing</small>
        </div>
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><PauseCircle size={22} /></span>
            <strong>{summary.suspended}</strong>
          </div>
          <div className="metric-body">
            <span>Suspended</span>
          </div>
          <small>Paused from normal use</small>
        </div>
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><Database size={22} /></span>
            <strong>{firms.length}</strong>
          </div>
          <div className="metric-body">
            <span>Databases</span>
          </div>
          <small>Isolated firm data stores</small>
        </div>
      </div>

      <StatusMessage type="error">{error}</StatusMessage>
      <StatusMessage type="success">{message}</StatusMessage>

      <section className="panel">
        <div className="panel-header firm-table-header">
          <div>
            <h3>All law firms</h3>
            <p>Complete firm records from the admin database.</p>
          </div>
          <div className="firm-table-tools">
            <label className="table-search" aria-label="Search law firms">
              <Search size={16} />
              <input
                type="search"
                placeholder="Search firms"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>
            <label className="table-filter" aria-label="Filter law firms by status">
              <Filter size={16} />
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All status</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </label>
            <button className="primary-button" type="button" onClick={openCreateModal}>
              <Plus size={17} />
              Onboard firm
            </button>
          </div>
        </div>

        <div className="firm-table-wrap">
          {firms.length === 0 && <p className="muted">No firms onboarded yet.</p>}
          {firms.length > 0 && filteredFirms.length === 0 && <p className="muted">No firms match the selected filters.</p>}
          {filteredFirms.length > 0 && (
            <table className="firm-table">
              <thead>
                <tr>
                  <th>Firm</th>
                  <th>Contact person</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th>Database</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredFirms.map((firm) => (
                  <tr key={firm.id}>
                    <td data-label="Firm">
                      <strong>{firm.name}</strong>
                      <span>{firm.slug}</span>
                    </td>
                    <td data-label="Contact person">{firm.contact_name || '-'}</td>
                    <td data-label="Email">{firm.contact_email || '-'}</td>
                    <td data-label="Phone">{firm.contact_phone || '-'}</td>
                    <td data-label="Address">{firm.address || '-'}</td>
                    <td data-label="Status"><span className={`status-pill ${firm.status}`}>{firm.status}</span></td>
                    <td data-label="Database"><code>{firm.database_name}</code></td>
                    <td data-label="Created">{new Date(firm.created_at).toLocaleDateString()}</td>
                    <td data-label="Action">
                      <div className="table-actions">
                        <a
                          href={`/firm/${firm.slug}/workspace`}
                          target="_blank"
                          rel="noreferrer"
                          title="Access firm workspace in a new tab"
                          aria-label={`Access ${firm.name} workspace in a new tab`}
                        >
                          <LogIn size={15} />
                        </a>
                        <button type="button" onClick={() => openEditModal(firm)} title="Edit firm" aria-label={`Edit ${firm.name}`}>
                          <Pencil size={15} />
                        </button>
                        {firm.status === 'active' ? (
                          <button type="button" onClick={() => updateStatus(firm, 'suspended')} title="Suspend firm" aria-label={`Suspend ${firm.name}`}>
                            <PauseCircle size={15} />
                          </button>
                        ) : (
                          <button type="button" onClick={() => updateStatus(firm, 'active')} title="Activate firm" aria-label={`Activate ${firm.name}`}>
                            <CheckCircle2 size={15} />
                          </button>
                        )}
                        <button className="danger-icon" type="button" onClick={() => deleteFirm(firm)} title="Delete firm" aria-label={`Delete ${firm.name}`}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {modalOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="firm-modal-title">
            <div className="modal-header">
              <div>
                <h3 id="firm-modal-title">{editingFirm ? 'Edit law firm' : 'Onboard law firm'}</h3>
                <p>{editingFirm ? 'Update the central firm record and firm profile.' : 'Create a firm record and isolated database.'}</p>
              </div>
              <button className="icon-button ghost" type="button" onClick={closeModal} aria-label="Close modal">
                <X size={18} />
              </button>
            </div>

            <form className="form-stack firm-form" onSubmit={handleSubmit}>
              <label>
                Firm name
                <input value={form.name} onChange={(event) => updateField('name', event.target.value)} required />
              </label>
              <div className="form-grid">
                <label>
                  Contact person
                  <input value={form.contact_name} onChange={(event) => updateField('contact_name', event.target.value)} />
                </label>
                <label>
                  Contact email
                  <input type="email" value={form.contact_email} onChange={(event) => updateField('contact_email', event.target.value)} />
                </label>
              </div>
              <label>
                Contact phone
                <input value={form.contact_phone} onChange={(event) => updateField('contact_phone', event.target.value)} />
              </label>
              <label>
                Address
                <textarea rows="4" value={form.address} onChange={(event) => updateField('address', event.target.value)} />
              </label>

              <div className="modal-actions">
                <button className="secondary-button" type="button" onClick={closeModal}>Cancel</button>
                <button className="primary-button" disabled={loading}>
                  {loading ? <ButtonSpinner label="Saving..." /> : editingFirm ? <Pencil size={17} /> : <Plus size={17} />}
                  {!loading && (editingFirm ? 'Save changes' : 'Create firm database')}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {confirmDialog && (
        <div className="modal-backdrop confirm-backdrop" role="presentation">
          <section className={`confirm-panel ${confirmDialog.tone}`} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <div className="confirm-icon" aria-hidden="true">
              {confirmDialog.tone === 'danger' ? <Trash2 size={22} /> : <CheckCircle2 size={22} />}
            </div>
            <div className="confirm-copy">
              <h3 id="confirm-title">{confirmDialog.title}</h3>
              <p>{confirmDialog.message}</p>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setConfirmDialog(null)}>Cancel</button>
              <button
                className={confirmDialog.tone === 'danger' ? 'danger-button' : 'primary-button'}
                type="button"
                onClick={confirmAction}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
