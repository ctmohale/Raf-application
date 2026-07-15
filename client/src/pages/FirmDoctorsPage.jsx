import { useEffect, useState } from 'react';
import { Activity, CalendarClock, Filter, Pencil, Plus, Search, Stethoscope, Trash2, UserCheck, UserX, X } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ButtonSpinner, PageLoader } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

const emptyDoctor = {
  full_name: '',
  practice_number: '',
  email: '',
  phone: '',
  specialty: '',
  relationship_notes: '',
  status: 'active'
};

function doctorFormFromRecord(doctor) {
  return {
    full_name: doctor?.full_name || '',
    practice_number: doctor?.practice_number || '',
    email: doctor?.email || '',
    phone: doctor?.phone || '',
    specialty: doctor?.specialty || '',
    relationship_notes: doctor?.relationship_notes || '',
    status: doctor?.status || 'active'
  };
}

function normalizeMatchValue(value) {
  return String(value || '').trim().toLowerCase();
}

function isActiveMedicalRequest(request) {
  return !['submitted', 'completed', 'cancelled'].includes(String(request?.status || '').toLowerCase());
}

function formatDisplayDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function getRequestClientLabel(request) {
  const patientName = [request?.first_name, request?.surname].filter(Boolean).join(' ');
  return patientName || request?.case_reference || 'Assigned client';
}

