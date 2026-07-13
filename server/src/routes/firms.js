import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { db, serializeDocument, serializeField, serializeTemplate } from '../db/db.js';
import { clientUploadsDir, config, resolveInside } from '../config.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { clientDocumentUpload } from '../middleware/upload.js';
import { generateFilledPdf, validateDataAgainstFields } from '../services/pdfFill.js';
import { getFirmDatabasePath, initializeFirmDatabase, openFirmDatabase, slugifyFirmName } from '../services/firmDatabases.js';
import { sendPowerMail } from '../services/powerMail.js';
import { getTemplateFields } from '../services/templateAccess.js';

export const firmsRouter = express.Router();

const medicalReportTypes = new Map([
  ['raf_1_medical_section', 'RAF 1 medical section'],
  ['raf_4_serious_injury', 'RAF 4 serious-injury assessment'],
  ['supporting_medical_report', 'General supporting medical report'],
  ['specialist_report', 'Additional specialist report']
]);

function serializeFirm(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    contact_name: row.contact_name,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    address: row.address,
    status: row.status,
    billing_rate_per_application: row.billing_rate_per_application,
    database_filename: row.database_filename,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function normalizeReminderTime(value) {
  const reminderTime = String(value || '09:00').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) return null;
  return reminderTime;
}

function getNextReminderAt(reminderTime, from = new Date()) {
  const [hours, minutes] = reminderTime.split(':').map(Number);
  const nextReminder = new Date(from);
  nextReminder.setHours(hours, minutes, 0, 0);
  if (nextReminder <= from) nextReminder.setDate(nextReminder.getDate() + 1);
  return nextReminder.toISOString();
}

function cleanString(value) {
  return String(value || '').trim();
}

function compactObject(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entryValue]) => [key, cleanString(entryValue)])
      .filter(([, entryValue]) => entryValue !== '')
  );
}

