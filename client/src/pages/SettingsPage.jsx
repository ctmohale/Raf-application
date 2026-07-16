import { useEffect, useState } from 'react';
import { ShieldCheck, Settings, UserCheck } from 'lucide-react';
import { ButtonSpinner, LoadingSpinner } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const accessRoles = [
  ['staff', 'Staff'],
  ['viewer', 'Viewer'],
  ['admin', 'Admin']
];

const accountStatuses = [
  ['pending', 'Pending'],
  ['active', 'Active'],
  ['suspended', 'Suspended']
];

const firmAccessLevels = [
  ['staff', 'Staff'],
  ['viewer', 'Viewer']
];

export default function SettingsPage({ section = 'workspace' }) {
  const { user } = useAuth();
  const isSecurity = section === 'security';
  const isAdmin = user?.role === 'admin';
  const [users, setUsers] = useState([]);
  const [firms, setFirms] = useState([]);
  const [draftAccess, setDraftAccess] = useState({});
  const [usersLoading, setUsersLoading] = useState(false);
  const [savingUserId, setSavingUserId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isSecurity || !isAdmin) return;
    loadUsers();
  }, [isSecurity, isAdmin]);

  function buildDrafts(rows) {
    return rows.reduce((drafts, row) => {
      const firmAccess = row.firm_access?.[0];
      return {
        ...drafts,
        [row.id]: {
          role: row.role,
          status: row.status,
          firm_id: firmAccess?.firm_id ? String(firmAccess.firm_id) : '',
          firm_access_level: firmAccess?.access_level || 'staff'
        }
      };
    }, {});
  }

  async function loadUsers() {
    setUsersLoading(true);
    setError('');
    try {
      const result = await apiRequest('/api/users');
      setUsers(result.users || []);
      setFirms(result.firms || []);
      setDraftAccess(buildDrafts(result.users || []));
    } catch (err) {
      setError(err.message);
    } finally {
      setUsersLoading(false);
    }
  }

  function updateUserDraft(userId, field, value) {
    setDraftAccess((current) => {
      const currentDraft = current[userId] || {
        role: 'staff',
        status: 'pending',
        firm_id: '',
        firm_access_level: 'staff'
      };
      const nextDraft = { ...currentDraft, [field]: value };
      if (field === 'role' && value === 'viewer') nextDraft.firm_access_level = 'viewer';
      if (field === 'role' && value === 'admin') nextDraft.firm_id = '';
      return { ...current, [userId]: nextDraft };
    });
  }

  async function saveUserAccess(userRow, override = {}) {
    const draft = { ...draftAccess[userRow.id], ...override };
    const body = {
      ...draft,
      firm_id: draft.firm_id || null
    };
    setSavingUserId(userRow.id);
    setError('');
    setMessage('');
    try {
      const result = await apiRequest(`/api/users/${userRow.id}/access`, {
        method: 'PATCH',
        body
      });
      setUsers(result.users || []);
      setDraftAccess(buildDrafts(result.users || []));
      setMessage(`${userRow.name} access updated.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingUserId(null);
    }
  }

  return (
    <section className="page-stack">
      <div className="section-header">
        <div>
          <h2>{isSecurity ? 'Security' : 'Workspace settings'}</h2>
          <p>{isSecurity ? 'Session and access controls for this workspace.' : 'Workspace defaults and operational status.'}</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>{isSecurity ? 'Access' : 'Workspace'}</h3>
            <p>{isSecurity ? 'Signed-in user and role information.' : 'Current app workspace configuration.'}</p>
          </div>
          {isSecurity ? <ShieldCheck size={18} /> : <Settings size={18} />}
        </div>
        <div className="table-list">
          <div className="workspace-row">
            <strong>{isSecurity ? 'Signed in as' : 'Application'}</strong>
            <span>{isSecurity ? `${user?.name || 'User'} · ${user?.role || 'role pending'}` : 'RAFFlow document and firm management'}</span>
          </div>
          <div className="workspace-row">
            <strong>{isSecurity ? 'Email' : 'Storage'}</strong>
            <span>{isSecurity ? user?.email || '-' : 'Firm databases and client uploads are separated by firm'}</span>
          </div>
        </div>
      </section>

      {isSecurity && isAdmin && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>User approvals</h3>
              <p>Approve registered users and assign their workspace access.</p>
            </div>
            <UserCheck size={18} />
          </div>
          <StatusMessage type="success">{message}</StatusMessage>
          <StatusMessage type="error">{error}</StatusMessage>
          {usersLoading ? (
            <div className="notification-loading">
              <LoadingSpinner size="sm" label="Loading users..." />
              <span>Loading users...</span>
            </div>
          ) : (
            <div className="user-access-list">
              {users.map((row) => {
                const draft = draftAccess[row.id] || { role: row.role, status: row.status, firm_id: '', firm_access_level: 'staff' };
                const isSelf = Number(row.id) === Number(user?.id);
                const currentFirmAccess = row.firm_access?.[0];
                const isDirty = draft.role !== row.role
                  || draft.status !== row.status
                  || String(draft.firm_id || '') !== String(currentFirmAccess?.firm_id || '')
                  || draft.firm_access_level !== (currentFirmAccess?.access_level || 'staff');
                const quickApprove = row.status === 'pending' && draft.status === 'pending';
                const firmAccessDisabled = isSelf || draft.role === 'admin';
                const firmLevelDisabled = firmAccessDisabled || draft.role === 'viewer' || !draft.firm_id;
                return (
                  <div className="user-access-row" key={row.id}>
                    <div className="user-access-identity">
                      <strong>{row.name}</strong>
                      <span>{row.email}</span>
                    </div>
                    <span className={`status-pill ${row.status}`}>{row.status}</span>
                    <label>
                      Role
                      <select value={draft.role} onChange={(event) => updateUserDraft(row.id, 'role', event.target.value)} disabled={isSelf}>
                        {accessRoles.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                      </select>
                    </label>
                    <label>
                      Status
                      <select value={draft.status} onChange={(event) => updateUserDraft(row.id, 'status', event.target.value)} disabled={isSelf}>
                        {accountStatuses.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                      </select>
                    </label>
                    <label>
                      Firm
                      <select value={draft.firm_id} onChange={(event) => updateUserDraft(row.id, 'firm_id', event.target.value)} disabled={firmAccessDisabled}>
                        <option value="">{draft.role === 'admin' ? 'All law firms (admin)' : 'No firm assigned'}</option>
                        {firms.map((firm) => <option value={firm.id} key={firm.id}>{firm.name}</option>)}
                      </select>
                    </label>
                    <label>
                      Firm access
                      {draft.role === 'admin' ? (
                        <input value="Full admin access" readOnly disabled />
                      ) : (
                        <select value={draft.firm_access_level} onChange={(event) => updateUserDraft(row.id, 'firm_access_level', event.target.value)} disabled={firmLevelDisabled}>
                          {firmAccessLevels.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                      )}
                    </label>
                    <button
                      className={quickApprove ? 'primary-button' : 'secondary-button'}
                      type="button"
                      disabled={isSelf || savingUserId === row.id || (!isDirty && !quickApprove)}
                      title={isSelf ? 'Another active admin must change your account access' : undefined}
                      onClick={() => saveUserAccess(row, quickApprove ? { status: 'active' } : {})}
                    >
                      {savingUserId === row.id
                        ? <ButtonSpinner label="Saving..." />
                        : isSelf
                          ? 'Protected'
                          : quickApprove
                            ? 'Approve'
                            : 'Save'}
                    </button>
                  </div>
                );
              })}
              {users.length === 0 && <p className="muted">No registered users yet.</p>}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