export default function FirmDoctorsPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [workspace, setWorkspace] = useState(null);
  const [doctorForm, setDoctorForm] = useState(emptyDoctor);
  const [editingDoctor, setEditingDoctor] = useState(null);
  const [doctorModalOpen, setDoctorModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [removingDoctorId, setRemovingDoctorId] = useState(null);

  function loadWorkspace() {
    return apiRequest(`/api/firms/${id}/workspace`).then(setWorkspace);
  }

  useEffect(() => {
    loadWorkspace().catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => {
    setSearchTerm(searchParams.get('q') || '');
  }, [searchParams]);

  function updateDoctorField(field, value) {
    setDoctorForm((current) => ({ ...current, [field]: value }));
  }

  function openDoctorModal(doctor = null) {
    setEditingDoctor(doctor);
    setDoctorForm(doctor ? doctorFormFromRecord(doctor) : emptyDoctor);
    setDoctorModalOpen(true);
    setError('');
    setMessage('');
  }

  function closeDoctorModal() {
    setDoctorModalOpen(false);
    setEditingDoctor(null);
    setDoctorForm(emptyDoctor);
  }

  async function saveDoctor(event) {
    event.preventDefault();
    const confirmed = window.confirm(editingDoctor
      ? `Save changes to ${editingDoctor.full_name}?`
      : `Add ${doctorForm.full_name || 'this doctor'} to this firm's doctor list?`);
    if (!confirmed) return;

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const result = await apiRequest(`/api/firms/${id}/doctors${editingDoctor ? `/${editingDoctor.id}` : ''}`, {
        method: editingDoctor ? 'PATCH' : 'POST',
        body: doctorForm
      });
      setWorkspace(result.workspace);
      setMessage(`${result.doctor.full_name} ${editingDoctor ? 'updated' : 'added'} as a firm doctor.`);
      closeDoctorModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleDoctorStatus(doctor) {
    const nextStatus = doctor.status === 'active' ? 'inactive' : 'active';
    const confirmed = window.confirm(`Mark ${doctor.full_name} as ${nextStatus}?`);
    if (!confirmed) return;

    setError('');
    setMessage('');

    try {
      const result = await apiRequest(`/api/firms/${id}/doctors/${doctor.id}`, {
        method: 'PATCH',
        body: {
          ...doctorFormFromRecord(doctor),
          status: nextStatus
        }
      });
      setWorkspace(result.workspace);
      setMessage(`${doctor.full_name} marked ${nextStatus}.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeDoctor(doctor) {
    const confirmed = window.confirm(`Remove ${doctor.full_name} from this firm's doctor list?`);
    if (!confirmed) return;

    setRemovingDoctorId(doctor.id);
    setError('');
    setMessage('');

    try {
      const result = await apiRequest(`/api/firms/${id}/doctors/${doctor.id}`, {
        method: 'DELETE'
      });
      setWorkspace(result.workspace);
      setMessage(`${doctor.full_name} removed from the doctors list.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setRemovingDoctorId(null);
    }
  }

  if (!workspace) return <PageLoader label="Loading doctors..." />;

  const doctors = workspace.doctors || [];
  const medicalRequests = workspace.medicalAssessmentRequests || [];
  const activeMedicalRequests = medicalRequests.filter(isActiveMedicalRequest);
  const activeDoctors = doctors.filter((doctor) => doctor.status === 'active').length;
  const doctorRequestStats = doctors.reduce((stats, doctor) => {
    const doctorName = normalizeMatchValue(doctor.full_name);
    const doctorEmail = normalizeMatchValue(doctor.email);
    const practiceNumber = normalizeMatchValue(doctor.practice_number);
    const requests = medicalRequests.filter((request) => {
      const requestName = normalizeMatchValue(request.doctor_name);
      const requestEmail = normalizeMatchValue(request.doctor_email);
      const requestPractice = normalizeMatchValue(request.practice_number);
      return (
        (doctorEmail && requestEmail && doctorEmail === requestEmail) ||
        (practiceNumber && requestPractice && practiceNumber === requestPractice) ||
        (doctorName && requestName && doctorName === requestName)
      );
    });
    const activeRequests = requests.filter(isActiveMedicalRequest);
    const nextDue = activeRequests
      .map((request) => request.deadline)
      .filter(Boolean)
      .sort()[0] || '';
    stats[doctor.id] = {
      total: requests.length,
      active: activeRequests.length,
      nextDue,
      activeRequests
    };
    return stats;
  }, {});
  const doctorsWithActiveRequests = doctors.filter((doctor) => doctorRequestStats[doctor.id]?.active > 0).length;
  const filteredDoctors = doctors.filter((doctor) => {
    const searchValue = [
      doctor.full_name,
      doctor.practice_number,
      doctor.email,
      doctor.phone,
      doctor.specialty,
      doctor.relationship_notes
    ].filter(Boolean).join(' ').toLowerCase();
    const matchesSearch = searchValue.includes(searchTerm.trim().toLowerCase());
    const matchesStatus = statusFilter === 'all' || doctor.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <section className="page-stack">
      <div className="section-header">
        <div>
          <h2>Doctors</h2>
          <p>Doctors and medical practices linked to {workspace.firm.name}.</p>
        </div>
      </div>

      <StatusMessage type="error">{error}</StatusMessage>
      <StatusMessage type="success">{message}</StatusMessage>

      <div className="firm-stats">
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><Stethoscope size={22} /></span>
            <strong>{doctors.length}</strong>
          </div>
          <div className="metric-body">
            <span>Doctors</span>
          </div>
          <small>Medical relationships recorded</small>
        </div>
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><UserCheck size={22} /></span>
            <strong>{activeDoctors}</strong>
          </div>
          <div className="metric-body">
            <span>Active</span>
          </div>
          <small>Available for medical requests</small>
        </div>
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><Activity size={22} /></span>
            <strong>{activeMedicalRequests.length}</strong>
          </div>
          <div className="metric-body">
            <span>Active requests</span>
          </div>
          <small>{doctorsWithActiveRequests} doctor relationship(s)</small>
        </div>
        <div className="metric">
          <div className="firm-stat-top">
            <span className="metric-icon"><CalendarClock size={22} /></span>
            <strong>{activeMedicalRequests.filter((request) => request.deadline).length}</strong>
          </div>
          <div className="metric-body">
            <span>Due dates</span>
          </div>
          <small>Open medical requests with deadlines</small>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header firm-table-header">
          <div>
            <h3>Firm doctors</h3>
            <p>Reusable doctor details for medical report requests.</p>
          </div>
          <div className="firm-table-tools">
            <button className="primary-button" type="button" onClick={() => openDoctorModal()}>
              <Plus size={17} />
              Add doctor
            </button>
            <label className="table-search" aria-label="Search doctors">
              <Search size={16} />
              <input
                type="search"
                placeholder="Search doctors"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>
            <label className="table-filter" aria-label="Filter doctors by status">
              <Filter size={16} />
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="active">Active doctors</option>
                <option value="all">All doctors</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>
        </div>

        <div className="firm-table-wrap">
          {doctors.length === 0 && <p className="muted">No doctors added yet.</p>}
          {doctors.length > 0 && filteredDoctors.length === 0 && <p className="muted">No doctors match the selected filters.</p>}
          {filteredDoctors.length > 0 && (
            <table className="firm-table doctors-table">
              <colgroup>
                <col className="doctor-name-col" />
                <col className="doctor-practice-col" />
                <col className="doctor-contact-col" />
                <col className="doctor-specialty-col" />
                <col className="doctor-requests-col" />
                <col className="doctor-status-col" />
                <col className="doctor-actions-col" />
              </colgroup>
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>Practice no.</th>
                  <th>Contact</th>
                  <th>Specialty</th>
                  <th>Requests</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDoctors.map((doctor) => (
                  <tr key={doctor.id}>
                    <td className="doctor-name-cell" data-label="Doctor">
                      <strong>{doctor.full_name}</strong>
                      <span>{doctor.relationship_notes || 'No relationship notes'}</span>
                    </td>
                    <td data-label="Practice no.">{doctor.practice_number || '-'}</td>
                    <td data-label="Contact">
                      <strong>{doctor.email || '-'}</strong>
                      <span>{doctor.phone || '-'}</span>
                    </td>
                    <td data-label="Specialty">{doctor.specialty || '-'}</td>
                    <td data-label="Requests">
                      {(doctorRequestStats[doctor.id]?.activeRequests || []).length > 0 ? (
                        <div className="doctor-request-list">
                          {doctorRequestStats[doctor.id].activeRequests.slice(0, 2).map((request) => (
                            <span className="doctor-request-chip" key={request.id}>
                              <strong>{getRequestClientLabel(request)}</strong>
                              <small>{request.deadline ? `Due ${formatDisplayDate(request.deadline)}` : request.status || 'requested'}</small>
                            </span>
                          ))}
                          {doctorRequestStats[doctor.id].activeRequests.length > 2 && (
                            <em>+{doctorRequestStats[doctor.id].activeRequests.length - 2} more</em>
                          )}
                        </div>
                      ) : (
                        <span className="status-pill neutral">{doctorRequestStats[doctor.id]?.total || 0} total</span>
                      )}
                    </td>
                    <td data-label="Status">
                      <span className={`status-pill ${doctor.status === 'active' ? 'active' : 'neutral'}`}>
                        {doctor.status}
                      </span>
                    </td>
                    <td data-label="Actions">
                      <div className="table-actions">
                        <button type="button" onClick={() => openDoctorModal(doctor)} title="Edit doctor" aria-label={`Edit ${doctor.full_name}`}>
                          <Pencil size={15} />
                        </button>
                        <button type="button" onClick={() => toggleDoctorStatus(doctor)} title={doctor.status === 'active' ? 'Mark inactive' : 'Mark active'} aria-label={`Change status for ${doctor.full_name}`}>
                          {doctor.status === 'active' ? <UserX size={15} /> : <UserCheck size={15} />}
                        </button>
                        <button className="danger-icon" type="button" onClick={() => removeDoctor(doctor)} disabled={removingDoctorId === doctor.id} title="Remove doctor" aria-label={`Remove ${doctor.full_name}`}>
                          {removingDoctorId === doctor.id ? <ButtonSpinner label="Removing..." /> : <Trash2 size={15} />}
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

      {doctorModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="doctor-modal-title">
            <div className="modal-header">
              <div>
                <h3 id="doctor-modal-title">{editingDoctor ? 'Edit doctor' : 'Add doctor'}</h3>
                <p>Save contact details for medical report relationships.</p>
              </div>
              <button className="icon-button ghost" type="button" onClick={closeDoctorModal} aria-label="Close doctor modal">
                <X size={18} />
              </button>
            </div>
            <form className="form-stack firm-form" onSubmit={saveDoctor}>
              <label>
                Doctor or practice name
                <input value={doctorForm.full_name} onChange={(event) => updateDoctorField('full_name', event.target.value)} required />
              </label>
              <div className="form-grid">
                <label>
                  Practice number
                  <input value={doctorForm.practice_number} onChange={(event) => updateDoctorField('practice_number', event.target.value)} placeholder="HPCSA / practice no." />
                </label>
                <label>
                  Specialty
                  <input value={doctorForm.specialty} onChange={(event) => updateDoctorField('specialty', event.target.value)} placeholder="Orthopaedic surgeon, GP, specialist" />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Email
                  <input type="email" value={doctorForm.email} onChange={(event) => updateDoctorField('email', event.target.value)} />
                </label>
                <label>
                  Phone
                  <input value={doctorForm.phone} onChange={(event) => updateDoctorField('phone', event.target.value)} />
                </label>
              </div>
              <label>
                Relationship notes
                <textarea value={doctorForm.relationship_notes} onChange={(event) => updateDoctorField('relationship_notes', event.target.value)} placeholder="Preferred reports, availability, or relationship context" />
              </label>
              {editingDoctor && (
                <label>
                  Status
                  <select value={doctorForm.status} onChange={(event) => updateDoctorField('status', event.target.value)}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              )}
              <div className="modal-actions">
                <button className="secondary-button" type="button" onClick={closeDoctorModal}>Cancel</button>
                <button className="primary-button" disabled={saving}>
                  {saving ? <ButtonSpinner label="Saving..." /> : <Stethoscope size={17} />}
                  {!saving && (editingDoctor ? 'Save doctor' : 'Add doctor')}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