function safeJson(value) {
  const compacted = Array.isArray(value)
    ? value.map(compactObject).filter((item) => Object.keys(item).length)
    : compactObject(value);
  if (Array.isArray(compacted) ? compacted.length === 0 : Object.keys(compacted).length === 0) return null;
  return JSON.stringify(compacted);
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mergeData(target, values) {
  for (const [key, value] of Object.entries(values || {})) {
    target[key] = value ?? '';
    target[normalizeDataKey(key)] = value ?? '';
  }
}

function addYearsMinusOneDay(dateText, years) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCFullYear(date.getUTCFullYear() + years);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function subtractMonths(dateText, months) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

function hasPositiveAmount(value) {
  return Number(value || 0) > 0;
}

function getClaimAmountNumber(claimAmounts, key) {
  return Number(claimAmounts?.[key] || 0);
}

function determineRequiredForms(accidentDate, claimAmounts = {}) {
  const cutoff = new Date('2008-08-01T00:00:00Z');
  const accident = accidentDate ? new Date(`${accidentDate}T00:00:00Z`) : null;
  const useLegacyForms = accident && !Number.isNaN(accident.getTime()) && accident < cutoff;
  const hasGeneralDamages = hasPositiveAmount(claimAmounts.general_damages);

  if (useLegacyForms) {
    return {
      statutory_form_set: 'pre_2008',
      required_forms: ['Form 1', 'Form 3'],
      notes: ['Use pre-1 August 2008 prescribed forms. Form 2 applies only to supplier claims.']
    };
  }

  return {
    statutory_form_set: 'current',
    required_forms: ['RAF 1', 'RAF 3', ...(hasGeneralDamages ? ['RAF 4'] : [])],
    notes: [
      hasGeneralDamages
        ? 'RAF 4 is required because general damages are being claimed.'
        : 'RAF 4 may be required if general damages or a serious injury assessment will be pursued.',
      'RAF 2 applies only to supplier claims.'
    ]
  };
}

function buildDeadlineData(accidentDate) {
  const lodgementDeadline = accidentDate ? addYearsMinusOneDay(accidentDate, 3) : null;
  return {
    lodgement_deadline: lodgementDeadline,
    internal_deadline: lodgementDeadline ? subtractMonths(lodgementDeadline, 3) : null,
    deadline_status: accidentDate ? 'attorney_review_required' : 'accident_date_required'
  };
}

function hasPendingDocuments(firmDb, clientId) {
  const row = firmDb.prepare(`
    SELECT COUNT(*) AS count
    FROM client_document_requests
    WHERE client_id = ? AND status != 'uploaded'
  `).get(clientId);
  return Number(row.count || 0) > 0;
}

function nextAvailableSlug(name) {
  const baseSlug = slugifyFirmName(name);
  let slug = baseSlug;
  let suffix = 2;

  while (db.prepare('SELECT id FROM firms WHERE slug = ?').get(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

function getFirmOr404(identifier, res) {
  const firm = db.prepare('SELECT * FROM firms WHERE id = ? OR slug = ?').get(identifier, identifier);
  if (!firm) {
    res.status(404).json({ error: 'Firm not found' });
    return null;
  }
  return firm;
}

function serializeFirmClient(row, baseUrl) {
  return {
    ...row,
    auto_reminders_enabled: Boolean(row.auto_reminders_enabled),
    pending_documents: Number(row.pending_documents || 0),
    reminder_due: Boolean(row.reminder_due),
    invite_url: `${baseUrl.replace(/\/$/, '')}/client-upload/${row.invite_token}`
  };
}

function getWorkspacePayload(firm, req) {
  const firmDb = openFirmDatabase(firm);

  try {
    const clients = firmDb.prepare(`
      SELECT
        firm_clients.*,
        COUNT(DISTINCT raf_cases.id) AS case_count,
        COUNT(DISTINCT client_document_requests.id) AS requested_documents,
        COUNT(DISTINCT client_uploads.id) AS uploaded_documents,
        COUNT(DISTINCT CASE WHEN client_document_requests.status != 'uploaded' THEN client_document_requests.id END) AS pending_documents
      FROM firm_clients
      LEFT JOIN raf_cases ON raf_cases.client_id = firm_clients.id
      LEFT JOIN client_document_requests ON client_document_requests.client_id = firm_clients.id
      LEFT JOIN client_uploads ON client_uploads.client_id = firm_clients.id
      GROUP BY firm_clients.id
      ORDER BY firm_clients.created_at DESC
    `).all().map((client) => {
      const reminderDue = Boolean(
        client.auto_reminders_enabled &&
        Number(client.pending_documents || 0) > 0 &&
        client.next_reminder_at &&
        new Date(client.next_reminder_at) <= new Date()
      );

      return serializeFirmClient({ ...client, reminder_due: reminderDue }, config.clientOrigin);
    });

    const cases = firmDb.prepare(`
      SELECT
        raf_cases.*,
        firm_clients.first_name,
        firm_clients.surname,
        COUNT(claim_form_templates.id) AS form_count
      FROM raf_cases
      JOIN firm_clients ON firm_clients.id = raf_cases.client_id
      LEFT JOIN claim_form_templates ON claim_form_templates.case_id = raf_cases.id
      GROUP BY raf_cases.id
      ORDER BY raf_cases.opened_at DESC
      LIMIT 25
    `).all();

    const documentRequests = firmDb.prepare(`
      SELECT
        client_document_requests.*,
        firm_clients.first_name,
        firm_clients.surname,
        COUNT(client_uploads.id) AS upload_count,
        MAX(client_uploads.id) AS latest_upload_id,
        MAX(client_uploads.original_filename) AS latest_upload_filename,
        MAX(client_uploads.uploaded_at) AS latest_uploaded_at
      FROM client_document_requests
      JOIN firm_clients ON firm_clients.id = client_document_requests.client_id
      LEFT JOIN client_uploads ON client_uploads.request_id = client_document_requests.id
      GROUP BY client_document_requests.id
      ORDER BY client_document_requests.created_at DESC
      LIMIT 50
    `).all();

    const medicalAssessmentRequests = firmDb.prepare(`
      SELECT
        medical_assessment_requests.*,
        firm_clients.first_name,
        firm_clients.surname
      FROM medical_assessment_requests
      JOIN firm_clients ON firm_clients.id = medical_assessment_requests.client_id
      ORDER BY medical_assessment_requests.created_at DESC
      LIMIT 50
    `).all().map(serializeMedicalAssessmentRequest);

    const stats = {
      clients: firmDb.prepare('SELECT COUNT(*) AS count FROM firm_clients').get().count,
      openCases: firmDb.prepare("SELECT COUNT(*) AS count FROM raf_cases WHERE status != 'closed'").get().count,
      requestedDocuments: firmDb.prepare("SELECT COUNT(*) AS count FROM client_document_requests WHERE status = 'requested'").get().count,
      uploadedDocuments: firmDb.prepare('SELECT COUNT(*) AS count FROM client_uploads').get().count,
      autoReminders: clients.filter((client) => client.auto_reminders_enabled && client.pending_documents > 0).length,
      remindersDue: clients.filter((client) => client.reminder_due).length
    };

    return {
      firm: serializeFirm(firm),
      stats,
      clients,
      cases,
      documentRequests,
      medicalAssessmentRequests,
      claimForms: getClaimFormAttachments(firmDb)
    };
  } finally {
    firmDb.close();
  }
}

function createDefaultDocumentRequests(firmDb, clientId, caseId, context = {}) {
  const claimAmounts = context.claimAmounts || {};
  const requiredForms = context.requiredForms || [];
  const requests = [
    ['claimant_id', 'Claimant ID or passport'],
    ['proof_of_address', 'Proof of residential address'],
    ['police_accident_report', 'Police accident report'],
    ['police_case_information', 'Police case information'],
    ['hospital_records', 'Hospital records'],
    ['banking_proof', 'Proof of banking details'],
    ['power_of_attorney', 'Power of attorney'],
    ['consent_forms', 'Consent forms']
  ];

  for (const formName of requiredForms) {
    requests.push([
      formName.toLowerCase().replace(/\s+/g, '_'),
      `${formName} prescribed form`
    ]);
  }

  if (hasPositiveAmount(claimAmounts.medical_expenses) || hasPositiveAmount(claimAmounts.future_medical_expenses)) {
    requests.push(['medical_invoices', 'Medical invoices']);
  }

  if (hasPositiveAmount(claimAmounts.loss_of_earnings)) {
    requests.push(['employment_confirmation', 'Employment confirmation']);
    requests.push(['salary_slips', 'Salary slips']);
  }

  if (hasPositiveAmount(claimAmounts.loss_of_support)) {
    requests.push(['marriage_certificate', 'Marriage certificate']);
    requests.push(['birth_certificates', 'Birth certificates']);
    requests.push(['proof_of_dependency', 'Proof of dependency']);
  }

  if (hasPositiveAmount(claimAmounts.funeral_expenses)) {
    requests.push(['death_certificate', 'Death certificate']);
    requests.push(['funeral_invoices', 'Funeral invoices']);
  }

  if (hasPositiveAmount(claimAmounts.general_damages)) {
    requests.push(['raf4_assessment', 'RAF 4 serious injury assessment']);
    requests.push(['supporting_medical_reports', 'Supporting medical reports']);
  }

  requests.push(['accident_photographs', 'Accident photographs']);
  requests.push(['injury_photographs', 'Injury photographs']);
  requests.push(['witness_statements', 'Witness statements']);

  const insert = firmDb.prepare(`
    INSERT INTO client_document_requests (client_id, case_id, document_type, label)
    VALUES (?, ?, ?, ?)
  `);

  const seen = new Set();
  for (const [type, label] of requests) {
    if (seen.has(type)) continue;
    seen.add(type);
    insert.run(clientId, caseId, type, label);
  }
}

function serializeMessage(row) {
  return {
    ...row,
    read_by_admin: Boolean(row.read_by_admin),
    read_by_firm: Boolean(row.read_by_firm)
  };
}

function getReminderDueCount(firm) {
  const firmDb = openFirmDatabase(firm);
  try {
    const rows = firmDb.prepare(`
      SELECT next_reminder_at
      FROM firm_clients
      WHERE auto_reminders_enabled = 1
        AND next_reminder_at IS NOT NULL
    `).all();
    const now = new Date();
    return rows.filter((row) => new Date(row.next_reminder_at) <= now).length;
  } finally {
    firmDb.close();
  }
}

function getFirmMessageThread(firmId) {
  return db.prepare(`
    SELECT *
    FROM firm_messages
    WHERE firm_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(firmId).map(serializeMessage);
}

function buildClientUploadEmail({ firm, client, subject = null, body = null }) {
  const uploadLink = serializeFirmClient(client, config.clientOrigin).invite_url;
  const clientName = [client.first_name, client.surname].filter(Boolean).join(' ');
  return {
    subject: subject || `RAF document request - ${clientName}`,
    body: body || `Hi ${client.first_name},\n\nPlease use your upload link to send the outstanding RAF documents.\n\nUpload link: ${uploadLink}\n\nRegards\n${firm.name}`,
    data: {
      client_name: clientName,
      first_name: client.first_name,
      surname: client.surname,
      upload_link: uploadLink,
      firm_name: firm.name,
      firm_email: firm.contact_email || '',
      firm_phone: firm.contact_phone || ''
    }
  };
}

function normalizeDataKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isGenericFieldLabel(label) {
  return /^field\s*\d+$/i.test(String(label || '').trim());
}

function readableFieldLabel(field, fields) {
  const label = String(field?.label || '').trim();
  if (!isGenericFieldLabel(label)) return label || field?.name || 'Field';

  const y = Number(field.y || 0);
  const candidates = fields
    .filter((candidate) => (
      candidate.id !== field.id
      && candidate.page_number === field.page_number
      && !isGenericFieldLabel(candidate.label)
      && Number(candidate.y || 0) <= y + 8
    ))
    .sort((a, b) => Number(b.y || 0) - Number(a.y || 0));

  return candidates[0]?.label || label || field?.name || 'Field';
}

function hasManualValue(value) {
  if (Array.isArray(value)) return value.some((item) => String(item ?? '').trim() !== '');
  return value != null && String(value).trim() !== '';
}

function mergeManualValues(generatedData, manualData = {}) {
  const merged = { ...generatedData };
  for (const [key, value] of Object.entries(manualData || {})) {
    if (hasManualValue(value)) merged[key] = value;
  }
  return merged;
}

function getAvailableClaimTemplates() {
  return db.prepare(`
    SELECT document_templates.*, COUNT(template_fields.id) AS field_count
    FROM document_templates
    LEFT JOIN template_fields ON template_fields.template_id = document_templates.id
    WHERE document_templates.status = 'ready'
    GROUP BY document_templates.id
    ORDER BY document_templates.name COLLATE NOCASE
  `).all().map(serializeTemplate);
}

function serializeClaimFormAttachment(row) {
  const template = db.prepare(`
    SELECT document_templates.*, COUNT(template_fields.id) AS field_count
    FROM document_templates
    LEFT JOIN template_fields ON template_fields.template_id = document_templates.id
    WHERE document_templates.id = ?
    GROUP BY document_templates.id
  `).get(row.template_id);
  const document = row.generated_document_id
    ? db.prepare(`
      SELECT generated_documents.*, document_templates.name AS template_name
      FROM generated_documents
      JOIN document_templates ON document_templates.id = generated_documents.template_id
      WHERE generated_documents.id = ?
    `).get(row.generated_document_id)
    : null;

  return {
    ...row,
    template: template ? serializeTemplate(template) : null,
    document: document ? serializeDocument(document) : null
  };
}

function serializeMedicalAssessmentRequest(row) {
  if (!row) return null;
  return {
    ...row,
    secure_url: `${config.clientOrigin.replace(/\/$/, '')}/medical-assessment/${row.secure_token}`
  };
}

function getClaimFormAttachments(firmDb, caseId = null) {
  const rows = caseId
    ? firmDb.prepare('SELECT * FROM claim_form_templates WHERE case_id = ? ORDER BY created_at DESC, id DESC').all(caseId)
    : firmDb.prepare('SELECT * FROM claim_form_templates ORDER BY created_at DESC, id DESC').all();
  return rows.map(serializeClaimFormAttachment);
}

function getClaimWithClient(firmDb, caseId) {
  return firmDb.prepare(`
    SELECT
      raf_cases.*,
      firm_clients.first_name,
      firm_clients.surname,
      firm_clients.id_number,
      firm_clients.passport_number,
      firm_clients.date_of_birth,
      firm_clients.cell,
      firm_clients.email,
      firm_clients.residential_address,
      firm_clients.occupation,
      firm_clients.employer_details,
      firm_clients.banking_json,
      firm_clients.representative_json,
      firm_clients.created_at AS client_created_at
    FROM raf_cases
    JOIN firm_clients ON firm_clients.id = raf_cases.client_id
    WHERE raf_cases.id = ?
  `).get(caseId);
}

function buildClaimTemplateData({ firm, claim, fields }) {
  const fullName = [claim.first_name, claim.surname].filter(Boolean).join(' ');
  const today = new Date().toISOString().slice(0, 10);
  const banking = parseJson(claim.banking_json);
  const representative = parseJson(claim.representative_json);
  const vehicle = parseJson(claim.vehicle_json);
  const driver = parseJson(claim.driver_json);
  const owner = parseJson(claim.owner_json);
  const witnesses = parseJson(claim.witnesses_json, []);
  const claimAmounts = parseJson(claim.claim_amounts_json);
  const requiredForms = parseJson(claim.required_forms_json, []);
  const firstWitness = Array.isArray(witnesses) ? witnesses[0] || {} : {};
  const baseData = {
    first_name: claim.first_name,
    firstname: claim.first_name,
    client_first_name: claim.first_name,
    surname: claim.surname,
    last_name: claim.surname,
    lastname: claim.surname,
    client_surname: claim.surname,
    client_last_name: claim.surname,
    full_name: fullName,
    fullname: fullName,
    client_name: fullName,
    claimant_name: fullName,
    id_number: claim.id_number,
    idnumber: claim.id_number,
    identity_number: claim.id_number,
    client_id_number: claim.id_number,
    passport_number: claim.passport_number,
    date_of_birth: claim.date_of_birth,
    name_and_surname: fullName,
    cell: claim.cell,
    cellphone: claim.cell,
    cell_number: claim.cell,
    mobile: claim.cell,
    phone: claim.cell,
    contact_number: claim.cell,
    email: claim.email,
    email_address: claim.email,
    residential_address: claim.residential_address,
    address: claim.residential_address,
    occupation: claim.occupation,
    employer_details: claim.employer_details,
    employer: claim.employer_details,
    accident_date: claim.accident_date,
    date_of_accident: claim.accident_date,
    accident_time: claim.accident_time,
    time_of_accident: claim.accident_time,
    accident_location: claim.accident_location,
    place_of_accident: claim.accident_location,
    police_station: claim.police_station,
    police_case_number: claim.police_case_number,
    case_number: claim.police_case_number,
    claimant_role: claim.claimant_role,
    role: claim.claimant_role,
    collision_description: claim.collision_description,
    accident_description: claim.collision_description,
    description_of_collision: claim.collision_description,
    assessment_date: today,
    date_of_assessment: today,
    case_reference: claim.case_reference,
    claim_reference: claim.case_reference,
    reference: claim.case_reference,
    claim_number: claim.case_reference,
    claim_number_if_available: claim.case_reference,
    claim_type: claim.claim_type,
    claim_status: claim.status,
    statutory_form_set: claim.statutory_form_set,
    required_forms: Array.isArray(requiredForms) ? requiredForms.join(', ') : '',
    lodgement_deadline: claim.lodgement_deadline,
    internal_deadline: claim.internal_deadline,
    prescription_date: claim.lodgement_deadline,
    lawyer_review_status: claim.lawyer_review_status,
    deadline_status: claim.deadline_status,
    opened_at: claim.opened_at,
    current_date: today,
    today,
    date: today,
    firm_name: firm.name,
    law_firm: firm.name,
    attorney_firm: firm.name,
    firm_email: firm.contact_email,
    firm_phone: firm.contact_phone,
    firm_contact: firm.contact_name,
    firm_address: firm.address
  };

  mergeData(baseData, {
    bank_name: banking.bank_name,
    account_holder: banking.account_holder,
    account_number: banking.account_number,
    branch_code: banking.branch_code,
    account_type: banking.account_type,
    representative_name: representative.name,
    guardian_name: representative.name,
    representative_relationship: representative.relationship,
    guardian_relationship: representative.relationship,
    representative_contact: representative.contact,
    guardian_contact: representative.contact,
    representative_address: representative.address,
    vehicle_registration: vehicle.registration,
    vehicle_make: vehicle.make,
    vehicle_model: vehicle.model,
    vehicle_description: vehicle.description,
    driver_name: driver.name,
    driver_id_number: driver.id_number,
    driver_contact: driver.contact,
    driver_license_number: driver.license_number,
    vehicle_owner_name: owner.name,
    owner_name: owner.name,
    vehicle_owner_contact: owner.contact,
    owner_contact: owner.contact,
    vehicle_owner_address: owner.address,
    owner_address: owner.address,
    witness_name: firstWitness.name,
    witness_contact: firstWitness.contact,
    witness_statement: firstWitness.statement,
    medical_expenses: claimAmounts.medical_expenses,
    loss_of_earnings: claimAmounts.loss_of_earnings,
    loss_of_support: claimAmounts.loss_of_support,
    funeral_expenses: claimAmounts.funeral_expenses,
    general_damages: claimAmounts.general_damages,
    future_medical_expenses: claimAmounts.future_medical_expenses,
    other_compensation: claimAmounts.other_compensation,
    other_allowed_compensation: claimAmounts.other_compensation,
    total_claim_amount: claimAmounts.total
  });

  const normalizedData = Object.entries(baseData).reduce((mapped, [key, value]) => {
    mapped[normalizeDataKey(key)] = value ?? '';
    return mapped;
  }, {});

  const data = {};
  for (const field of fields) {
    const byName = normalizedData[normalizeDataKey(field.name)];
    const byLabel = normalizedData[normalizeDataKey(readableFieldLabel(field, fields))];
    data[field.name] = byName ?? byLabel ?? field.default_value ?? '';
  }

  return data;
}

async function generateClaimFormDocument({ firm, claim, template, userId, sourceType = 'claim_form', dataOverride = null }) {
  const fields = getTemplateFields(template.id).map(serializeField);
  const data = dataOverride || buildClaimTemplateData({ firm, claim, fields });
  const errors = validateDataAgainstFields(fields, data);
  if (errors.length) {
    const error = new Error(`${template.name}: ${errors.join(', ')}`);
    error.status = 400;
    throw error;
  }

  return generateFilledPdf({
    template,
    fields,
    data,
    userId,
    sourceType
  });
}

firmsRouter.use(authenticate, requireAdmin);

firmsRouter.get('/', (_req, res) => {
  const firms = db.prepare(`
    SELECT *
    FROM firms
    ORDER BY created_at DESC
  `).all().map(serializeFirm);

  const summary = {
    total: firms.length,
    active: firms.filter((firm) => firm.status === 'active').length,
    suspended: firms.filter((firm) => firm.status === 'suspended').length
  };

  res.json({ firms, summary });
});

firmsRouter.get('/messages/overview', (_req, res) => {
  const firms = db.prepare('SELECT * FROM firms ORDER BY name COLLATE NOCASE').all();

  const rows = firms.map((firm) => {
    const latestMessage = db.prepare(`
      SELECT *
      FROM firm_messages
      WHERE firm_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(firm.id);
    const unreadAdmin = db.prepare(`
      SELECT COUNT(*) AS count
      FROM firm_messages
      WHERE firm_id = ? AND sender_type = 'firm' AND read_by_admin = 0
    `).get(firm.id).count;
    const unreadFirm = db.prepare(`
      SELECT COUNT(*) AS count
      FROM firm_messages
      WHERE firm_id = ? AND sender_type = 'admin' AND read_by_firm = 0
    `).get(firm.id).count;

    return {
      firm: serializeFirm(firm),
      latest_message: latestMessage ? serializeMessage(latestMessage) : null,
      unread_admin: Number(unreadAdmin || 0),
      unread_firm: Number(unreadFirm || 0),
      reminders_due: getReminderDueCount(firm)
    };
  });

  res.json({
    rows,
    totals: rows.reduce((totals, row) => ({
      unread_admin: totals.unread_admin + row.unread_admin,
      unread_firm: totals.unread_firm + row.unread_firm,
      reminders_due: totals.reminders_due + row.reminders_due
    }), { unread_admin: 0, unread_firm: 0, reminders_due: 0 })
  });
});

firmsRouter.get('/:id/messages', (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;
  res.json({ firm: serializeFirm(firm), messages: getFirmMessageThread(firm.id) });
});

firmsRouter.post('/:id/messages', (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message is required' });

  const senderType = req.body?.sender_type === 'firm' ? 'firm' : 'admin';
  const senderName = senderType === 'firm' ? firm.name : req.user.name || 'Admin';

  db.prepare(`
    INSERT INTO firm_messages (firm_id, sender_type, sender_name, body, read_by_admin, read_by_firm)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    firm.id,
    senderType,
    senderName,
    body,
    senderType === 'admin' ? 1 : 0,
    senderType === 'firm' ? 1 : 0
  );

  res.status(201).json({ firm: serializeFirm(firm), messages: getFirmMessageThread(firm.id) });
});

firmsRouter.patch('/:id/messages/read', (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const readerType = req.body?.reader_type === 'firm' ? 'firm' : 'admin';
  if (readerType === 'firm') {
    db.prepare(`
      UPDATE firm_messages
      SET read_by_firm = 1
      WHERE firm_id = ? AND sender_type = 'admin'
    `).run(firm.id);
  } else {
    db.prepare(`
      UPDATE firm_messages
      SET read_by_admin = 1
      WHERE firm_id = ? AND sender_type = 'firm'
    `).run(firm.id);
  }

  res.json({ firm: serializeFirm(firm), messages: getFirmMessageThread(firm.id) });
});

firmsRouter.post('/', (req, res) => {
  const { name, contact_name: contactName, contact_email: contactEmail, contact_phone: contactPhone, address } = req.body || {};

  if (!name || String(name).trim().length < 2) {
    return res.status(400).json({ error: 'Firm name is required' });
  }

  if (contactEmail && !String(contactEmail).includes('@')) {
    return res.status(400).json({ error: 'Contact email must be valid' });
  }

  const createFirm = db.transaction(() => {
    const slug = nextAvailableSlug(name);
    const databaseFilename = `${slug}.db`;

    const result = db.prepare(`
      INSERT INTO firms
        (name, slug, contact_name, contact_email, contact_phone, address, database_filename, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(name).trim(),
      slug,
      contactName ? String(contactName).trim() : null,
      contactEmail ? String(contactEmail).trim().toLowerCase() : null,
      contactPhone ? String(contactPhone).trim() : null,
      address ? String(address).trim() : null,
      databaseFilename,
      req.user.id
    );

    const firm = db.prepare('SELECT * FROM firms WHERE id = ?').get(result.lastInsertRowid);
    initializeFirmDatabase(firm);
    return firm;
  });

  const firm = createFirm();
  res.status(201).json({ firm: serializeFirm(firm) });
});

firmsRouter.get('/:id/workspace', (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;
  res.json(getWorkspacePayload(firm, req));
});

firmsRouter.get('/:id/templates', (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const firmDb = openFirmDatabase(firm);
  try {
    const templates = firmDb.prepare(`
      SELECT document_templates.*, COUNT(template_fields.id) AS field_count
      FROM document_templates
      LEFT JOIN template_fields ON template_fields.template_id = document_templates.id
      GROUP BY document_templates.id
      ORDER BY document_templates.created_at DESC
    `).all().map(serializeTemplate);

    res.json({ firm: serializeFirm(firm), templates });
  } finally {
    firmDb.close();
  }
});

firmsRouter.get('/:id/documents', (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const firmDb = openFirmDatabase(firm);
  try {
    const documents = firmDb.prepare(`
      SELECT generated_documents.*, document_templates.name AS template_name
      FROM generated_documents
      JOIN document_templates ON document_templates.id = generated_documents.template_id
      ORDER BY generated_documents.created_at DESC
    `).all().map(serializeDocument);

    res.json({ firm: serializeFirm(firm), documents });
  } finally {
    firmDb.close();
  }
});

firmsRouter.get('/:id/claims/:caseId/forms', (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const firmDb = openFirmDatabase(firm);
  try {
    const claim = getClaimWithClient(firmDb, req.params.caseId);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    res.json({
      firm: serializeFirm(firm),
      claim,
      available_templates: getAvailableClaimTemplates(),
      attached_forms: getClaimFormAttachments(firmDb, claim.id)
    });
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/claims/:caseId/medical-assessments', async (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const reportType = cleanString(req.body?.report_type) || 'supporting_medical_report';
  const doctorName = cleanString(req.body?.doctor_name);
  const practiceNumber = cleanString(req.body?.practice_number);
  const doctorEmail = cleanString(req.body?.doctor_email);
  const doctorPhone = cleanString(req.body?.doctor_phone);
  const deadline = cleanString(req.body?.deadline);
  const deliveryMethod = cleanString(req.body?.delivery_method) || 'link';

  if (!medicalReportTypes.has(reportType)) return res.status(400).json({ error: 'Choose a valid medical report type' });
  if (!doctorName) return res.status(400).json({ error: 'Doctor name is required' });
  if (deliveryMethod !== 'link' && !doctorEmail && !doctorPhone) return res.status(400).json({ error: 'Doctor email or phone is required' });
  if (!['link', 'email', 'sms'].includes(deliveryMethod)) return res.status(400).json({ error: 'Choose link, email, or SMS delivery' });

  const firmDb = openFirmDatabase(firm);
  try {
    const claim = getClaimWithClient(firmDb, req.params.caseId);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const token = randomUUID();
    const result = firmDb.prepare(`
      INSERT INTO medical_assessment_requests
        (case_id, client_id, report_type, doctor_name, practice_number, doctor_email, doctor_phone, deadline, delivery_method, secure_token, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested')
    `).run(
      claim.id,
      claim.client_id,
      reportType,
      doctorName,
      practiceNumber || null,
      doctorEmail || null,
      doctorPhone || null,
      deadline || null,
      deliveryMethod,
      token
    );

    let request = serializeMedicalAssessmentRequest(firmDb.prepare('SELECT * FROM medical_assessment_requests WHERE id = ?').get(result.lastInsertRowid));
    let delivery = { sent: false, method: deliveryMethod };

    if (deliveryMethod === 'email' && doctorEmail) {
      try {
        await sendPowerMail({
          to: doctorEmail,
          subject: `${firm.name}: ${medicalReportTypes.get(reportType)} request`,
          body: `Hi ${doctorName},\n\n${firm.name} has requested a ${medicalReportTypes.get(reportType)} for ${claim.first_name} ${claim.surname}.\n\nSecure link: ${request.secure_url}\n\nThis link is limited to this assigned patient assessment.\n\nRegards\n${firm.name}`,
          data: {
            message_type: 'medical_assessment_request',
            firm_name: firm.name,
            doctor_name: doctorName,
            patient_name: `${claim.first_name} ${claim.surname}`,
            report_type: medicalReportTypes.get(reportType),
            secure_link: request.secure_url
          }
        });
        firmDb.prepare(`
          UPDATE medical_assessment_requests
          SET status = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(request.id);
        request = serializeMedicalAssessmentRequest(firmDb.prepare('SELECT * FROM medical_assessment_requests WHERE id = ?').get(request.id));
        delivery = { sent: true, method: deliveryMethod };
      } catch (error) {
        delivery = { sent: false, method: deliveryMethod, error: error.message };
      }
    }

    return res.status(201).json({
      request,
      delivery,
      workspace: getWorkspacePayload(firm, req)
    });
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/claims/:caseId/forms', async (req, res, next) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const templateIds = Array.isArray(req.body?.template_ids)
    ? req.body.template_ids.map(Number).filter(Boolean)
    : [Number(req.body?.template_id)].filter(Boolean);
  const uniqueTemplateIds = [...new Set(templateIds)];
  if (!uniqueTemplateIds.length) {
    return res.status(400).json({ error: 'Choose at least one claim form template' });
  }

  const firmDb = openFirmDatabase(firm);
  try {
    const claim = getClaimWithClient(firmDb, req.params.caseId);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const generatedForms = [];
    for (const templateId of uniqueTemplateIds) {
      const template = db.prepare('SELECT * FROM document_templates WHERE id = ? AND status = ?').get(templateId, 'ready');
      if (!template) return res.status(404).json({ error: `Template ${templateId} is not ready or was not found` });

      const document = await generateClaimFormDocument({
        firm,
        claim,
        template,
        userId: req.user.id,
        sourceType: 'claim_form'
      });

      firmDb.prepare(`
        INSERT INTO claim_form_templates (case_id, template_id, generated_document_id, status)
        VALUES (?, ?, ?, 'generated')
        ON CONFLICT(case_id, template_id) DO UPDATE SET
          generated_document_id = excluded.generated_document_id,
          status = 'generated',
          updated_at = CURRENT_TIMESTAMP
      `).run(claim.id, template.id, document.id);

      generatedForms.push(document);
    }

    return res.status(201).json({
      firm: serializeFirm(firm),
      claim,
      available_templates: getAvailableClaimTemplates(),
      attached_forms: getClaimFormAttachments(firmDb, claim.id),
      generated_forms: generatedForms,
      workspace: getWorkspacePayload(firm, req)
    });
  } catch (error) {
    return next(error);
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/claims/:caseId/forms/:attachmentId/fill-ai', async (req, res, next) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const firmDb = openFirmDatabase(firm);
  try {
    const claim = getClaimWithClient(firmDb, req.params.caseId);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const attachment = firmDb.prepare('SELECT * FROM claim_form_templates WHERE id = ? AND case_id = ?')
      .get(req.params.attachmentId, claim.id);
    if (!attachment) return res.status(404).json({ error: 'Attached template form not found' });

    const template = db.prepare('SELECT * FROM document_templates WHERE id = ? AND status = ?').get(attachment.template_id, 'ready');
    if (!template) return res.status(404).json({ error: 'Template is not ready or was not found' });
    const fields = getTemplateFields(template.id).map(serializeField);
    const generatedData = buildClaimTemplateData({ firm, claim, fields });
    const dataOverride = mergeManualValues(generatedData, req.body?.data || {});

    const document = await generateClaimFormDocument({
      firm,
      claim,
      template,
      userId: req.user.id,
      sourceType: 'claim_form_ai',
      dataOverride
    });

    firmDb.prepare(`
      UPDATE claim_form_templates
      SET generated_document_id = ?, status = 'generated', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND case_id = ?
    `).run(document.id, attachment.id, claim.id);

    return res.json({
      firm: serializeFirm(firm),
      claim,
      attached_forms: getClaimFormAttachments(firmDb, claim.id),
      document,
      workspace: getWorkspacePayload(firm, req)
    });
  } catch (error) {
    return next(error);
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/claims/:caseId/forms/:attachmentId/fill-manual', async (req, res, next) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const firmDb = openFirmDatabase(firm);
  try {
    const claim = getClaimWithClient(firmDb, req.params.caseId);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const attachment = firmDb.prepare('SELECT * FROM claim_form_templates WHERE id = ? AND case_id = ?')
      .get(req.params.attachmentId, claim.id);
    if (!attachment) return res.status(404).json({ error: 'Attached template form not found' });

    const template = db.prepare('SELECT * FROM document_templates WHERE id = ? AND status = ?').get(attachment.template_id, 'ready');
    if (!template) return res.status(404).json({ error: 'Template is not ready or was not found' });

    const document = await generateClaimFormDocument({
      firm,
      claim,
      template,
      userId: req.user.id,
      sourceType: 'claim_form_manual',
      dataOverride: req.body?.data || {}
    });

    firmDb.prepare(`
      UPDATE claim_form_templates
      SET generated_document_id = ?, status = 'generated', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND case_id = ?
    `).run(document.id, attachment.id, claim.id);

    return res.json({
      firm: serializeFirm(firm),
      claim,
      attached_forms: getClaimFormAttachments(firmDb, claim.id),
      document,
      workspace: getWorkspacePayload(firm, req)
    });
  } catch (error) {
    return next(error);
  } finally {
    firmDb.close();
  }
});

firmsRouter.delete('/:id/claims/:caseId/forms/:attachmentId', (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const firmDb = openFirmDatabase(firm);
  try {
    const claim = getClaimWithClient(firmDb, req.params.caseId);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const result = firmDb.prepare('DELETE FROM claim_form_templates WHERE id = ? AND case_id = ?')
      .run(req.params.attachmentId, claim.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Attached claim form not found' });

    return res.json({
      attached_forms: getClaimFormAttachments(firmDb, claim.id),
      workspace: getWorkspacePayload(firm, req)
    });
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/clients', (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const {
    first_name: firstName,
    surname,
    full_names: fullNames,
    id_number: idNumber,
    passport_number: passportNumber,
    date_of_birth: dateOfBirth,
    cell,
    email,
    residential_address: residentialAddress,
    occupation,
    employer_details: employerDetails,
    accident_date: accidentDate,
    accident_time: accidentTime,
    accident_location: accidentLocation,
    police_station: policeStation,
    police_case_number: policeCaseNumber,
    claimant_role: claimantRole,
    collision_description: collisionDescription,
    banking,
    representative,
    vehicle,
    driver,
    owner,
    witnesses,
    claim_amounts: claimAmounts,
    auto_reminders_enabled: autoRemindersEnabled,
    reminder_time: reminderTimeInput
  } = req.body || {};

  const nameParts = cleanString(fullNames).split(/\s+/).filter(Boolean);
  const resolvedFirstName = cleanString(firstName) || nameParts.slice(0, -1).join(' ') || nameParts[0] || '';
  const resolvedSurname = cleanString(surname) || (nameParts.length > 1 ? nameParts.at(-1) : '');
  const resolvedIdNumber = cleanString(idNumber) || cleanString(passportNumber);
  if (!resolvedFirstName || !resolvedSurname || !resolvedIdNumber || !cell || !email) {
    return res.status(400).json({ error: 'First name, surname, ID number, cell, and email are required' });
  }
  if (!String(email).includes('@')) return res.status(400).json({ error: 'Client email must be valid' });

  const remindersEnabled = Boolean(autoRemindersEnabled);
  const reminderTime = normalizeReminderTime(reminderTimeInput);
  if (remindersEnabled && !reminderTime) {
    return res.status(400).json({ error: 'Reminder time must use HH:MM format' });
  }
  const compactClaimAmounts = compactObject(claimAmounts);
  const formSelection = determineRequiredForms(cleanString(accidentDate), compactClaimAmounts);
  const deadlineData = buildDeadlineData(cleanString(accidentDate));

  const firmDb = openFirmDatabase(firm);

  try {
    const createClient = firmDb.transaction(() => {
      const clientResult = firmDb.prepare(`
        INSERT INTO firm_clients
          (
            first_name, surname, id_number, passport_number, date_of_birth, cell, email,
            residential_address, occupation, employer_details, banking_json, representative_json,
            invite_token, invite_sent_at, auto_reminders_enabled, reminder_time, next_reminder_at
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
      `).run(
        resolvedFirstName,
        resolvedSurname,
        resolvedIdNumber,
        cleanString(passportNumber),
        cleanString(dateOfBirth) || null,
        cleanString(cell),
        String(email).trim().toLowerCase(),
        cleanString(residentialAddress),
        cleanString(occupation),
        cleanString(employerDetails),
        safeJson(banking),
        safeJson(representative),
        randomUUID(),
        remindersEnabled ? 1 : 0,
        reminderTime || '09:00',
        remindersEnabled ? getNextReminderAt(reminderTime) : null
      );

      const clientId = clientResult.lastInsertRowid;
      const caseReference = `RAF-${firm.slug.toUpperCase()}-${String(clientId).padStart(4, '0')}`;
      const caseResult = firmDb.prepare(`
        INSERT INTO raf_cases (
          client_id, case_reference, accident_date, accident_time, accident_location,
          police_station, police_case_number, claimant_role, collision_description,
          vehicle_json, driver_json, owner_json, witnesses_json, claim_amounts_json,
          statutory_form_set, required_forms_json, lodgement_deadline, internal_deadline,
          deadline_status, lawyer_review_status, original_tracking_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        clientId,
        caseReference,
        cleanString(accidentDate) || null,
        cleanString(accidentTime),
        cleanString(accidentLocation),
        cleanString(policeStation),
        cleanString(policeCaseNumber),
        cleanString(claimantRole),
        cleanString(collisionDescription),
        safeJson(vehicle),
        safeJson(driver),
        safeJson(owner),
        safeJson(witnesses),
        safeJson(compactClaimAmounts),
        formSelection.statutory_form_set,
        JSON.stringify(formSelection.required_forms),
        deadlineData.lodgement_deadline,
        deadlineData.internal_deadline,
        deadlineData.deadline_status,
        'not_reviewed',
        JSON.stringify({
          digital_copy_uploaded: false,
          original_printed: false,
          original_signed: false,
          original_received_by_firm: false,
          original_sent_to_raf: false,
          delivery_method: '',
          tracking_number: '',
          delivery_receipt: '',
          raf_receipt_confirmation: ''
        })
      );

      createDefaultDocumentRequests(firmDb, clientId, caseResult.lastInsertRowid, {
        claimAmounts: compactClaimAmounts,
        requiredForms: formSelection.required_forms
      });
      return firmDb.prepare('SELECT * FROM firm_clients WHERE id = ?').get(clientId);
    });

    const client = createClient();
    res.status(201).json({
      client: serializeFirmClient(client, config.clientOrigin),
      workspace: getWorkspacePayload(firm, req)
    });
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/clients/:clientId/invite', async (req, res, next) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const firmDb = openFirmDatabase(firm);
  try {
    const client = firmDb.prepare('SELECT * FROM firm_clients WHERE id = ?').get(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const email = buildClientUploadEmail({ firm, client });
    const mailResult = await sendPowerMail({
      to: client.email,
      subject: email.subject,
      body: email.body,
      data: {
        ...email.data,
        message_type: 'document_reminder'
      }
    });

    const nextReminderAt = client.auto_reminders_enabled && hasPendingDocuments(firmDb, client.id)
      ? getNextReminderAt(normalizeReminderTime(client.reminder_time) || '09:00')
      : null;

    const result = firmDb.prepare(`
      UPDATE firm_clients
      SET
        invite_sent_at = CURRENT_TIMESTAMP,
        last_reminder_at = CURRENT_TIMESTAMP,
        next_reminder_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextReminderAt, req.params.clientId);

    if (result.changes === 0) return res.status(404).json({ error: 'Client not found' });
    firmDb.prepare(`
      INSERT INTO client_email_logs (client_id, subject, body, recipient_email)
      VALUES (?, ?, ?, ?)
    `).run(client.id, email.subject, email.body, client.email);
    const updatedClient = firmDb.prepare('SELECT * FROM firm_clients WHERE id = ?').get(req.params.clientId);
    res.json({ client: serializeFirmClient(updatedClient, config.clientOrigin), sent: true, provider: 'powermail', provider_result: mailResult });
  } catch (error) {
    next(error);
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/clients/:clientId/email', async (req, res, next) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const subject = String(req.body?.subject || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!subject || !body) {
    return res.status(400).json({ error: 'Email subject and message are required' });
  }

  const firmDb = openFirmDatabase(firm);
  try {
    const client = firmDb.prepare('SELECT * FROM firm_clients WHERE id = ?').get(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const email = buildClientUploadEmail({ firm, client, subject, body });
    const mailResult = await sendPowerMail({
      to: client.email,
      subject: email.subject,
      body: email.body,
      data: {
        ...email.data,
        message_type: 'client_email'
      }
    });

    firmDb.prepare(`
      INSERT INTO client_email_logs (client_id, subject, body, recipient_email)
      VALUES (?, ?, ?, ?)
    `).run(client.id, email.subject, email.body, client.email);

    res.status(201).json({
      client: serializeFirmClient(client, config.clientOrigin),
      sent: true,
      provider: 'powermail',
      provider_result: mailResult,
      logged: true
    });
  } catch (error) {
    next(error);
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/document-requests/:requestId/upload', clientDocumentUpload.single('document'), (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;
  if (!req.file) return res.status(400).json({ error: 'Document file is required' });

  const firmDb = openFirmDatabase(firm);
  try {
    const request = firmDb.prepare('SELECT * FROM client_document_requests WHERE id = ?').get(req.params.requestId);
    if (!request) return res.status(404).json({ error: 'Document request not found' });

    firmDb.prepare(`
      INSERT INTO client_uploads
        (request_id, client_id, original_filename, stored_filename, mime_type, file_size)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      request.id,
      request.client_id,
      req.file.originalname,
      req.clientUploadStoredFilename || req.file.filename,
      req.file.mimetype,
      req.file.size
    );

    firmDb.prepare(`
      UPDATE client_document_requests
      SET status = 'uploaded', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(request.id);

    if (!hasPendingDocuments(firmDb, request.client_id)) {
      firmDb.prepare(`
        UPDATE firm_clients
        SET next_reminder_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(request.client_id);
    }

    res.status(201).json(getWorkspacePayload(firm, req));
  } finally {
    firmDb.close();
  }
});

firmsRouter.get('/:id/uploads/:uploadId/download', (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const firmDb = openFirmDatabase(firm);
  try {
    const upload = firmDb.prepare('SELECT * FROM client_uploads WHERE id = ?').get(req.params.uploadId);
    if (!upload) return res.status(404).json({ error: 'Upload not found' });

    res.download(resolveInside(clientUploadsDir, upload.stored_filename), upload.original_filename);
  } finally {
    firmDb.close();
  }
});

firmsRouter.patch('/:id', (req, res) => {
  const { name, contact_name: contactName, contact_email: contactEmail, contact_phone: contactPhone, address } = req.body || {};

  if (!name || String(name).trim().length < 2) {
    return res.status(400).json({ error: 'Firm name is required' });
  }

  if (contactEmail && !String(contactEmail).includes('@')) {
    return res.status(400).json({ error: 'Contact email must be valid' });
  }

  const result = db.prepare(`
    UPDATE firms
    SET
      name = ?,
      contact_name = ?,
      contact_email = ?,
      contact_phone = ?,
      address = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    String(name).trim(),
    contactName ? String(contactName).trim() : null,
    contactEmail ? String(contactEmail).trim().toLowerCase() : null,
    contactPhone ? String(contactPhone).trim() : null,
    address ? String(address).trim() : null,
    req.params.id
  );

  if (result.changes === 0) return res.status(404).json({ error: 'Firm not found' });

  const firm = db.prepare('SELECT * FROM firms WHERE id = ?').get(req.params.id);
  initializeFirmDatabase(firm);
  res.json({ firm: serializeFirm(firm) });
});

firmsRouter.patch('/:id/status', (req, res) => {
  const { status } = req.body || {};
  const normalizedStatus = String(status || '').trim().toLowerCase();

  if (!['active', 'suspended'].includes(normalizedStatus)) {
    return res.status(400).json({ error: 'Status must be active or suspended' });
  }

  const result = db.prepare(`
    UPDATE firms
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(normalizedStatus, req.params.id);

  if (result.changes === 0) return res.status(404).json({ error: 'Firm not found' });

  const firm = db.prepare('SELECT * FROM firms WHERE id = ?').get(req.params.id);
  res.json({ firm: serializeFirm(firm) });
});

firmsRouter.delete('/:id', (req, res) => {
  const firm = db.prepare('SELECT * FROM firms WHERE id = ?').get(req.params.id);
  if (!firm) return res.status(404).json({ error: 'Firm not found' });

  db.prepare('DELETE FROM firms WHERE id = ?').run(req.params.id);

  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = `${getFirmDatabasePath(firm.database_filename)}${suffix}`;
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  res.json({ deleted: true, firm: serializeFirm(firm) });
});
