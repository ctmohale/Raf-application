import { useEffect, useState } from 'react';
import { MailPlus, Pencil, Plus, ShieldCheck, UserMinus, Users, X } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ButtonSpinner, PageLoader } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

const emptyMember = {
  name: '',
  email: '',
  phone: '',
  job_title: '',
  firm_role: 'lawyer',
  password: '',
  send_invitation: false,
  status: 'active',
  can_submit_claims: false
};

function roleLabel(value) {
  if (value === 'firm_admin') return 'Firm Admin';
  if (value === 'lawyer') return 'Lawyer';
  return 'Assistant / Paralegal';
}

export default function FirmTeamPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [memberForm, setMemberForm] = useState(emptyMember);
  const [editingMember, setEditingMember] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    apiRequest(`/api/firms/${id}/team`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [id]);

  function updateField(field, value) {
    setMemberForm((current) => ({ ...current, [field]: value }));
  }

  function openAddMember() {
    setEditingMember(null);
    setMemberForm(emptyMember);
    setModalOpen(true);
  }

  function openEditMember(member) {
    setEditingMember(member);
    setMemberForm({
      name: member.name || '',
      email: member.email || '',
      phone: member.phone || '',
      job_title: member.job_title || '',
      firm_role: member.firm_role || 'assistant',
      password: '',
      send_invitation: false,
      status: member.status || 'active',
      can_submit_claims: Boolean(member.can_submit_claims)
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingMember(null);
    setMemberForm(emptyMember);
  }

  async function saveMember(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await apiRequest(
        editingMember ? `/api/firms/${id}/team/${editingMember.id}` : `/api/firms/${id}/team`,
        { method: editingMember ? 'PATCH' : 'POST', body: memberForm }
      );
      setData((current) => ({ ...current, members: result.members || current.members }));
      const invitationNote = result.invitation?.sent
        ? ' Invitation email sent.'
        : result.temporary_password
          ? ` Email delivery was unavailable. Temporary password: ${result.temporary_password}`
          : '';
      setMessage(`${memberForm.name} ${editingMember ? 'updated' : 'added to the firm'}.${invitationNote}`);
      closeModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deactivateMember(member) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await apiRequest(`/api/firms/${id}/team/${member.id}`, {
        method: 'PATCH',
        body: { status: 'suspended' }
      });
      setData((current) => ({ ...current, members: result.members || current.members }));
      setMessage(`${member.name} deactivated.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!data && !error) return <PageLoader label="Loading team members..." />;
  const members = data?.members || [];
  const activeMembers = members.filter((member) => member.status === 'active').length;
  const lawyers = members.filter((member) => member.status === 'active' && ['lawyer', 'firm_admin'].includes(member.firm_role)).length;
  const assistants = members.filter((member) => member.status === 'active' && member.firm_role === 'assistant').length;

  return (
    <section className="page-stack">
      <div className="section-header">
        <div>
          <h2>Team Members</h2>
          <p>Add firm staff and manage access to {data?.firm?.name || 'this law firm'}.</p>
        </div>
        {data?.can_manage_team && <button className="primary-button" type="button" onClick={openAddMember}><Plus size={17} /> Add Team Member</button>}
      </div>

      <StatusMessage type="error">{error}</StatusMessage>
      <StatusMessage type="success">{message}</StatusMessage>

      <div className="firm-stats team-stats">
        <div className="metric"><div className="firm-stat-top"><span className="metric-icon"><Users size={22} /></span><strong>{activeMembers}</strong></div><div className="metric-body"><span>Active members</span></div><small>{members.length} total accounts</small></div>
        <div className="metric"><div className="firm-stat-top"><span className="metric-icon"><ShieldCheck size={22} /></span><strong>{lawyers}</strong></div><div className="metric-body"><span>Lawyers</span></div><small>Responsible matter owners</small></div>
        <div className="metric"><div className="firm-stat-top"><span className="metric-icon"><MailPlus size={22} /></span><strong>{assistants}</strong></div><div className="metric-body"><span>Assistants</span></div><small>Paralegal and capture support</small></div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div><h3>Firm team</h3><p>Only members of this firm are listed.</p></div>
        </div>
        <div className="firm-table-wrap">
          {members.length === 0 ? <p className="muted">No team members added yet.</p> : (
            <table className="firm-table firm-records-table team-members-table">
              <thead><tr><th>Team member</th><th>Role</th><th>Contact</th><th>Status</th><th>Assigned matters</th>{data.can_manage_team && <th>Actions</th>}</tr></thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td data-label="Team member"><strong>{member.name}</strong><span>{member.job_title || roleLabel(member.firm_role)}</span></td>
                    <td data-label="Role"><span className="status-pill neutral">{roleLabel(member.firm_role)}</span>{member.can_submit_claims && <span>Submission permission</span>}</td>
                    <td data-label="Contact"><strong>{member.email}</strong><span>{member.phone || 'No phone added'}</span></td>
                    <td data-label="Status"><span className={`status-pill ${member.status === 'active' ? 'active' : member.status === 'pending' ? 'pending' : 'suspended'}`}>{member.status}</span></td>
                    <td data-label="Assigned matters"><span className="status-pill neutral">{member.assigned_matter_count}</span></td>
                    {data.can_manage_team && <td data-label="Actions"><div className="table-actions"><button type="button" onClick={() => openEditMember(member)} title="Edit team member"><Pencil size={15} /></button>{member.status === 'active' && <button className="danger-icon" type="button" disabled={saving} onClick={() => deactivateMember(member)} title="Deactivate team member"><UserMinus size={15} /></button>}</div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {modalOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="team-member-modal-title">
            <div className="modal-header"><div><h3 id="team-member-modal-title">{editingMember ? 'Edit Team Member' : 'Add Team Member'}</h3><p>Firm access is limited to this law firm.</p></div><button className="icon-button ghost" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button></div>
            <form className="form-stack firm-form" onSubmit={saveMember}>
              <label>Full name<input value={memberForm.name} onChange={(event) => updateField('name', event.target.value)} required /></label>
              <div className="form-grid"><label>Email address<input type="email" value={memberForm.email} onChange={(event) => updateField('email', event.target.value)} required /></label><label>Phone number<input value={memberForm.phone} onChange={(event) => updateField('phone', event.target.value)} /></label></div>
              <div className="form-grid"><label>Job title<input value={memberForm.job_title} onChange={(event) => updateField('job_title', event.target.value)} /></label><label>User role<select value={memberForm.firm_role} onChange={(event) => updateField('firm_role', event.target.value)}><option value="firm_admin">Firm Admin</option><option value="lawyer">Lawyer</option><option value="assistant">Assistant / Paralegal</option></select></label></div>
              <label>Account status<select value={memberForm.status} onChange={(event) => updateField('status', event.target.value)}><option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Deactivated</option></select></label>
              {!editingMember && <><label className="checkbox-line"><input type="checkbox" checked={memberForm.send_invitation} onChange={(event) => updateField('send_invitation', event.target.checked)} /> Send an email invitation with a temporary password</label>{!memberForm.send_invitation && <label>Temporary password<input type="password" minLength="8" value={memberForm.password} onChange={(event) => updateField('password', event.target.value)} required /></label>}</>}
              {editingMember && <label>New temporary password <span className="muted">(optional)</span><input type="password" minLength="8" value={memberForm.password} onChange={(event) => updateField('password', event.target.value)} placeholder="Leave blank to keep current password" /></label>}
              {memberForm.firm_role === 'assistant' && <label className="checkbox-line"><input type="checkbox" checked={memberForm.can_submit_claims} onChange={(event) => updateField('can_submit_claims', event.target.checked)} /> Allow final RAF claim approval and submission</label>}
              <div className="modal-actions"><button className="secondary-button" type="button" onClick={closeModal}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? <ButtonSpinner label="Saving..." /> : editingMember ? 'Save changes' : 'Add Team Member'}</button></div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
