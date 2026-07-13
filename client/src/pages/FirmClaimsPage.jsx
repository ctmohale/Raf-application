import { useEffect, useRef, useState } from 'react';
import { BellRing, BriefcaseBusiness, Clock3, Copy, Download, Edit3, Eye, FileCheck2, FilePlus2, FileText, Filter, FolderOpen, Maximize2, Minimize2, Search, Send, Sparkles, Trash2, Type, UploadCloud, X } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ButtonSpinner, LoadingSpinner, PageLoader } from '../components/LoadingSpinner.jsx';
import PdfWorkspace from '../components/PdfWorkspace.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { API_BASE, apiRequest, downloadDocument, getToken } from '../lib/api.js';

function SignatureInput({ id, value, onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (!String(value || '').startsWith('data:image/')) {
      const textValue = String(value || '').trim();
      if (textValue) {
        context.font = '52px "Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive';
        context.fillStyle = '#031426';
        context.fillText(textValue, 24, 112, canvas.width - 48);
        hasInkRef.current = true;
      }
      return;
    }

    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      hasInkRef.current = true;
    };
    image.src = value;
  }, [value]);

  function getPoint(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  }

  function startDrawing(event) {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    const point = getPoint(event);
    drawingRef.current = true;
    hasInkRef.current = true;
    canvas.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function draw(event) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    const point = getPoint(event);
    context.lineTo(point.x, point.y);
    context.strokeStyle = '#031426';
    context.lineWidth = 4;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
  }

  function stopDrawing(event) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    drawingRef.current = false;
    if (event.pointerId && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    onChange(hasInkRef.current ? canvas.toDataURL('image/png') : '');
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    hasInkRef.current = false;
    onChange('');
  }

  return (
    <div className="claim-form-signature-pad">
      <canvas
        ref={canvasRef}
        width="720"
        height="180"
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
        aria-label="Handwritten signature input"
      />
      <input tabIndex={-1} aria-hidden="true" className="signature-hidden-input" id={id} value={value || ''} onChange={() => {}} />
      <button type="button" onClick={clearSignature}>Clear</button>
    </div>
  );
}

function isGenericFieldLabel(label) {
  return /^field\s*\d+$/i.test(String(label || '').trim());
}

function getReadableFieldLabel(field, fields) {
  const label = String(field?.label || '').trim();
  if (!isGenericFieldLabel(label)) return label || field?.name || 'Field';

  const y = Number(field.y || 0);
  const pageNumber = field.page_number;
  const candidates = fields
    .filter((candidate) => (
      candidate.id !== field.id
      && candidate.page_number === pageNumber
      && !isGenericFieldLabel(candidate.label)
      && Number(candidate.y || 0) <= y + 8
    ))
    .sort((a, b) => Number(b.y || 0) - Number(a.y || 0));

  return candidates[0]?.label || label || field?.name || 'Field';
}

function getGroupedFieldBoxes(field) {
  const groupConfig = Array.isArray(field.options)
    ? field.options.find((option) => option && option.kind === 'grouped-input-boxes')
    : null;
  return Array.isArray(groupConfig?.boxes) ? groupConfig.boxes : [];
}

function normalizeSectionText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim();
}

function isBlankFormValue(value) {
  if (Array.isArray(value)) return value.every((item) => String(item ?? '').trim() === '');
  return value == null || String(value).trim() === '';
}

function hasFilledTemplateValue(value) {
  if (Array.isArray(value)) return value.some(hasFilledTemplateValue);
  if (value && typeof value === 'object') return Object.values(value).some(hasFilledTemplateValue);
  if (typeof value === 'boolean') return value;
  return !isBlankFormValue(value);
}

function getClaimFormInputStatus(form) {
  const input = form?.document?.input && typeof form.document.input === 'object' ? form.document.input : {};
  const total = Number(form?.template?.field_count || 0);
  const filled = Object.values(input).filter(hasFilledTemplateValue).length;
  const safeTotal = total || Math.max(Object.keys(input).length, filled);
  const safeFilled = safeTotal ? Math.min(filled, safeTotal) : 0;

  return {
    filled: safeFilled,
    total: safeTotal,
    percent: safeTotal ? Math.round((safeFilled / safeTotal) * 100) : 0
  };
}

function getCompletionTone(percent) {
  return percent >= 100 ? 'complete' : percent >= 75 ? 'high' : percent >= 35 ? 'mid' : 'low';
}

function ClaimFormInputStatus({ form }) {
  const status = getClaimFormInputStatus(form);
  const tone = getCompletionTone(status.percent);

  return (
    <span className={`claim-form-input-status ${tone}`} title={`${status.filled} of ${status.total} inputs filled`}>
      <span>
        <strong>{status.percent}%</strong>
        <small>{status.total ? `${status.filled}/${status.total} inputs filled` : 'No mapped inputs'}</small>
      </span>
      <i aria-hidden="true"><b style={{ width: `${status.percent}%` }} /></i>
    </span>
  );
}

function ClaimFormCompactInputStatus({ form }) {
  const status = getClaimFormInputStatus(form);
  const tone = getCompletionTone(status.percent);

  return (
    <span className={`claim-form-compact-status ${tone}`} title={`${status.filled}/${status.total} inputs filled`}>
      {status.percent}%
    </span>
  );
}

function ClaimFormsAverageStatus({ forms }) {
  if (!forms?.length) return null;
  const statuses = forms.map(getClaimFormInputStatus);
  const averagePercent = Math.round(statuses.reduce((sum, status) => sum + status.percent, 0) / statuses.length);
  const filled = statuses.reduce((sum, status) => sum + status.filled, 0);
  const total = statuses.reduce((sum, status) => sum + status.total, 0);
  const tone = getCompletionTone(averagePercent);

  return (
    <span className={`claim-forms-average-status ${tone}`} title={`${averagePercent}% average completion · ${filled}/${total} total inputs filled`}>
      <span>Avg {averagePercent}%</span>
    </span>
  );
}

function normalizeDataKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeDateInputValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const [, year, month, day] = slashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const localMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (localMatch) {
    const [, day, month, year] = localMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return text;
}

function parseJsonValue(value, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function addYearsMinusOneDay(dateText, years) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCFullYear(date.getUTCFullYear() + years);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function subtractMonths(dateText, months) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

function formatDisplayDate(value) {
  if (!value) return '-';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function getNewClaimFormSelection(accidentDate, generalDamages = '') {
  const cutoff = new Date('2008-08-01T00:00:00');
  const accident = accidentDate ? new Date(`${accidentDate}T00:00:00`) : null;
  const useLegacyForms = accident && !Number.isNaN(accident.getTime()) && accident < cutoff;

  if (useLegacyForms) {
    return {
      label: 'Accident before 1 August 2008',
      forms: ['Form 1', 'Form 3'],
      note: 'Form 2 applies only to supplier claims.'
    };
  }

  return {
    label: accidentDate ? 'Accident after 31 July 2008' : 'Enter accident date to confirm forms',
    forms: ['RAF 1', 'RAF 3', ...(Number(generalDamages || 0) > 0 ? ['RAF 4'] : [])],
    note: Number(generalDamages || 0) > 0
      ? 'RAF 4 added because general damages are being claimed.'
      : 'RAF 4 may be added if general damages or serious injury assessment applies.'
  };
}

const emptyNewClaimForm = {
  full_names: '',
  first_name: '',
  surname: '',
  id_number: '',
  passport_number: '',
  date_of_birth: '',
  cell: '',
  email: '',
  residential_address: '',
  occupation: '',
  employer_details: '',
  bank_name: '',
  account_holder: '',
  account_number: '',
  branch_code: '',
  account_type: '',
  representative_name: '',
  representative_relationship: '',
  representative_contact: '',
  representative_address: '',
  accident_date: '',
  accident_time: '',
  accident_location: '',
  police_station: '',
  police_case_number: '',
  claimant_role: 'Driver',
  collision_description: '',
  vehicle_registration: '',
  vehicle_make: '',
  vehicle_model: '',
  vehicle_description: '',
  driver_name: '',
  driver_id_number: '',
  driver_contact: '',
  driver_license_number: '',
  owner_name: '',
  owner_contact: '',
  owner_address: '',
  witness_name: '',
  witness_contact: '',
  witness_statement: '',
  medical_expenses: '',
  loss_of_earnings: '',
  loss_of_support: '',
  funeral_expenses: '',
  general_damages: '',
  future_medical_expenses: '',
  other_compensation: '',
  auto_reminders_enabled: true,
  reminder_time: '09:00'
};

const medicalReportTypes = [
  ['raf_1_medical_section', 'RAF 1 medical section'],
  ['raf_4_serious_injury', 'RAF 4 serious-injury assessment'],
  ['supporting_medical_report', 'General supporting medical report'],
  ['specialist_report', 'Additional specialist report']
];

const emptyMedicalAssessmentForm = {
  report_type: 'supporting_medical_report',
  doctor_name: '',
  practice_number: '',
  doctor_email: '',
  doctor_phone: '',
  deadline: '',
  delivery_method: 'link'
};

export default function FirmClaimsPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [workspace, setWorkspace] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [clientFilter, setClientFilter] = useState('all');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [remindingClientId, setRemindingClientId] = useState(null);
  const [uploadingRequestId, setUploadingRequestId] = useState(null);
  const [viewingRequestId, setViewingRequestId] = useState(null);
  const [intakeCase, setIntakeCase] = useState(null);
  const [medicalReportCase, setMedicalReportCase] = useState(null);
  const [medicalAssessmentForm, setMedicalAssessmentForm] = useState(emptyMedicalAssessmentForm);
  const [creatingMedicalAssessment, setCreatingMedicalAssessment] = useState(false);
  const [claimFormsCase, setClaimFormsCase] = useState(null);
  const [formFilesCase, setFormFilesCase] = useState(null);
  const [claimFormsPayload, setClaimFormsPayload] = useState(null);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [attachingForms, setAttachingForms] = useState(false);
  const [documentPreview, setDocumentPreview] = useState(null);
  const [previewingClaimFormId, setPreviewingClaimFormId] = useState(null);
  const [fillingClaimFormId, setFillingClaimFormId] = useState(null);
  const [fillingProgress, setFillingProgress] = useState(0);
  const [editingClaimForm, setEditingClaimForm] = useState(null);
  const [editFormFields, setEditFormFields] = useState([]);
  const [editFormValues, setEditFormValues] = useState({});
  const [editFormLoading, setEditFormLoading] = useState(false);
  const [savingEditedFormId, setSavingEditedFormId] = useState(null);
  const [deletingClaimFormId, setDeletingClaimFormId] = useState(null);
  const [deleteClaimFormTarget, setDeleteClaimFormTarget] = useState(null);
  const [editFormFullscreen, setEditFormFullscreen] = useState(false);
  const [editFormFont, setEditFormFont] = useState('sans');
  const [editingSignatureField, setEditingSignatureField] = useState(null);
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [newClaimForm, setNewClaimForm] = useState(emptyNewClaimForm);
  const [creatingClaim, setCreatingClaim] = useState(false);
  const [copiedClientId, setCopiedClientId] = useState(null);
  const [copiedMedicalRequestId, setCopiedMedicalRequestId] = useState(null);

  useEffect(() => {
    apiRequest(`/api/firms/${id}/workspace`)
      .then(setWorkspace)
      .catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => {
    setSearchTerm(searchParams.get('q') || '');
  }, [searchParams]);

  useEffect(() => {
    return () => {
      if (documentPreview?.url) URL.revokeObjectURL(documentPreview.url);
    };
  }, [documentPreview]);

  if (!workspace && !error) return <PageLoader label="Loading claims..." />;

  const cases = workspace?.cases || [];
  const documentRequests = workspace?.documentRequests || [];
  const medicalAssessmentRequests = workspace?.medicalAssessmentRequests || [];
  const claimForms = workspace?.claimForms || [];
  const clientOptions = workspace?.clients || [];
  const filteredCases = cases.filter((caseRecord) => {
    const searchText = [
      caseRecord.case_reference,
      caseRecord.first_name,
      caseRecord.surname,
      caseRecord.claim_type,
      caseRecord.status
    ].filter(Boolean).join(' ').toLowerCase();
    const matchesSearch = searchText.includes(searchTerm.trim().toLowerCase());
    const matchesClient = clientFilter === 'all' || String(caseRecord.client_id) === clientFilter;
    return matchesSearch && matchesClient;
  });
  const requestsByCase = documentRequests.reduce((groups, request) => {
    const key = request.case_id;
    groups[key] = groups[key] || [];
    groups[key].push(request);
    return groups;
  }, {});
  const intakeRequests = intakeCase ? requestsByCase[intakeCase.id] || [] : [];
  const medicalAssessmentsByCase = medicalAssessmentRequests.reduce((groups, request) => {
    const key = request.case_id;
    groups[key] = groups[key] || [];
    groups[key].push(request);
    return groups;
  }, {});
  const activeMedicalAssessmentRequest = medicalReportCase ? getMedicalAssessmentRequest(medicalReportCase) : null;
  const claimFormsByCase = claimForms.reduce((groups, form) => {
    const key = form.case_id;
    groups[key] = groups[key] || [];
    groups[key].push(form);
    return groups;
  }, {});
  const formFileOptions = formFilesCase ? getAttachedClaimForms(formFilesCase) : [];
  const { fields: editFormPreviewFields, values: editFormPreviewValues } = buildEditFormPreview(editFormFields, editFormValues);
  const editFormSections = buildEditFormSections(editFormFields);
  const newClaimFormSelection = getNewClaimFormSelection(newClaimForm.accident_date, newClaimForm.general_damages);
  const newClaimLodgementDeadline = newClaimForm.accident_date ? addYearsMinusOneDay(newClaimForm.accident_date, 3) : '';
  const newClaimInternalDeadline = newClaimLodgementDeadline ? subtractMonths(newClaimLodgementDeadline, 3) : '';

  function getClaimFormCount(caseRecord) {
    return Number(caseRecord.form_count ?? claimFormsByCase[caseRecord.id]?.length ?? 0);
  }

  function getAttachedClaimForms(caseRecord) {
    return claimFormsByCase[caseRecord.id] || [];
  }

  function getCaseClient(caseRecord) {
    return clientOptions.find((client) => String(client.id) === String(caseRecord?.client_id)) || null;
  }

  function formatCompactReference(reference) {
    const value = String(reference || '');
    if (value.length <= 14) return value;
    return `...${value.slice(-10)}`;
  }

  function isStandaloneMedicalReportRequest(request) {
    const documentType = String(request?.document_type || '').trim().toLowerCase();
    const label = String(request?.label || '').trim().toLowerCase();
    return documentType === 'medical_report' || label === 'medical report';
  }

  function getProcessStatus(caseRecord) {
    const requests = (requestsByCase[caseRecord.id] || []).filter((request) => !isStandaloneMedicalReportRequest(request));
    const requested = requests.length;
    const uploaded = requests.filter((request) => request.status === 'uploaded' || Number(request.upload_count || 0) > 0).length;

    if (requested === 0) {
      return {
        label: 'Intake',
        className: 'warning',
        detail: 'No requests'
      };
    }

    if (uploaded === requested) {
      return {
        label: `Ready ${uploaded}/${requested}`,
        className: 'ready',
        detail: ''
      };
    }

    if (uploaded > 0) {
      return {
        label: `In progress ${uploaded}/${requested}`,
        className: 'warning',
        detail: ''
      };
    }

    return {
      label: `Awaiting docs 0/${requested}`,
      className: 'pending',
      detail: ''
    };
  }

  function getMedicalReportTypeLabel(value) {
    return medicalReportTypes.find(([type]) => type === value)?.[1] || 'Medical assessment';
  }

  function getMedicalAssessmentRequest(caseRecord) {
    return medicalAssessmentsByCase[caseRecord.id]?.[0] || null;
  }

  function openMedicalAssessment(caseRecord) {
    const currentRequest = getMedicalAssessmentRequest(caseRecord);
    setMedicalAssessmentForm(currentRequest ? {
      report_type: currentRequest.report_type || 'supporting_medical_report',
      doctor_name: currentRequest.doctor_name || '',
      practice_number: currentRequest.practice_number || '',
      doctor_email: currentRequest.doctor_email || '',
      doctor_phone: currentRequest.doctor_phone || '',
      deadline: currentRequest.deadline || '',
      delivery_method: currentRequest.delivery_method || 'email'
    } : emptyMedicalAssessmentForm);
    setMedicalReportCase(caseRecord);
  }

  function updateMedicalAssessmentField(field, value) {
    setMedicalAssessmentForm((current) => ({ ...current, [field]: value }));
  }

  function closeMedicalAssessment() {
    setMedicalReportCase(null);
    setMedicalAssessmentForm(emptyMedicalAssessmentForm);
  }

  async function createMedicalAssessment(event) {
    event.preventDefault();
    if (!medicalReportCase) return;
    setCreatingMedicalAssessment(true);
    setError('');
    setMessage('');

    try {
      const result = await apiRequest(`/api/firms/${id}/claims/${medicalReportCase.id}/medical-assessments`, {
        method: 'POST',
        body: medicalAssessmentForm
      });
      setWorkspace(result.workspace);
      setMessage(`Medical assessment request created for ${medicalAssessmentForm.doctor_name}.${result.delivery?.sent ? ' Secure link sent.' : ' Copy the secure link to share it.'}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingMedicalAssessment(false);
    }
  }

  async function copyMedicalAssessmentLink(request) {
    if (!request?.secure_url) return;
    await navigator.clipboard.writeText(request.secure_url);
    setCopiedMedicalRequestId(request.id);
    setMessage('Secure doctor link copied.');
    setTimeout(() => setCopiedMedicalRequestId(null), 1800);
  }

  function updateNewClaimField(field, value) {
    setNewClaimForm((current) => ({ ...current, [field]: value }));
  }

  function closeNewClaimModal() {
    setClaimModalOpen(false);
    setNewClaimForm(emptyNewClaimForm);
  }

  function buildNewClaimPayload() {
    const amountFields = [
      'medical_expenses',
      'loss_of_earnings',
      'loss_of_support',
      'funeral_expenses',
      'general_damages',
      'future_medical_expenses',
      'other_compensation'
    ];
    const claimAmounts = amountFields.reduce((values, field) => {
      values[field] = newClaimForm[field];
      return values;
    }, {});
    const total = amountFields.reduce((sum, field) => sum + Number(newClaimForm[field] || 0), 0);

    return {
      full_names: newClaimForm.full_names,
      first_name: newClaimForm.first_name,
      surname: newClaimForm.surname,
      id_number: newClaimForm.id_number,
      passport_number: newClaimForm.passport_number,
      date_of_birth: newClaimForm.date_of_birth,
      cell: newClaimForm.cell,
      email: newClaimForm.email,
      residential_address: newClaimForm.residential_address,
      occupation: newClaimForm.occupation,
      employer_details: newClaimForm.employer_details,
      accident_date: newClaimForm.accident_date,
      accident_time: newClaimForm.accident_time,
      accident_location: newClaimForm.accident_location,
      police_station: newClaimForm.police_station,
      police_case_number: newClaimForm.police_case_number,
      claimant_role: newClaimForm.claimant_role,
      collision_description: newClaimForm.collision_description,
      auto_reminders_enabled: newClaimForm.auto_reminders_enabled,
      reminder_time: newClaimForm.reminder_time,
      banking: {
        bank_name: newClaimForm.bank_name,
        account_holder: newClaimForm.account_holder,
        account_number: newClaimForm.account_number,
        branch_code: newClaimForm.branch_code,
        account_type: newClaimForm.account_type
      },
      representative: {
        name: newClaimForm.representative_name,
        relationship: newClaimForm.representative_relationship,
        contact: newClaimForm.representative_contact,
        address: newClaimForm.representative_address
      },
      vehicle: {
        registration: newClaimForm.vehicle_registration,
        make: newClaimForm.vehicle_make,
        model: newClaimForm.vehicle_model,
        description: newClaimForm.vehicle_description
      },
      driver: {
        name: newClaimForm.driver_name,
        id_number: newClaimForm.driver_id_number,
        contact: newClaimForm.driver_contact,
        license_number: newClaimForm.driver_license_number
      },
      owner: {
        name: newClaimForm.owner_name,
        contact: newClaimForm.owner_contact,
        address: newClaimForm.owner_address
      },
      witnesses: [{
        name: newClaimForm.witness_name,
        contact: newClaimForm.witness_contact,
        statement: newClaimForm.witness_statement
      }],
      claim_amounts: {
        ...claimAmounts,
        total: total ? String(total) : ''
      }
    };
  }

  async function createNewClaim(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setCreatingClaim(true);

    try {
      const result = await apiRequest(`/api/firms/${id}/clients`, {
        method: 'POST',
        body: buildNewClaimPayload()
      });
      setWorkspace(result.workspace);
      setMessage(`RAF claim created for ${result.client.first_name} ${result.client.surname}.`);
      closeNewClaimModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingClaim(false);
    }
  }

  async function copyClientIntakeLink(caseRecord) {
    const client = getCaseClient(caseRecord);
    if (!client?.invite_url) {
      setError('Client intake link is not available for this claim.');
      return;
    }

    try {
      await navigator.clipboard.writeText(client.invite_url);
      setCopiedClientId(caseRecord.client_id);
      setMessage(`Client intake link copied for ${caseRecord.first_name} ${caseRecord.surname}.`);
      window.setTimeout(() => setCopiedClientId(null), 1800);
    } catch {
      setError('Unable to copy link. Open the client record and copy the invite link manually.');
    }
  }

  async function sendReminder(caseRecord) {
    setError('');
    setMessage('');
    setRemindingClientId(caseRecord.client_id);

    try {
      await apiRequest(`/api/firms/${id}/clients/${caseRecord.client_id}/invite`, { method: 'POST' });
      setMessage(`Reminder sent to ${caseRecord.first_name} ${caseRecord.surname}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setRemindingClientId(null);
    }
  }

  async function uploadDocument(request, file) {
    if (!file) return;
    setError('');
    setMessage('');
    setUploadingRequestId(request.id);

    try {
      const formData = new FormData();
      formData.append('document', file);
      const result = await apiRequest(`/api/firms/${id}/document-requests/${request.id}/upload`, {
        method: 'POST',
        body: formData
      });
      setWorkspace(result);
      setMessage(`${request.label} uploaded for ${request.first_name} ${request.surname}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingRequestId(null);
    }
  }

  async function viewUpload(request) {
    setError('');
    setViewingRequestId(request.id);

    if (!request.latest_upload_id) {
      setDocumentPreview((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return {
          url: null,
          title: request.label,
          label: request.label,
          client: `${request.first_name} ${request.surname}`,
          status: request.status,
          uploadCount: Number(request.upload_count || 0)
        };
      });
      setViewingRequestId(null);
      return;
    }

    try {
      const headers = new Headers();
      const token = getToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const response = await fetch(`${API_BASE}/api/firms/${id}/uploads/${request.latest_upload_id}/download`, { headers });
      if (!response.ok) throw new Error('Unable to open uploaded document');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setDocumentPreview((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return {
          url,
          title: request.latest_upload_filename || request.label,
          label: request.label,
          client: `${request.first_name} ${request.surname}`,
          status: request.status,
          uploadCount: Number(request.upload_count || 0)
        };
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setViewingRequestId(null);
    }
  }

  async function previewClaimForm(form, caseRecord) {
    if (!form?.document?.id) return;
    setError('');
    setPreviewingClaimFormId(form.id);

    try {
      const headers = new Headers();
      const token = getToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const response = await fetch(`${API_BASE}/api/documents/${form.document.id}/download?inline=1`, { headers });
      if (!response.ok) throw new Error('Unable to open attached template form');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setDocumentPreview((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return {
          url,
          title: form.document.file_name || form.template?.name || 'Attached template form',
          label: form.template?.name || 'Template form',
          client: `${caseRecord.first_name} ${caseRecord.surname}`,
          status: form.status,
          uploadCount: null
        };
      });
      setFormFilesCase(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewingClaimFormId(null);
    }
  }

  async function downloadClaimForm(form) {
    if (!form?.document?.id) return;
    setError('');

    try {
      await downloadDocument(form.document.id, form.document.file_name || `${form.template?.name || 'template-form'}.pdf`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function fillClaimFormWithAi(form, caseRecord) {
    if (!form?.id || !caseRecord?.id) return;
    setError('');
    setMessage('');
    setFillingClaimFormId(form.id);
    setFillingProgress(8);
    const progressTimer = window.setInterval(() => {
      setFillingProgress((current) => Math.min(current + 14, 92));
    }, 420);

    try {
      const result = await apiRequest(`/api/firms/${id}/claims/${caseRecord.id}/forms/${form.id}/fill-ai`, {
        method: 'POST',
        body: { data: form.document?.input || {} }
      });
      setFillingProgress(100);
      setWorkspace(result.workspace);
      if (claimFormsCase?.id === caseRecord.id) {
        setClaimFormsPayload((current) => current ? { ...current, attached_forms: result.attached_forms } : current);
      }
      setMessage(`${form.template?.name || 'Template form'} filled with AI data for ${caseRecord.first_name} ${caseRecord.surname}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      window.clearInterval(progressTimer);
      window.setTimeout(() => {
        setFillingClaimFormId(null);
        setFillingProgress(0);
      }, 350);
    }
  }

  async function openEditClaimForm(form, caseRecord) {
    if (!form?.template?.id) return;
    setError('');
    setEditingClaimForm({ form, caseRecord });
    setEditFormFields([]);
    setEditFormValues(form.document?.input || {});
    setEditFormLoading(true);

    try {
      const result = await apiRequest(`/api/templates/${form.template.id}`);
      setEditFormFields(result.fields);
      setEditFormValues(buildEditFormValues(result.fields, form.document?.input || {}, caseRecord));
    } catch (err) {
      setError(err.message);
      setEditingClaimForm(null);
    } finally {
      setEditFormLoading(false);
    }
  }

  async function fillEditingClaimFormWithAi() {
    const form = editingClaimForm?.form;
    const caseRecord = editingClaimForm?.caseRecord;
    if (!form?.id || !caseRecord?.id) return;
    setError('');
    setMessage('');
    setFillingClaimFormId(form.id);
    setFillingProgress(8);
    const progressTimer = window.setInterval(() => {
      setFillingProgress((current) => Math.min(current + 14, 92));
    }, 420);

    try {
      const result = await apiRequest(`/api/firms/${id}/claims/${caseRecord.id}/forms/${form.id}/fill-ai`, {
        method: 'POST',
        body: { data: editFormValues }
      });
      setFillingProgress(100);
      setWorkspace(result.workspace);
      if (claimFormsCase?.id === caseRecord.id) {
        setClaimFormsPayload((current) => current ? { ...current, attached_forms: result.attached_forms } : current);
      }

      const updatedForm = result.attached_forms?.find((item) => String(item.id) === String(form.id));
      const nextForm = updatedForm || { ...form, document: result.document || form.document };
      setEditingClaimForm((current) => current ? { ...current, form: nextForm } : current);
      setEditFormValues(buildEditFormValues(editFormFields, nextForm.document?.input || result.document?.input || {}, caseRecord));
      setMessage(`${form.template?.name || 'Template form'} filled with AI data for ${caseRecord.first_name} ${caseRecord.surname}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      window.clearInterval(progressTimer);
      window.setTimeout(() => {
        setFillingClaimFormId(null);
        setFillingProgress(0);
      }, 350);
    }
  }

  async function saveEditedClaimForm(event) {
    event.preventDefault();
    if (!editingClaimForm?.form?.id || !editingClaimForm?.caseRecord?.id) return;
    const { form, caseRecord } = editingClaimForm;
    setSavingEditedFormId(form.id);
    setError('');
    setMessage('');

    try {
      const result = await apiRequest(`/api/firms/${id}/claims/${caseRecord.id}/forms/${form.id}/fill-manual`, {
        method: 'POST',
        body: { data: editFormValues }
      });
      setWorkspace(result.workspace);
      if (claimFormsCase?.id === caseRecord.id) {
        setClaimFormsPayload((current) => current ? { ...current, attached_forms: result.attached_forms } : current);
      }
      setEditingClaimForm(null);
      setMessage(`${form.template?.name || 'Template form'} updated for ${caseRecord.first_name} ${caseRecord.surname}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingEditedFormId(null);
    }
  }

  async function confirmDeleteAttachedClaimForm() {
    const form = deleteClaimFormTarget?.form;
    const caseRecord = deleteClaimFormTarget?.caseRecord;
    if (!form?.id || !caseRecord?.id) return;
    const formName = form.template?.name || form.document?.file_name || 'attached template';

    setDeletingClaimFormId(form.id);
    setError('');
    setMessage('');

    try {
      const result = await apiRequest(`/api/firms/${id}/claims/${caseRecord.id}/forms/${form.id}`, {
        method: 'DELETE'
      });
      setWorkspace(result.workspace);
      if (claimFormsCase?.id === caseRecord.id) {
        setClaimFormsPayload((current) => current ? { ...current, attached_forms: result.attached_forms } : current);
      }
      if (editingClaimForm?.form?.id === form.id) {
        setEditingClaimForm(null);
      }
      setDeleteClaimFormTarget(null);
      setMessage(`${formName} removed from ${caseRecord.first_name} ${caseRecord.surname}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingClaimFormId(null);
    }
  }

  function updateEditFormValue(fieldName, value) {
    setEditFormValues((current) => ({ ...current, [fieldName]: value }));
  }

  function buildClaimFallbackValues(fields, caseRecord) {
    const client = getCaseClient(caseRecord) || {};
    const fullName = [
      client.first_name || caseRecord?.first_name,
      client.surname || caseRecord?.surname
    ].filter(Boolean).join(' ');
    const accidentDate = caseRecord?.accident_date || '';
    const today = new Date().toISOString().slice(0, 10);
    const baseData = {
      name_and_surname: fullName,
      full_name: fullName,
      id_number: client.id_number,
      date_of_accident: accidentDate,
      accident_date: accidentDate,
      date_of_assessment: today,
      assessment_date: today,
      claim_number_if_available: caseRecord?.case_reference,
      claim_number: caseRecord?.case_reference,
      contact_number: client.cell,
      cell: client.cell,
      cellphone: client.cell,
      mobile: client.cell,
      current_date: today,
      today,
      date: today
    };
    const normalizedData = Object.entries(baseData).reduce((mapped, [key, value]) => {
      mapped[normalizeDataKey(key)] = value ?? '';
      return mapped;
    }, {});

    return fields.reduce((values, field) => {
      const readableLabel = getReadableFieldLabel(field, fields);
      const fallbackValue = normalizedData[normalizeDataKey(field.name)] ?? normalizedData[normalizeDataKey(readableLabel)];
      if (!isBlankFormValue(fallbackValue)) values[getEditFormValueKey(field)] = fallbackValue;
      return values;
    }, {});
  }

  function buildEditFormValues(fields, sourceValues = {}, caseRecord = null) {
    const fallbackValues = caseRecord ? buildClaimFallbackValues(fields, caseRecord) : {};
    const nextValues = { ...sourceValues };
    fields.forEach((field) => {
      const valueKey = getEditFormValueKey(field);
      if (!isBlankFormValue(nextValues[valueKey])) return;
      if (isSignatureInputField(field) && !isBlankFormValue(nextValues[field.name])) nextValues[valueKey] = nextValues[field.name];
      else if (!isBlankFormValue(fallbackValues[valueKey])) nextValues[valueKey] = fallbackValues[valueKey];
      else if (field.field_type === 'checkbox') nextValues[valueKey] = false;
      else if (field.field_type === 'repeatable') nextValues[valueKey] = field.default_value || '';
      else nextValues[valueKey] = field.default_value || '';
    });
    return nextValues;
  }

  function isSignatureInputField(field) {
    const label = String(field?.label || '').trim().toLowerCase();
    const name = String(field?.name || '').trim().toLowerCase();
    return label.includes('signature') || name.includes('signature') || label === 'signed' || /^signed(_\d+)?$/.test(name);
  }

  function getEditFormValueKey(field) {
    return isSignatureInputField(field) ? `${field.name}__field_${field.id}` : field.name;
  }

  function isMedicalTemplateField(field, fields = editFormFields) {
    const label = normalizeSectionText(getReadableFieldLabel(field, fields));
    const section = normalizeSectionText(getEditFormSectionTitle(field));

    if (
      section.includes('medical practitioner')
      || section.includes('non serious injuries')
      || section.includes('accident and treatment')
      || section.includes('current symptoms')
      || section.includes('diagnosis')
      || section.includes('examination')
      || section.includes('apportionment')
      || section.includes('exceptions')
    ) {
      return true;
    }

    return (
      label.includes('medical practitioner')
      || label.includes('description of injury')
      || label.includes('describe the nature')
      || label.includes('medical treatment')
      || label.includes('current symptoms')
      || label.includes('complaints')
      || label.includes('diagnosis')
      || label.includes('physical examination')
      || label.includes('diagnostic studies')
      || label.includes('medical history')
      || label.includes('social and personal history')
      || label.includes('educational and occupational')
      || label.includes('apportionment')
      || label.includes('evaluator')
    );
  }

  function buildEditFormPreview(fields, values) {
    const previewValues = { ...values };
    const previewFields = [];

    fields.forEach((field) => {
      const readableLabel = getReadableFieldLabel(field, fields);
      const valueKey = getEditFormValueKey(field);
      const medicalBlocked = isMedicalTemplateField(field, fields);
      if (field.field_type !== 'repeatable') {
        previewFields.push({ ...field, label: readableLabel, source_value_key: valueKey, medical_blocked: medicalBlocked });
        return;
      }

      const repeatValue = Array.isArray(values[valueKey]) ? values[valueKey].join('\n') : String(values[valueKey] || '');
      const groupedBoxes = getGroupedFieldBoxes(field);
      const inputCount = groupedBoxes.length || groupedInputCount(field, repeatValue);
      const lines = repeatValue.split(/\r?\n/);
      while (lines.length < inputCount) lines.push('');

      lines.slice(0, inputCount).forEach((line, index) => {
        const box = groupedBoxes[index];
        const previewName = `${field.name}__preview_${index}`;
        previewValues[previewName] = line;
        previewFields.push({
          ...field,
          id: `${field.id}-preview-${index}`,
          name: previewName,
          label: `${readableLabel} ${index + 1}`,
          page_number: Number(box?.page_number || field.page_number),
          x: Number(box?.x ?? field.x),
          y: Number(box?.y ?? field.y),
          width: Number(box?.width ?? field.width),
          height: Number(box?.height ?? Math.max(18, Math.min(28, Number(field.height || 72) / inputCount - 4))),
          field_type: 'text',
          required: Boolean(field.required) && index === 0,
          default_value: '',
          medical_blocked: medicalBlocked,
          source_value_key: valueKey,
          source_line_index: index,
          source_line_count: inputCount
        });
      });
    });

    return { fields: previewFields, values: previewValues };
  }

  function getEditFormSectionTitle(field) {
    const label = normalizeSectionText(getReadableFieldLabel(field, editFormFields));
    const pageNumber = Number(field.page_number || 1);

    if (
      isSignatureInputField(field)
      || label.includes('signature')
      || label === 'date'
      || label.includes('signed')
      || label.includes('evaluator')
      || label.includes('signed at')
    ) {
      return 'Signatures and Declaration';
    }

    if (pageNumber === 1) {
      if (
        label.includes('name and surname')
        || label.includes('id number')
        || label.includes('claim number')
        || label.includes('contact number')
        || label.includes('date of assessment')
        || label.includes('date of accident')
      ) {
        return 'Details of Patient';
      }

      if (
        label.includes('name & surname')
        || label.includes('practice number')
        || label.includes('telephone number')
        || label.includes('e mail address')
      ) {
        return 'Details of Medical Practitioner';
      }

      return 'List of Non-Serious Injuries';
    }

    if (label.includes('describe the nature') || label.includes('medical treatment rendered')) {
      return 'Accident and Treatment';
    }

    if (label.includes('current symptoms')) {
      return 'Current Symptoms and Complaints';
    }

    if (label.includes('diagnosis')) {
      return 'Diagnosis';
    }

    if (
      label.includes('conclusion regarding physical examination')
      || label.includes('diagnostic studies')
      || label.includes('medical history')
      || label.includes('social and personal history')
    ) {
      return 'Examination, Studies and History';
    }

    if (label.includes('educational') || label.includes('occupational')) {
      return 'Education and Occupation';
    }

    if (label.includes('apportionment')) {
      return 'Apportionment';
    }

    if (label.includes('exceptions')) {
      return 'Exceptions';
    }

    return `Page ${pageNumber}`;
  }

  function buildEditFormSections(fields) {
    const sections = [];
    const sectionLookup = new Map();

    fields.forEach((field) => {
      const title = getEditFormSectionTitle(field);
      const key = normalizeSectionText(title) || 'section';
      const existing = sectionLookup.get(key);
      if (existing) {
        existing.fields.push(field);
        return;
      }
      const section = { key, title, fields: [field] };
      sectionLookup.set(key, section);
      sections.push(section);
    });

    return sections;
  }

  function groupedInputCount(field, value) {
    const groupedBoxes = getGroupedFieldBoxes(field);
    if (groupedBoxes.length > 0) return groupedBoxes.length;
    const filledLines = String(Array.isArray(value) ? value.join('\n') : value || '')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .length;
    const heightCount = Math.round(Number(field.height || 72) / 26);
    return Math.max(filledLines, Math.max(2, Math.min(12, heightCount)));
  }

  function updateGroupedInputLine(valueKey, currentValue, index, nextValue, count) {
    const lines = String(Array.isArray(currentValue) ? currentValue.join('\n') : currentValue || '').split(/\r?\n/);
    while (lines.length < count) lines.push('');
    lines[index] = nextValue;
    updateEditFormValue(valueKey, lines.join('\n'));
  }

  function updateDocumentFieldValue(field, nextValue) {
    if (field.medical_blocked) return;
    if (nextValue === '__open_signature_pad__') {
      setEditingSignatureField(field);
      return;
    }
    const valueKey = field.source_value_key || getEditFormValueKey(field);
    if (Number.isInteger(field.source_line_index)) {
      const currentValue = editFormValues[valueKey];
      const count = Math.max(Number(field.source_line_count || 0), field.source_line_index + 1);
      updateGroupedInputLine(valueKey, currentValue, field.source_line_index, nextValue, count);
      return;
    }
    updateEditFormValue(valueKey, nextValue);
  }

  function updateSignatureFieldValue(nextValue) {
    if (!editingSignatureField) return;
    const valueKey = editingSignatureField.source_value_key || getEditFormValueKey(editingSignatureField);
    updateEditFormValue(valueKey, nextValue);
  }

  function getEditInputProps(field) {
    if (field.field_type === 'date') return { type: 'date' };
    if (field.field_type !== 'number') return { type: 'text' };

    return {
      type: 'text',
      inputMode: 'numeric',
      pattern: '[0-9]*'
    };
  }

  function renderEditField(field) {
    const valueKey = getEditFormValueKey(field);
    const value = editFormValues[valueKey];
    const inputId = `claim-form-field-${field.id}`;
    const signatureInput = isSignatureInputField(field);

    if (field.field_type === 'checkbox') {
      return (
        <label className="checkbox-line claim-form-edit-checkbox">
          <input id={inputId} type="checkbox" checked={Boolean(value)} onChange={(event) => updateEditFormValue(valueKey, event.target.checked)} />
          {getReadableFieldLabel(field, editFormFields)}
        </label>
      );
    }

    if (signatureInput) {
      return (
        <SignatureInput
          id={inputId}
          value={String(value || '')}
          onChange={(nextValue) => updateEditFormValue(valueKey, nextValue)}
        />
      );
    }

    if (field.field_type === 'select') {
      return (
        <select id={inputId} value={value || ''} onChange={(event) => updateEditFormValue(valueKey, event.target.value)} required={field.required}>
          <option value="">Select...</option>
          {(field.options || []).map((option) => <option value={option} key={option}>{option}</option>)}
        </select>
      );
    }

    if (field.field_type === 'repeatable') {
      const repeatValue = Array.isArray(value) ? value.join('\n') : String(value || '');
      const readableLabel = getReadableFieldLabel(field, editFormFields);
      const inputCount = groupedInputCount(field, repeatValue);
      const lines = repeatValue.split(/\r?\n/);
      while (lines.length < inputCount) lines.push('');

      return (
        <div className="grouped-input-fields" role="group" aria-label={readableLabel}>
          <span className="grouped-input-title">{readableLabel}{field.required ? ' *' : ''}</span>
          {lines.slice(0, inputCount).map((line, index) => {
            const lineId = `${inputId}-${index}`;
            return (
              <label className="grouped-input-line" htmlFor={lineId} key={lineId}>
                <span>{readableLabel} {index + 1}</span>
                <input
                  id={lineId}
                  type="text"
                  value={line}
                  onChange={(event) => updateGroupedInputLine(valueKey, repeatValue, index, event.target.value, inputCount)}
                  required={field.required && index === 0}
                />
              </label>
            );
          })}
        </div>
      );
    }

    const inputProps = getEditInputProps(field);
    return (
      <input
        id={inputId}
        className={signatureInput ? 'claim-form-signature-input' : ''}
        {...inputProps}
        value={field.field_type === 'date' ? normalizeDateInputValue(value) : value || ''}
        onChange={(event) => updateEditFormValue(valueKey, event.target.value)}
        required={field.required}
      />
    );
  }

  function renderEditFieldShell(field) {
    const fieldClasses = [
      'claim-form-edit-field',
      isSignatureInputField(field) ? 'signature-input' : '',
      field.field_type === 'repeatable' ? 'repeatable-input' : '',
      field.field_type === 'checkbox' ? 'checkbox-input' : ''
    ].filter(Boolean).join(' ');

    return (
      <div className={fieldClasses} key={field.id}>
        {field.field_type === 'checkbox' || field.field_type === 'repeatable' ? null : (
          <label htmlFor={`claim-form-field-${field.id}`}>
            <span>{getReadableFieldLabel(field, editFormFields)}{field.required ? ' *' : ''}</span>
            {isSignatureInputField(field) && <em>Handwritten</em>}
          </label>
        )}
        {renderEditField(field)}
      </div>
    );
  }

  function closeDocumentPreview() {
    setDocumentPreview((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  async function openClaimForms(caseRecord) {
    setClaimFormsCase(caseRecord);
    setClaimFormsPayload(null);
    setSelectedTemplateIds([]);
    setFormsLoading(true);
    setError('');

    try {
      const result = await apiRequest(`/api/firms/${id}/claims/${caseRecord.id}/forms`);
      setClaimFormsPayload(result);
    } catch (err) {
      setError(err.message);
      setClaimFormsCase(null);
    } finally {
      setFormsLoading(false);
    }
  }

  function toggleTemplate(templateId) {
    setSelectedTemplateIds((current) => (
      current.includes(templateId)
        ? current.filter((idValue) => idValue !== templateId)
        : [...current, templateId]
    ));
  }

  async function attachClaimForms(event) {
    event.preventDefault();
    if (!claimFormsCase || selectedTemplateIds.length === 0) return;
    setAttachingForms(true);
    setError('');
    setMessage('');

    try {
      const result = await apiRequest(`/api/firms/${id}/claims/${claimFormsCase.id}/forms`, {
        method: 'POST',
        body: { template_ids: selectedTemplateIds }
      });
      setClaimFormsPayload(result);
      setWorkspace(result.workspace);
      setSelectedTemplateIds([]);
      setMessage(`${selectedTemplateIds.length} template form(s) attached and filled for ${claimFormsCase.first_name} ${claimFormsCase.surname}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setAttachingForms(false);
    }
  }

  return (
    <section className="page-stack">
      <div className="section-header">
        <div>
          <h2>Claims</h2>
          <p>RAF matters and document intake for {workspace?.firm?.name || 'this firm'}.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setClaimModalOpen(true)}>
          <FilePlus2 size={17} />
          Create New RAF Claim
        </button>
      </div>

      <StatusMessage type="error">{error}</StatusMessage>
      <StatusMessage type="success">{message}</StatusMessage>

      {workspace && (
        <>
          <div className="firm-stats">
            <div className="metric">
              <div className="firm-stat-top">
                <span className="metric-icon"><BriefcaseBusiness size={22} /></span>
                <strong>{workspace.stats.openCases}</strong>
              </div>
              <div className="metric-body">
                <span>Open RAF cases</span>
              </div>
              <small>Active client matters</small>
            </div>
            <div className="metric">
              <div className="firm-stat-top">
                <span className="metric-icon"><FolderOpen size={22} /></span>
                <strong>{workspace.stats.requestedDocuments}</strong>
              </div>
              <div className="metric-body">
                <span>Requested docs</span>
              </div>
              <small>Waiting for client upload</small>
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
                <span className="metric-icon"><Clock3 size={22} /></span>
                <strong>{cases.length}</strong>
              </div>
              <div className="metric-body">
                <span>Recent claims</span>
              </div>
              <small>Latest RAF case records</small>
            </div>
          </div>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>RAF claims</h3>
                <p>Recent matters opened in this firm database.</p>
              </div>
              <div className="firm-table-tools">
                <label className="table-search" aria-label="Search RAF claims">
                  <Search size={16} />
                  <input
                    type="search"
                    placeholder="Search claims"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                </label>
                <label className="table-filter" aria-label="Filter claims by client">
                  <Filter size={16} />
                  <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
                    <option value="all">All clients</option>
                    {clientOptions.map((client) => (
                      <option value={String(client.id)} key={client.id}>
                        {client.first_name} {client.surname}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="firm-table-wrap">
              {cases.length === 0 && <p className="muted">No RAF claims yet.</p>}
              {cases.length > 0 && filteredCases.length === 0 && <p className="muted">No claims match the selected filters.</p>}
              {filteredCases.length > 0 && (
                <table className="firm-table claims-table">
                  <colgroup>
                    <col className="claim-reference-col" />
                    <col className="claim-client-col" />
                    <col className="claim-date-col" />
                    <col className="claim-opened-col" />
                    <col className="claim-medical-col" />
                    <col className="claim-status-col" />
                    <col className="claim-process-col" />
                    <col className="claim-template-col" />
                    <col className="claim-completion-col" />
                    <col className="claim-files-col" />
                    <col className="claim-actions-col" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Claim reference</th>
                      <th>Client</th>
                      <th>Accident date</th>
	                      <th>Opened</th>
                      <th>Medical request</th>
                      <th>Status</th>
	                      <th>Process status</th>
		                      <th>Template forms</th>
		                      <th>Completion</th>
		                      <th>Form files</th>
	                      <th>Actions</th>
                    </tr>
                  </thead>
	                  <tbody>
	                    {filteredCases.map((caseRecord) => {
	                      const processStatus = getProcessStatus(caseRecord);
	                      const claimFormCount = getClaimFormCount(caseRecord);
	                      const attachedForms = getAttachedClaimForms(caseRecord);
                        const medicalAssessmentRequest = getMedicalAssessmentRequest(caseRecord);
	                      return (
                        <tr key={caseRecord.id}>
	                          <td className="claim-reference-cell" data-label="Claim reference">
	                            <strong title={caseRecord.case_reference}>{formatCompactReference(caseRecord.case_reference)}</strong>
	                            <span>Case #{caseRecord.id}</span>
                          </td>
                          <td data-label="Client">{caseRecord.first_name} {caseRecord.surname}</td>
                          <td data-label="Accident date">{formatDisplayDate(caseRecord.accident_date)}</td>
	                          <td data-label="Opened">{new Date(caseRecord.opened_at).toLocaleDateString()}</td>
                          <td data-label="Medical request">
                            <button
                              className={`claim-form-open-button ${medicalAssessmentRequest ? 'attached' : 'empty'}`}
                              type="button"
                              onClick={() => openMedicalAssessment(caseRecord)}
                              title={medicalAssessmentRequest ? `Medical assessment requested from ${medicalAssessmentRequest.doctor_name}` : 'Request medical assessment'}
                              aria-label={`Request medical assessment for ${caseRecord.first_name} ${caseRecord.surname}`}
                            >
                              <FileText size={15} />
                              <span>{medicalAssessmentRequest ? 'Requested' : 'Request report'}</span>
                            </button>
                          </td>
                          <td data-label="Status"><span className={`status-pill ${caseRecord.status}`}>{caseRecord.status}</span></td>
                          <td data-label="Process status">
                            <span className={`status-pill ${processStatus.className}`}>{processStatus.label}</span>
                            {processStatus.detail && <span>{processStatus.detail}</span>}
                          </td>
		                          <td data-label="Template forms">
		                            <button
		                              className={`claim-form-open-button ${claimFormCount > 0 ? 'attached' : 'empty'}`}
		                              type="button"
		                              onClick={() => openClaimForms(caseRecord)}
		                              title={`${claimFormCount} template form(s) attached`}
		                              aria-label={`${claimFormCount} template form(s) attached for ${caseRecord.first_name} ${caseRecord.surname}`}
		                            >
		                              <FilePlus2 size={15} />
		                              <span>{claimFormCount} attached</span>
		                            </button>
	                          </td>
	                          <td data-label="Completion">
	                            <ClaimFormsAverageStatus forms={attachedForms} />
	                            {attachedForms.length === 0 && <span className="claim-form-file-empty">No forms</span>}
	                          </td>
	                          <td data-label="Form files">
	                            {attachedForms.length === 0 ? (
	                              <span className="claim-form-file-empty">No files yet</span>
	                            ) : (
	                              <button
	                                className="claim-form-view-button"
	                                type="button"
	                                onClick={() => setFormFilesCase(caseRecord)}
	                                title={`${attachedForms.length} attached template(s)`}
	                                aria-label={`View attached templates for ${caseRecord.first_name} ${caseRecord.surname}`}
	                              >
	                                Claim Form
	                              </button>
	                            )}
	                          </td>
		                          <td data-label="Actions">
		                            <div className="table-actions">
		                              <button
		                                type="button"
		                                onClick={() => setIntakeCase(caseRecord)}
	                                title="View document intake"
	                                aria-label={`View document intake for ${caseRecord.first_name} ${caseRecord.surname}`}
	                              >
	                                <FolderOpen size={15} />
	                              </button>
	                              <button
	                                type="button"
	                                onClick={() => sendReminder(caseRecord)}
                                disabled={remindingClientId === caseRecord.client_id}
                                title="Send document upload reminder"
                                aria-label={`Send reminder to ${caseRecord.first_name} ${caseRecord.surname}`}
                              >
                                {remindingClientId === caseRecord.client_id ? <LoadingSpinner size="sm" label="Sending reminder..." /> : <BellRing size={15} />}
                              </button>
                              <button
                                type="button"
                                onClick={() => copyClientIntakeLink(caseRecord)}
                                title={copiedClientId === caseRecord.client_id ? 'Link copied' : 'Copy client intake link'}
                                aria-label={`Copy client intake link for ${caseRecord.first_name} ${caseRecord.surname}`}
                              >
                                <Copy size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
	              )}
            </div>
          </section>
          {claimModalOpen && (
            <div className="modal-backdrop" role="presentation">
              <section className="modal-panel raf-claim-modal" role="dialog" aria-modal="true" aria-labelledby="raf-claim-title">
                <div className="modal-header">
                  <div>
                    <h3 id="raf-claim-title">Create New RAF Claim</h3>
                    <p>Capture claimant, accident, vehicle, witness, and claim amount details.</p>
                  </div>
                  <button className="icon-button ghost" type="button" onClick={closeNewClaimModal} aria-label="Close claim form">
                    <X size={18} />
                  </button>
                </div>

                <form className="raf-claim-form" onSubmit={createNewClaim}>
                  <section className="raf-claim-section">
                    <h4>Claimant information</h4>
                    <div className="raf-claim-grid">
                      <label>
                        Full names
                        <input value={newClaimForm.first_name} onChange={(event) => updateNewClaimField('first_name', event.target.value)} required />
                      </label>
                      <label>
                        Surname
                        <input value={newClaimForm.surname} onChange={(event) => updateNewClaimField('surname', event.target.value)} required />
                      </label>
                      <label>
                        ID number
                        <input value={newClaimForm.id_number} onChange={(event) => updateNewClaimField('id_number', event.target.value)} />
                      </label>
                      <label>
                        Passport number
                        <input value={newClaimForm.passport_number} onChange={(event) => updateNewClaimField('passport_number', event.target.value)} />
                      </label>
                      <label>
                        Date of birth
                        <input type="date" value={newClaimForm.date_of_birth} onChange={(event) => updateNewClaimField('date_of_birth', event.target.value)} />
                      </label>
                      <label>
                        Contact number
                        <input value={newClaimForm.cell} onChange={(event) => updateNewClaimField('cell', event.target.value)} required />
                      </label>
                      <label>
                        Email
                        <input type="email" value={newClaimForm.email} onChange={(event) => updateNewClaimField('email', event.target.value)} required />
                      </label>
                      <label>
                        Occupation
                        <input value={newClaimForm.occupation} onChange={(event) => updateNewClaimField('occupation', event.target.value)} />
                      </label>
                      <label className="span-2">
                        Residential address
                        <textarea value={newClaimForm.residential_address} onChange={(event) => updateNewClaimField('residential_address', event.target.value)} />
                      </label>
                      <label className="span-2">
                        Employer details
                        <textarea value={newClaimForm.employer_details} onChange={(event) => updateNewClaimField('employer_details', event.target.value)} />
                      </label>
                    </div>
                  </section>

                  <section className="raf-claim-section">
                    <h4>Banking details</h4>
                    <div className="raf-claim-grid">
                      <label>
                        Bank name
                        <input value={newClaimForm.bank_name} onChange={(event) => updateNewClaimField('bank_name', event.target.value)} />
                      </label>
                      <label>
                        Account holder
                        <input value={newClaimForm.account_holder} onChange={(event) => updateNewClaimField('account_holder', event.target.value)} />
                      </label>
                      <label>
                        Account number
                        <input value={newClaimForm.account_number} onChange={(event) => updateNewClaimField('account_number', event.target.value)} />
                      </label>
                      <label>
                        Branch code
                        <input value={newClaimForm.branch_code} onChange={(event) => updateNewClaimField('branch_code', event.target.value)} />
                      </label>
                      <label>
                        Account type
                        <input value={newClaimForm.account_type} onChange={(event) => updateNewClaimField('account_type', event.target.value)} />
                      </label>
                    </div>
                  </section>

                  <section className="raf-claim-section">
                    <h4>Representative or guardian</h4>
                    <div className="raf-claim-grid">
                      <label>
                        Name
                        <input value={newClaimForm.representative_name} onChange={(event) => updateNewClaimField('representative_name', event.target.value)} />
                      </label>
                      <label>
                        Relationship
                        <input value={newClaimForm.representative_relationship} onChange={(event) => updateNewClaimField('representative_relationship', event.target.value)} />
                      </label>
                      <label>
                        Contact details
                        <input value={newClaimForm.representative_contact} onChange={(event) => updateNewClaimField('representative_contact', event.target.value)} />
                      </label>
                      <label className="span-2">
                        Address
                        <textarea value={newClaimForm.representative_address} onChange={(event) => updateNewClaimField('representative_address', event.target.value)} />
                      </label>
                    </div>
                  </section>

                  <section className="raf-claim-section">
                    <h4>Accident information</h4>
                    <div className="raf-claim-grid">
                      <label>
                        Accident date
                        <input type="date" value={newClaimForm.accident_date} onChange={(event) => updateNewClaimField('accident_date', event.target.value)} />
                      </label>
                      <label>
                        Accident time
                        <input type="time" value={newClaimForm.accident_time} onChange={(event) => updateNewClaimField('accident_time', event.target.value)} />
                      </label>
                      <label className="span-2">
                        Accident location
                        <input value={newClaimForm.accident_location} onChange={(event) => updateNewClaimField('accident_location', event.target.value)} />
                      </label>
                      <div className="raf-form-selection-preview span-2">
                        <strong>{newClaimFormSelection.label}</strong>
                        <div>
                          {newClaimFormSelection.forms.map((formName) => <span key={formName}>{formName}</span>)}
                        </div>
                        <p>{newClaimFormSelection.note}</p>
                        {newClaimLodgementDeadline && (
                          <p>Estimated lodgement deadline: {formatDisplayDate(newClaimLodgementDeadline)} · Internal target: {formatDisplayDate(newClaimInternalDeadline)} · Attorney verification required.</p>
                        )}
                      </div>
                      <label>
                        Police station
                        <input value={newClaimForm.police_station} onChange={(event) => updateNewClaimField('police_station', event.target.value)} />
                      </label>
                      <label>
                        Police case number
                        <input value={newClaimForm.police_case_number} onChange={(event) => updateNewClaimField('police_case_number', event.target.value)} />
                      </label>
                      <label>
                        Claimant role
                        <select value={newClaimForm.claimant_role} onChange={(event) => updateNewClaimField('claimant_role', event.target.value)}>
                          <option>Driver</option>
                          <option>Passenger</option>
                          <option>Pedestrian</option>
                          <option>Cyclist</option>
                          <option>Dependant</option>
                        </select>
                      </label>
                      <label className="span-2">
                        Description of the collision
                        <textarea value={newClaimForm.collision_description} onChange={(event) => updateNewClaimField('collision_description', event.target.value)} />
                      </label>
                    </div>
                  </section>

                  <section className="raf-claim-section">
                    <h4>Vehicle, driver, owner, and witnesses</h4>
                    <div className="raf-claim-grid">
                      <label>
                        Vehicle registration
                        <input value={newClaimForm.vehicle_registration} onChange={(event) => updateNewClaimField('vehicle_registration', event.target.value)} />
                      </label>
                      <label>
                        Vehicle make
                        <input value={newClaimForm.vehicle_make} onChange={(event) => updateNewClaimField('vehicle_make', event.target.value)} />
                      </label>
                      <label>
                        Vehicle model
                        <input value={newClaimForm.vehicle_model} onChange={(event) => updateNewClaimField('vehicle_model', event.target.value)} />
                      </label>
                      <label>
                        Driver name
                        <input value={newClaimForm.driver_name} onChange={(event) => updateNewClaimField('driver_name', event.target.value)} />
                      </label>
                      <label>
                        Driver ID number
                        <input value={newClaimForm.driver_id_number} onChange={(event) => updateNewClaimField('driver_id_number', event.target.value)} />
                      </label>
                      <label>
                        Driver contact
                        <input value={newClaimForm.driver_contact} onChange={(event) => updateNewClaimField('driver_contact', event.target.value)} />
                      </label>
                      <label>
                        Driver licence number
                        <input value={newClaimForm.driver_license_number} onChange={(event) => updateNewClaimField('driver_license_number', event.target.value)} />
                      </label>
                      <label>
                        Vehicle owner
                        <input value={newClaimForm.owner_name} onChange={(event) => updateNewClaimField('owner_name', event.target.value)} />
                      </label>
                      <label>
                        Owner contact
                        <input value={newClaimForm.owner_contact} onChange={(event) => updateNewClaimField('owner_contact', event.target.value)} />
                      </label>
                      <label>
                        Witness name
                        <input value={newClaimForm.witness_name} onChange={(event) => updateNewClaimField('witness_name', event.target.value)} />
                      </label>
                      <label>
                        Witness contact
                        <input value={newClaimForm.witness_contact} onChange={(event) => updateNewClaimField('witness_contact', event.target.value)} />
                      </label>
                      <label className="span-2">
                        Vehicle details
                        <textarea value={newClaimForm.vehicle_description} onChange={(event) => updateNewClaimField('vehicle_description', event.target.value)} />
                      </label>
                      <label className="span-2">
                        Owner address
                        <textarea value={newClaimForm.owner_address} onChange={(event) => updateNewClaimField('owner_address', event.target.value)} />
                      </label>
                      <label className="span-2">
                        Witness information
                        <textarea value={newClaimForm.witness_statement} onChange={(event) => updateNewClaimField('witness_statement', event.target.value)} />
                      </label>
                    </div>
                  </section>

                  <section className="raf-claim-section">
                    <h4>Claim amounts</h4>
                    <div className="raf-claim-grid amount-grid">
                      <label>
                        Medical expenses
                        <input type="number" min="0" step="0.01" value={newClaimForm.medical_expenses} onChange={(event) => updateNewClaimField('medical_expenses', event.target.value)} />
                      </label>
                      <label>
                        Loss of earnings
                        <input type="number" min="0" step="0.01" value={newClaimForm.loss_of_earnings} onChange={(event) => updateNewClaimField('loss_of_earnings', event.target.value)} />
                      </label>
                      <label>
                        Loss of support
                        <input type="number" min="0" step="0.01" value={newClaimForm.loss_of_support} onChange={(event) => updateNewClaimField('loss_of_support', event.target.value)} />
                      </label>
                      <label>
                        Funeral expenses
                        <input type="number" min="0" step="0.01" value={newClaimForm.funeral_expenses} onChange={(event) => updateNewClaimField('funeral_expenses', event.target.value)} />
                      </label>
                      <label>
                        General damages
                        <input type="number" min="0" step="0.01" value={newClaimForm.general_damages} onChange={(event) => updateNewClaimField('general_damages', event.target.value)} />
                      </label>
                      <label>
                        Future medical expenses
                        <input type="number" min="0" step="0.01" value={newClaimForm.future_medical_expenses} onChange={(event) => updateNewClaimField('future_medical_expenses', event.target.value)} />
                      </label>
                      <label className="span-2">
                        Other allowed compensation categories
                        <input type="number" min="0" step="0.01" value={newClaimForm.other_compensation} onChange={(event) => updateNewClaimField('other_compensation', event.target.value)} />
                      </label>
                    </div>
                  </section>

                  <section className="raf-claim-section">
                    <h4>Document reminders</h4>
                    <label className="checkbox-line">
                      <input
                        type="checkbox"
                        checked={newClaimForm.auto_reminders_enabled}
                        onChange={(event) => updateNewClaimField('auto_reminders_enabled', event.target.checked)}
                      />
                      <span>Enable automatic reminders for pending documents</span>
                    </label>
                    {newClaimForm.auto_reminders_enabled && (
                      <label className="raf-reminder-time">
                        Reminder time
                        <input type="time" value={newClaimForm.reminder_time} onChange={(event) => updateNewClaimField('reminder_time', event.target.value)} required />
                      </label>
                    )}
                  </section>

                  <div className="modal-actions">
                    <button className="secondary-button" type="button" onClick={closeNewClaimModal}>Cancel</button>
                    <button className="primary-button" disabled={creatingClaim}>
                      {creatingClaim ? <ButtonSpinner label="Creating..." /> : <FilePlus2 size={17} />}
                      {!creatingClaim && 'Create RAF claim'}
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}
          {medicalReportCase && (
            <div className="modal-backdrop claim-form-picker-backdrop" role="presentation">
              <section className="modal-panel claim-form-picker-modal medical-report-modal" role="dialog" aria-modal="true" aria-labelledby="medical-report-title">
                <div className="modal-header claim-form-hero">
                  <div>
                    <span className="eyebrow">Medical workflow</span>
                    <h3 id="medical-report-title">Request medical report</h3>
                    <p>{medicalReportCase.first_name} {medicalReportCase.surname} · {medicalReportCase.case_reference}</p>
                  </div>
                  <button className="icon-button ghost" type="button" onClick={closeMedicalAssessment} aria-label="Close medical request">
                    <X size={18} />
                  </button>
                </div>

                <div className="medical-request-layout">
                  <form className="medical-request-form" onSubmit={createMedicalAssessment}>
                    <div className="medical-request-card-head">
                      <strong>Doctor request</strong>
                      <span>Assigned patient only</span>
                    </div>
                    <div className="form-grid">
                      <label className="span-2">
                        Report type
                        <select value={medicalAssessmentForm.report_type} onChange={(event) => updateMedicalAssessmentField('report_type', event.target.value)}>
                          {medicalReportTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                      </label>
                      <label>
                        Doctor name
                        <input value={medicalAssessmentForm.doctor_name} onChange={(event) => updateMedicalAssessmentField('doctor_name', event.target.value)} placeholder="Dr full name" required />
                      </label>
                      <label>
                        Practice number
                        <input value={medicalAssessmentForm.practice_number} onChange={(event) => updateMedicalAssessmentField('practice_number', event.target.value)} placeholder="HPCSA / practice no." />
                      </label>
                      <label>
                        Doctor email
                        <input type="email" value={medicalAssessmentForm.doctor_email} onChange={(event) => updateMedicalAssessmentField('doctor_email', event.target.value)} placeholder="doctor@example.com" />
                      </label>
                      <label>
                        Doctor phone
                        <input value={medicalAssessmentForm.doctor_phone} onChange={(event) => updateMedicalAssessmentField('doctor_phone', event.target.value)} placeholder="SMS number" />
                      </label>
                      <label>
                        Due date
                        <input type="date" value={medicalAssessmentForm.deadline} onChange={(event) => updateMedicalAssessmentField('deadline', event.target.value)} />
                      </label>
                      <label>
                        Delivery
                        <select value={medicalAssessmentForm.delivery_method} onChange={(event) => updateMedicalAssessmentField('delivery_method', event.target.value)}>
                          <option value="link">Secure link</option>
                          <option value="email">Email</option>
                          <option value="sms">SMS</option>
                        </select>
                      </label>
                    </div>
                    <div className="modal-actions">
                      <button className="secondary-button" type="button" onClick={closeMedicalAssessment}>Cancel</button>
                      <button className="primary-button" disabled={creatingMedicalAssessment}>
                        {creatingMedicalAssessment ? <ButtonSpinner label="Creating..." /> : medicalAssessmentForm.delivery_method === 'link' ? <Copy size={17} /> : <Send size={17} />}
                        {!creatingMedicalAssessment && (medicalAssessmentForm.delivery_method === 'link' ? 'Generate link' : 'Create request')}
                      </button>
                    </div>
                  </form>

                  <div className="medical-workflow-card">
                    <div className="medical-access-heading">
                      <h4>Doctor access</h4>
                      <span>Limited</span>
                    </div>
                    <ul>
                      <li>Secure link for one assigned patient.</li>
                      <li>Patient and accident details only.</li>
                      <li>Share link by email, SMS, or manually.</li>
                      <li>Doctor completes, signs, and submits.</li>
                    </ul>
                    <p>Doctor link cannot open the firm database.</p>
                  </div>

                  {activeMedicalAssessmentRequest && (
                    <div className="medical-request-summary">
                      <span className="status-pill pending">{activeMedicalAssessmentRequest.status}</span>
                      <div>
                        <strong>{getMedicalReportTypeLabel(activeMedicalAssessmentRequest.report_type)}</strong>
                        <small>
                          {activeMedicalAssessmentRequest.doctor_name}
                          {activeMedicalAssessmentRequest.deadline ? ` · Due ${formatDisplayDate(activeMedicalAssessmentRequest.deadline)}` : ''}
                        </small>
                      </div>
                      <button className="claim-form-view-button" type="button" onClick={() => copyMedicalAssessmentLink(activeMedicalAssessmentRequest)}>
                        {copiedMedicalRequestId === activeMedicalAssessmentRequest.id ? 'Copied' : 'Copy link'}
                      </button>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
	          {intakeCase && (
            <div className="modal-backdrop" role="presentation">
	              <section className="modal-panel document-intake-modal" role="dialog" aria-modal="true" aria-labelledby="document-intake-title">
	                <div className="modal-header">
	                  <div>
	                    <h3 id="document-intake-title">Document intake</h3>
	                    <p>{intakeCase.first_name} {intakeCase.surname} · {intakeCase.case_reference}</p>
	                  </div>
	                  <button className="icon-button ghost" type="button" onClick={() => setIntakeCase(null)} aria-label="Close document intake">
	                    <X size={18} />
	                  </button>
	                </div>
	                <div className="table-list document-intake-list">
	                  {intakeRequests.length === 0 && <p className="muted">No document requests yet.</p>}
	                  {intakeRequests.map((request) => (
	                    <div className="workspace-row document-request-row" key={request.id}>
	                      <div>
	                        <strong>{request.label}</strong>
	                        <span>
	                          {request.first_name} {request.surname} · {request.status} · {request.upload_count} upload(s)
	                          {request.latest_upload_filename ? ` · ${request.latest_upload_filename}` : ''}
	                        </span>
	                      </div>
	                      <div className="document-request-actions">
	                        <button
	                          type="button"
	                          onClick={() => viewUpload(request)}
	                          disabled={viewingRequestId === request.id}
	                          title="View document record"
	                          aria-label={`View ${request.label} for ${request.first_name} ${request.surname}`}
	                        >
	                          {viewingRequestId === request.id ? <LoadingSpinner size="sm" label="Opening document..." /> : <Eye size={15} />}
	                        </button>
	                        <label title="Upload document" aria-label={`Upload ${request.label}`}>
	                          {uploadingRequestId === request.id ? <LoadingSpinner size="sm" label="Uploading document..." /> : <UploadCloud size={15} />}
	                          <input
	                            type="file"
	                            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
	                            disabled={uploadingRequestId === request.id}
	                            onChange={(event) => {
	                              uploadDocument(request, event.target.files?.[0]);
	                              event.target.value = '';
	                            }}
	                          />
	                        </label>
	                      </div>
	                    </div>
	                  ))}
	                </div>
	              </section>
	            </div>
	          )}
	          {formFilesCase && (
	            <div className="modal-backdrop claim-form-picker-backdrop" role="presentation">
	              <section className="modal-panel claim-form-picker-modal" role="dialog" aria-modal="true" aria-labelledby="claim-form-picker-title">
	                <div className="modal-header">
	                  <div>
	                    <h3 id="claim-form-picker-title">Attached templates</h3>
	                    <p>{formFilesCase.first_name} {formFilesCase.surname} · {formFilesCase.case_reference}</p>
	                  </div>
	                  <button className="icon-button ghost" type="button" onClick={() => setFormFilesCase(null)} aria-label="Close attached templates">
	                    <X size={18} />
	                  </button>
	                </div>
	                <div className="claim-form-picker-list">
	                  {formFileOptions.length === 0 && <p className="muted">No template form files attached yet.</p>}
	                  {formFileOptions.map((form) => (
	                    <div className={`claim-form-picker-row ${fillingClaimFormId === form.id ? 'is-filling' : ''}`} key={form.id}>
	                      <span className="claim-form-attached-icon"><FileText size={17} /></span>
	                      <span className="template-card-copy">
	                        <strong>{form.template?.name || form.document?.file_name || 'Claim form'}</strong>
	                        <small>{form.document?.file_name || form.status}</small>
	                      </span>
	                      <ClaimFormInputStatus form={form} />
	                      <div className="claim-form-picker-actions">
	                        <button
	                          className="claim-form-view-button"
	                          type="button"
	                          onClick={() => previewClaimForm(form, formFilesCase)}
	                          disabled={!form.document?.id || previewingClaimFormId === form.id}
	                          title="View attached template"
	                          aria-label={`View ${form.template?.name || 'attached template'}`}
	                        >
	                          {previewingClaimFormId === form.id ? <LoadingSpinner size="sm" label="Opening template..." /> : 'View'}
	                        </button>
	                        <button
	                          className="claim-form-view-button"
	                          type="button"
	                          onClick={() => downloadClaimForm(form)}
	                          disabled={!form.document?.id}
	                          title="Download attached template"
	                          aria-label={`Download ${form.template?.name || 'attached template'}`}
	                        >
	                          <Download size={14} />
	                          Download
	                        </button>
	                        <button
	                          className="claim-form-view-button edit-form"
	                          type="button"
	                          onClick={() => openEditClaimForm(form, formFilesCase)}
	                          disabled={editFormLoading || savingEditedFormId === form.id}
	                          title="Edit form inputs"
	                          aria-label={`Edit ${form.template?.name || 'attached template'} inputs`}
	                        >
	                          <Edit3 size={14} />
	                          Edit form
	                        </button>
	                        <button
	                          className="claim-form-view-button ai-fill"
	                          type="button"
	                          onClick={() => fillClaimFormWithAi(form, formFilesCase)}
	                          disabled={fillingClaimFormId === form.id}
	                          title="Fill document with AI"
	                          aria-label={`Fill ${form.template?.name || 'attached template'} with AI`}
	                        >
	                          {fillingClaimFormId === form.id ? <LoadingSpinner size="sm" label="Filling document..." /> : <><Sparkles size={14} /> Fill with AI</>}
	                        </button>
	                        <button
	                          className="claim-form-view-button danger-lite"
	                          type="button"
	                          onClick={() => setDeleteClaimFormTarget({ form, caseRecord: formFilesCase })}
	                          disabled={deletingClaimFormId === form.id}
	                          title="Remove attached template"
	                          aria-label={`Remove ${form.template?.name || 'attached template'}`}
	                        >
	                          {deletingClaimFormId === form.id ? <LoadingSpinner size="sm" label="Removing template..." /> : <><Trash2 size={14} /> Delete</>}
	                        </button>
	                      </div>
	                      {fillingClaimFormId === form.id && (
	                        <div className="claim-form-fill-progress">
	                          <div>
	                            <span>Filling document inputs</span>
	                            <strong>{fillingProgress}%</strong>
	                          </div>
	                          <progress value={fillingProgress} max="100" aria-label="Filling document inputs" />
	                        </div>
	                      )}
	                    </div>
	                  ))}
	                </div>
	              </section>
	            </div>
	          )}
	          {editingClaimForm && (
	            <div className="modal-backdrop claim-form-edit-backdrop" role="presentation">
	              <section className={`modal-panel claim-form-edit-modal ${editFormFullscreen ? 'fullscreen' : ''}`} role="dialog" aria-modal="true" aria-labelledby="claim-form-edit-title">
	                <div className="modal-header claim-form-edit-header">
	                  <div>
	                    <h3 id="claim-form-edit-title">Edit form inputs</h3>
	                    <p>{editingClaimForm.form.template?.name || editingClaimForm.form.document?.file_name || 'Template form'}</p>
	                  </div>
	                  <div className="claim-form-edit-header-actions">
	                    <button
	                      className="claim-form-edit-ai-button"
	                      type="button"
	                      onClick={fillEditingClaimFormWithAi}
	                      disabled={fillingClaimFormId === editingClaimForm.form.id}
	                      title="Fill document with AI"
	                      aria-label="Fill document with AI"
	                    >
	                      {fillingClaimFormId === editingClaimForm.form.id ? <LoadingSpinner size="sm" label="Filling document..." /> : <Sparkles size={14} />}
	                      <span>{fillingClaimFormId === editingClaimForm.form.id ? `Filling ${fillingProgress}%` : 'Fill with AI'}</span>
	                    </button>
	                    <label className="claim-form-edit-control" title="Form font style">
	                      <Type size={14} />
	                      <select value={editFormFont} onChange={(event) => setEditFormFont(event.target.value)} aria-label="Form font style">
	                        <option value="sans">Sans</option>
	                        <option value="serif">Serif</option>
	                        <option value="mono">Mono</option>
	                        <option value="signature">Handwritten</option>
	                      </select>
	                    </label>
	                    <button
	                      className="icon-button ghost"
	                      type="button"
	                      onClick={() => setEditFormFullscreen((current) => !current)}
	                      title={editFormFullscreen ? 'Exit full screen' : 'View full screen'}
	                      aria-label={editFormFullscreen ? 'Exit full screen' : 'View edit form full screen'}
	                    >
	                      {editFormFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
	                    </button>
	                    <button className="icon-button ghost" type="button" onClick={() => setEditingClaimForm(null)} aria-label="Close edit form">
	                      <X size={18} />
	                    </button>
	                  </div>
	                </div>
	                {editFormLoading ? (
	                  <div className="loading-panel compact-loading">
	                    <LoadingSpinner size="lg" label="Loading form inputs..." />
	                    <span>Loading form inputs...</span>
	                  </div>
	                ) : (
	                  <form className="claim-form-edit-body" onSubmit={saveEditedClaimForm}>
	                    <div className="claim-form-edit-layout document-entry-layout">
	                      <div className={`claim-form-live-preview document-entry-preview font-${editFormFont}`}>
	                        <div className="claim-form-live-preview-header">
	                          <strong>Fill on document</strong>
	                          <span>{editFormPreviewFields.length} inputs</span>
	                        </div>
	                        <PdfWorkspace
	                          pdfPath={`/api/templates/${editingClaimForm.form.template.id}/pdf`}
	                          fields={editFormPreviewFields}
	                          onFieldsChange={() => {}}
	                          selectedFieldId={null}
	                          onSelectField={() => {}}
	                          entryMode
	                          onEntryValueChange={updateDocumentFieldValue}
	                          values={editFormPreviewValues}
	                        />
	                      </div>
	                    </div>
	                    <div className="modal-actions claim-form-edit-actions">
	                      <button className="secondary-button" type="button" onClick={() => setEditingClaimForm(null)}>Cancel</button>
	                      <button className="primary-button" disabled={savingEditedFormId === editingClaimForm.form.id || editFormFields.length === 0}>
	                        {savingEditedFormId === editingClaimForm.form.id ? <ButtonSpinner label="Saving..." /> : 'Save and fill document'}
	                      </button>
	                    </div>
	                    {editingSignatureField && (
	                      <div className="signature-draw-popover" role="dialog" aria-modal="true" aria-label={`Draw ${editingSignatureField.label}`}>
	                        <div className="signature-draw-panel">
	                          <div className="signature-draw-header">
	                            <div>
	                              <strong>{getReadableFieldLabel(editingSignatureField, editFormFields)}</strong>
	                              <span>Handwritten signature</span>
	                            </div>
	                            <button className="icon-button ghost" type="button" onClick={() => setEditingSignatureField(null)} aria-label="Close signature pad">
	                              <X size={18} />
	                            </button>
	                          </div>
	                          <SignatureInput
	                            id={`claim-form-document-signature-${editingSignatureField.id}`}
	                            value={String(editFormValues[editingSignatureField.source_value_key || getEditFormValueKey(editingSignatureField)] || '')}
	                            onChange={updateSignatureFieldValue}
	                          />
	                          <div className="signature-draw-actions">
	                            <button className="primary-button" type="button" onClick={() => setEditingSignatureField(null)}>Done</button>
	                          </div>
	                        </div>
	                      </div>
	                    )}
	                  </form>
	                )}
	              </section>
	            </div>
	          )}
	          {claimFormsCase && (
            <div className="modal-backdrop claim-form-backdrop" role="presentation">
	              <section className="modal-panel claim-form-modal" role="dialog" aria-modal="true" aria-labelledby="claim-form-title">
	                <div className="modal-header claim-form-hero">
	                  <div>
	                    <span className="eyebrow">Template forms</span>
	                    <h3 id="claim-form-title">Attach template form</h3>
	                    <p>{claimFormsCase.first_name} {claimFormsCase.surname} · {claimFormsCase.case_reference}</p>
	                  </div>
	                  <div className="claim-form-hero-stat">
	                    <strong>{claimFormsPayload?.attached_forms?.length || 0}</strong>
	                    <span>attached</span>
	                  </div>
	                  <button className="icon-button ghost" type="button" onClick={() => setClaimFormsCase(null)} aria-label="Close template forms">
	                    <X size={18} />
	                  </button>
		                </div>
		                <StatusMessage type="error">{error}</StatusMessage>

		                {formsLoading && (
	                  <div className="loading-panel compact-loading">
	                    <LoadingSpinner size="lg" label="Loading template forms..." />
	                    <span>Loading template forms...</span>
	                  </div>
	                )}

	                {!formsLoading && claimFormsPayload && (
	                  <div className="claim-form-grid">
	                    <section className="claim-form-section">
	                      <div className="panel-header claim-form-section-header">
	                        <div>
	                          <h3>Attached forms</h3>
	                          <p>Generated files attached to this claim.</p>
	                        </div>
	                        <span>{claimFormsPayload.attached_forms.length}</span>
	                      </div>
	                      <div className="claim-form-list">
	                        {claimFormsPayload.attached_forms.length === 0 && <p className="muted">No template form files attached yet.</p>}
	                        {claimFormsPayload.attached_forms.map((form) => (
	                          <div className="claim-form-attached-row" key={form.id}>
	                            <span className="claim-form-attached-icon"><FileText size={17} /></span>
	                            <span className="template-card-copy">
	                              <strong>{form.template?.name || form.document?.file_name || 'Claim form'}</strong>
	                              <small>{form.document?.file_name || form.status} · {new Date(form.created_at).toLocaleDateString()}</small>
	                            </span>
	                            <ClaimFormCompactInputStatus form={form} />
	                            <div className="document-request-actions">
	                              <button
	                                className="claim-form-view-button"
	                                type="button"
	                                onClick={() => previewClaimForm(form, claimFormsCase)}
	                                disabled={!form.document?.id || previewingClaimFormId === form.id}
	                                title="View attached form"
	                                aria-label={`View ${form.template?.name || 'attached form'}`}
	                              >
	                                {previewingClaimFormId === form.id ? <LoadingSpinner size="sm" label="Opening form..." /> : 'Claim Form'}
	                              </button>
	                              <button
	                                className="claim-form-view-button danger-lite"
	                                type="button"
	                                onClick={() => setDeleteClaimFormTarget({ form, caseRecord: claimFormsCase })}
	                                disabled={deletingClaimFormId === form.id}
	                                title="Remove attached template"
	                                aria-label={`Remove ${form.template?.name || 'attached template'}`}
	                              >
	                                {deletingClaimFormId === form.id ? <LoadingSpinner size="sm" label="Removing template..." /> : <Trash2 size={14} />}
	                              </button>
	                            </div>
	                          </div>
	                        ))}
	                      </div>
	                    </section>

	                    <section className="claim-form-section">
	                      <div className="panel-header claim-form-section-header">
	                        <div>
	                          <h3>Available templates</h3>
	                          <p>Select one or more templates to attach and fill with this client data.</p>
	                        </div>
	                        <span>{claimFormsPayload.available_templates.length}</span>
	                      </div>
	                      <form className="template-check-list" onSubmit={attachClaimForms}>
	                        {claimFormsPayload.available_templates.length === 0 && <p className="muted">No ready templates available. Upload and set up a template first.</p>}
	                        {claimFormsPayload.available_templates.map((template) => (
	                          <label className={`template-check-row ${selectedTemplateIds.includes(template.id) ? 'selected' : ''}`} key={template.id}>
	                            <input
	                              type="checkbox"
	                              checked={selectedTemplateIds.includes(template.id)}
	                              onChange={() => toggleTemplate(template.id)}
	                            />
	                            <i aria-hidden="true" />
	                            <span className="template-card-copy">
	                              <strong>{template.name}</strong>
	                              <small>{template.field_count} fields · {template.page_count} pages</small>
	                            </span>
	                            <span className="template-card-meta">Ready</span>
	                          </label>
	                        ))}
	                        <div className="modal-actions">
	                          <button className="primary-button" disabled={attachingForms || selectedTemplateIds.length === 0}>
	                            {attachingForms ? <ButtonSpinner label="Attaching..." /> : <FilePlus2 size={17} />}
	                            {!attachingForms && 'Attach and fill'}
	                          </button>
	                        </div>
	                      </form>
	                    </section>

		                  </div>
	                )}
	              </section>
	            </div>
	          )}
	          {deleteClaimFormTarget && (
	            <div className="modal-backdrop" role="presentation">
	              <section className="modal-panel confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-attached-template-title">
	                <div className="modal-header">
	                  <div>
	                    <h3 id="delete-attached-template-title">Remove attached template</h3>
	                    <p>This removes the generated template file from this claim. You can attach it again later if needed.</p>
	                  </div>
	                  <button
	                    className="icon-button ghost"
	                    type="button"
	                    onClick={() => setDeleteClaimFormTarget(null)}
	                    disabled={deletingClaimFormId === deleteClaimFormTarget.form.id}
	                    aria-label="Close remove template confirmation"
	                  >
	                    <X size={18} />
	                  </button>
	                </div>
	                <div className="confirm-dialog-body">
	                  <strong>{deleteClaimFormTarget.form.template?.name || deleteClaimFormTarget.form.document?.file_name || 'Attached template'}</strong>
	                  <span>
	                    {deleteClaimFormTarget.caseRecord.first_name} {deleteClaimFormTarget.caseRecord.surname}
	                    {deleteClaimFormTarget.form.document?.file_name ? ` · ${deleteClaimFormTarget.form.document.file_name}` : ''}
	                  </span>
	                </div>
	                <div className="modal-actions">
	                  <button
	                    className="secondary-button"
	                    type="button"
	                    onClick={() => setDeleteClaimFormTarget(null)}
	                    disabled={deletingClaimFormId === deleteClaimFormTarget.form.id}
	                  >
	                    Cancel
	                  </button>
	                  <button
	                    className="danger-button"
	                    type="button"
	                    onClick={confirmDeleteAttachedClaimForm}
	                    disabled={deletingClaimFormId === deleteClaimFormTarget.form.id}
	                  >
	                    {deletingClaimFormId === deleteClaimFormTarget.form.id ? <ButtonSpinner label="Removing..." /> : <Trash2 size={17} />}
	                    {deletingClaimFormId !== deleteClaimFormTarget.form.id && 'Remove template'}
	                  </button>
	                </div>
	              </section>
	            </div>
	          )}
	          {documentPreview && (
	            <div className="modal-backdrop document-preview-backdrop" role="presentation">
	              <section className="modal-panel document-preview-modal" role="dialog" aria-modal="true" aria-labelledby="document-preview-title">
	                <div className="modal-header document-preview-header">
	                  <div>
	                    <h3 id="document-preview-title">{documentPreview.title}</h3>
	                    <p>{documentPreview.client} · {documentPreview.label}</p>
	                  </div>
	                  <button className="icon-button ghost" type="button" onClick={closeDocumentPreview} aria-label="Close document preview">
	                    <X size={18} />
	                  </button>
	                </div>
	                {documentPreview.url ? (
	                  <div className="document-preview-frame">
	                    <iframe src={documentPreview.url} title={documentPreview.title} />
	                  </div>
	                ) : (
	                  <div className="document-preview-empty">
	                    <FileCheck2 size={34} />
	                    <h4>No uploaded document yet</h4>
	                    <p>{documentPreview.client} still has this {documentPreview.label.toLowerCase()} request marked as {documentPreview.status} with {documentPreview.uploadCount} upload(s).</p>
	                  </div>
	                )}
	              </section>
	            </div>
	          )}
	        </>
	      )}
    </section>
  );
}
