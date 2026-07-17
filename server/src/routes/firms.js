import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { db, serializeDocument, serializeField, serializeTemplate } from '../db/db.js';
import { clientUploadsDir, config, resolveInside } from '../config.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { clientDocumentUpload } from '../middleware/upload.js';
import { generateFilledPdf, validateDataAgainstFields } from '../services/pdfFill.js';
import { processUploadedDocumentWithAi, reviewMissingTemplateFieldsWithAi } from '../services/aiDocumentExtraction.js';
import { coreClientDocumentRequests, getFirmDatabasePath, initializeFirmDatabase, openFirmDatabase, slugifyFirmName } from '../services/firmDatabases.js';
import { sendPowerMail } from '../services/powerMail.js';
import { getTemplateFields } from '../services/templateAccess.js';

export const firmsRouter = express.Router();

const medicalReportTypes = new Map([
  ['raf_1_medical_section', 'RAF 1 medical section'],
  ['raf_4_serious_injury', 'RAF 4 serious-injury assessment'],
  ['supporting_medical_report', 'General supporting medical report'],
  ['specialist_report', 'Additional specialist report']
]);
const firmTeamRoles = new Set(['firm_admin', 'lawyer', 'assistant']);
const teamAccountStatuses = new Set(['pending', 'active', 'suspended']);

function getFirmTeamMembers(firmId, firmDb = null) {
  const members = db.prepare(`
    SELECT
      users.id,
      users.name,
      users.email,
      users.status,
      users.created_at,
      users.updated_at,
      user_firm_access.access_level,
      user_firm_access.firm_role,
      user_firm_access.phone,
      user_firm_access.job_title,
      user_firm_access.can_submit_claims
    FROM user_firm_access
    JOIN users ON users.id = user_firm_access.user_id
    WHERE user_firm_access.firm_id = ?
    ORDER BY
      CASE user_firm_access.firm_role
        WHEN 'firm_admin' THEN 0
        WHEN 'lawyer' THEN 1
        ELSE 2
      END,
      users.name COLLATE NOCASE
  `).all(firmId);

  return members.map((member) => ({
    ...member,
    can_submit_claims: Boolean(member.can_submit_claims),
    assigned_matter_count: firmDb
      ? Number(firmDb.prepare(`
          SELECT COUNT(*) AS count
          FROM matters
          WHERE responsible_lawyer_user_id = ? OR assigned_assistant_user_id = ?
        `).get(member.id, member.id).count || 0)
      : 0
  }));
}

function canManageFirmTeam(req) {
  return req.user?.role === 'admin' || req.firmAccess?.firm_role === 'firm_admin';
}

function getFirmMember(firmId, userId) {
  return db.prepare(`
    SELECT users.*, user_firm_access.firm_role, user_firm_access.access_level,
      user_firm_access.phone, user_firm_access.job_title, user_firm_access.can_submit_claims
    FROM user_firm_access
    JOIN users ON users.id = user_firm_access.user_id
    WHERE user_firm_access.firm_id = ? AND users.id = ?
  `).get(firmId, userId);
}

function addAssignmentNotification({ userId, firmId, caseId, message }) {
  if (!userId) return;
  db.prepare(`
    INSERT INTO firm_user_notifications (user_id, firm_id, case_id, notification_type, message)
    VALUES (?, ?, ?, 'matter_assignment', ?)
  `).run(userId, firmId, caseId, message);
}

function matterStatusFromClaimStatus(status) {
  if (status === 'closed' || status === 'finalised') return 'closed';
  if (['submitted', 'ready_for_submission', 'ready_for_review'].includes(status)) return 'pending';
  return 'open';
}

function parseArrayJson(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

const clientUploadDocumentCondition = `
  NOT (
    LOWER(TRIM(COALESCE(client_document_requests.document_type, ''))) = 'medical_report'
    OR LOWER(TRIM(COALESCE(client_document_requests.label, ''))) = 'medical report'
  )
`;

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

function mergeMissingData(target, values) {
  for (const [key, value] of Object.entries(values || {})) {
    if (!hasManualValue(value)) continue;
    const normalizedKey = normalizeDataKey(key);
    if (!hasManualValue(target[key])) target[key] = value;
    if (!hasManualValue(target[normalizedKey])) target[normalizedKey] = value;
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
    WHERE client_id = ?
      AND ${clientUploadDocumentCondition}
      AND status != 'uploaded'
      AND NOT EXISTS (
        SELECT 1 FROM client_uploads
        WHERE client_uploads.request_id = client_document_requests.id
      )
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
    portal_templates_visible: row.portal_templates_visible !== 0,
    portal_template_inputs_enabled: row.portal_template_inputs_enabled !== 0,
    pending_documents: Number(row.pending_documents || 0),
    reminder_due: Boolean(row.reminder_due),
    invite_url: `${baseUrl.replace(/\/$/, '')}/client-upload/${row.invite_token}`
  };
}

function serializeFirmDoctor(row) {
  return {
    ...row,
    status: row.status || 'active'
  };
}

function getRequestClientOrigin(req) {
  const origin = req?.get?.('origin');
  if (origin && /^https?:\/\//i.test(origin)) return origin;

  const referer = req?.get?.('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      return url.origin;
    } catch {
      // Fall through to host/env-based origin.
    }
  }

  const forwardedHost = req?.get?.('x-forwarded-host');
  const host = forwardedHost || req?.get?.('host');
  if (host) {
    const forwardedProto = req?.get?.('x-forwarded-proto')?.split(',')[0]?.trim();
    const protocol = forwardedProto || req?.protocol || 'http';
    return `${protocol}://${host}`;
  }

  return config.clientOrigin;
}

function getWorkspacePayload(firm, req) {
  const firmDb = openFirmDatabase(firm);
  const clientOrigin = getRequestClientOrigin(req);

  try {
    const clients = firmDb.prepare(`
      SELECT
        firm_clients.*,
        (
          SELECT COUNT(*) FROM raf_cases
          WHERE raf_cases.client_id = firm_clients.id
        ) AS case_count,
        (
          SELECT COUNT(*) FROM client_document_requests
          WHERE client_document_requests.client_id = firm_clients.id
            AND ${clientUploadDocumentCondition}
        ) AS requested_documents,
        (
          SELECT COUNT(*) FROM client_document_requests
          WHERE client_document_requests.client_id = firm_clients.id
            AND ${clientUploadDocumentCondition}
            AND (
              client_document_requests.status = 'uploaded'
              OR EXISTS (
                SELECT 1 FROM client_uploads
                WHERE client_uploads.request_id = client_document_requests.id
              )
            )
        ) AS uploaded_documents,
        (
          SELECT COUNT(*) FROM client_document_requests
          WHERE client_document_requests.client_id = firm_clients.id
            AND ${clientUploadDocumentCondition}
            AND client_document_requests.status != 'uploaded'
            AND NOT EXISTS (
              SELECT 1 FROM client_uploads
              WHERE client_uploads.request_id = client_document_requests.id
            )
        ) AS pending_documents
      FROM firm_clients
      ORDER BY firm_clients.created_at DESC
    `).all().map((client) => {
      const reminderDue = Boolean(
        client.auto_reminders_enabled &&
        Number(client.pending_documents || 0) > 0 &&
        client.next_reminder_at &&
        new Date(client.next_reminder_at) <= new Date()
      );

      return serializeFirmClient({ ...client, reminder_due: reminderDue }, clientOrigin);
    });

    const cases = firmDb.prepare(`
      SELECT
        raf_cases.*,
        matters.matter_reference,
        matters.matter_title,
        matters.status AS matter_status,
        firm_clients.first_name,
        firm_clients.surname,
        COUNT(claim_form_templates.id) AS form_count
      FROM raf_cases
      JOIN firm_clients ON firm_clients.id = raf_cases.client_id
      LEFT JOIN matters ON matters.id = raf_cases.matter_id
      LEFT JOIN claim_form_templates ON claim_form_templates.case_id = raf_cases.id
      GROUP BY raf_cases.id
      ORDER BY raf_cases.opened_at DESC
      LIMIT 25
    `).all();
    const teamMembers = getFirmTeamMembers(firm.id, firmDb);
    const teamById = new Map(teamMembers.map((member) => [Number(member.id), member]));
    const matters = getMatterRows(firmDb).map((matter) => serializeMatter(matter, teamById));
    const enrichedCases = cases.map((caseRecord) => ({
      ...caseRecord,
      linked_matter: caseRecord.matter_id
        ? matters.find((matter) => Number(matter.id) === Number(caseRecord.matter_id)) || null
        : null,
      responsible_lawyer: teamById.get(Number(caseRecord.responsible_lawyer_user_id)) || null,
      assigned_assistant: teamById.get(Number(caseRecord.assigned_assistant_user_id)) || null
    }));

    const documentRequests = firmDb.prepare(`
      SELECT
        client_document_requests.*,
        firm_clients.first_name,
        firm_clients.surname,
        COUNT(client_uploads.id) AS upload_count,
        MAX(client_uploads.id) AS latest_upload_id,
        MAX(client_uploads.original_filename) AS latest_upload_filename,
        MAX(client_uploads.uploaded_at) AS latest_uploaded_at,
        (
          SELECT latest_upload.ai_status FROM client_uploads AS latest_upload
          WHERE latest_upload.request_id = client_document_requests.id
          ORDER BY latest_upload.id DESC LIMIT 1
        ) AS latest_ai_status,
        (
          SELECT latest_upload.ai_summary FROM client_uploads AS latest_upload
          WHERE latest_upload.request_id = client_document_requests.id
          ORDER BY latest_upload.id DESC LIMIT 1
        ) AS latest_ai_summary,
        (
          SELECT latest_upload.ai_error FROM client_uploads AS latest_upload
          WHERE latest_upload.request_id = client_document_requests.id
          ORDER BY latest_upload.id DESC LIMIT 1
        ) AS latest_ai_error,
        (
          SELECT latest_upload.ai_model FROM client_uploads AS latest_upload
          WHERE latest_upload.request_id = client_document_requests.id
          ORDER BY latest_upload.id DESC LIMIT 1
        ) AS latest_ai_model
      FROM client_document_requests
      JOIN firm_clients ON firm_clients.id = client_document_requests.client_id
      LEFT JOIN client_uploads ON client_uploads.request_id = client_document_requests.id
      GROUP BY client_document_requests.id
      ORDER BY
        client_document_requests.case_id DESC,
        CASE client_document_requests.document_type
          WHEN 'claimant_id' THEN 1
          WHEN 'police_accident_report' THEN 2
          WHEN 'client_accident_affidavit' THEN 3
          WHEN 'medical_documents' THEN 4
          WHEN 'medical_expenses' THEN 5
          WHEN 'employment_income' THEN 6
          WHEN 'banking_proof' THEN 7
          WHEN 'photographs' THEN 8
          ELSE 99
        END,
        client_document_requests.id
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
    `).all().map((request) => serializeMedicalAssessmentRequest(request, clientOrigin));

    const doctors = firmDb.prepare(`
      SELECT *
      FROM firm_doctors
      ORDER BY
        CASE status WHEN 'active' THEN 0 ELSE 1 END,
        full_name COLLATE NOCASE
    `).all().map(serializeFirmDoctor);

    const canViewAllMatters = req.user?.role === 'admin' || req.firmAccess?.firm_role === 'firm_admin';
    const visibleMatters = canViewAllMatters
      ? matters
      : matters.filter((matter) => (
          Number(matter.responsible_lawyer_user_id) === Number(req.user?.id)
          || Number(matter.assigned_assistant_user_id) === Number(req.user?.id)
        ));
    const visibleMatterIds = new Set(visibleMatters.map((matter) => Number(matter.id)));
    const visibleCases = canViewAllMatters
      ? enrichedCases
      : enrichedCases.filter((caseRecord) => (
          visibleMatterIds.has(Number(caseRecord.matter_id))
          || Number(caseRecord.responsible_lawyer_user_id) === Number(req.user?.id)
          || Number(caseRecord.assigned_assistant_user_id) === Number(req.user?.id)
        ));
    const visibleCaseIds = new Set(visibleCases.map((caseRecord) => Number(caseRecord.id)));
    const visibleClientIds = new Set(visibleCases.map((caseRecord) => Number(caseRecord.client_id)));
    const visibleClients = canViewAllMatters
      ? clients
      : clients.filter((client) => visibleClientIds.has(Number(client.id)));
    const visibleDocumentRequests = canViewAllMatters
      ? documentRequests
      : documentRequests.filter((request) => visibleCaseIds.has(Number(request.case_id)));
    const visibleMedicalAssessmentRequests = canViewAllMatters
      ? medicalAssessmentRequests
      : medicalAssessmentRequests.filter((request) => visibleCaseIds.has(Number(request.case_id)));
    const claimForms = getClaimFormAttachments(firmDb);
    const visibleClaimForms = canViewAllMatters
      ? claimForms
      : claimForms.filter((form) => visibleCaseIds.has(Number(form.case_id)));

    const stats = {
      clients: firmDb.prepare('SELECT COUNT(*) AS count FROM firm_clients').get().count,
      openCases: firmDb.prepare("SELECT COUNT(*) AS count FROM raf_cases WHERE status != 'closed'").get().count,
      openMatters: firmDb.prepare("SELECT COUNT(*) AS count FROM matters WHERE status != 'closed'").get().count,
      requestedDocuments: firmDb.prepare(`
        SELECT COUNT(*) AS count
        FROM client_document_requests
        WHERE ${clientUploadDocumentCondition}
          AND status != 'uploaded'
          AND NOT EXISTS (
            SELECT 1 FROM client_uploads
            WHERE client_uploads.request_id = client_document_requests.id
          )
      `).get().count,
      uploadedDocuments: firmDb.prepare(`
        SELECT COUNT(*) AS count
        FROM client_document_requests
        WHERE ${clientUploadDocumentCondition}
          AND (
            status = 'uploaded'
            OR EXISTS (
              SELECT 1 FROM client_uploads
              WHERE client_uploads.request_id = client_document_requests.id
            )
          )
      `).get().count,
      doctors: doctors.length,
      activeDoctors: doctors.filter((doctor) => doctor.status === 'active').length,
      autoReminders: clients.filter((client) => client.auto_reminders_enabled && client.pending_documents > 0).length,
      remindersDue: clients.filter((client) => client.reminder_due).length
    };
    if (!canViewAllMatters) {
      stats.clients = visibleClients.length;
      stats.openCases = visibleCases.filter((caseRecord) => caseRecord.status !== 'closed').length;
      stats.openMatters = visibleMatters.filter((matter) => matter.status !== 'closed').length;
      stats.requestedDocuments = visibleDocumentRequests.filter((request) => (
        request.status !== 'uploaded' && Number(request.upload_count || 0) === 0
      )).length;
      stats.uploadedDocuments = visibleDocumentRequests.filter((request) => (
        request.status === 'uploaded' || Number(request.upload_count || 0) > 0
      )).length;
      stats.autoReminders = visibleClients.filter((client) => client.auto_reminders_enabled && client.pending_documents > 0).length;
      stats.remindersDue = visibleClients.filter((client) => client.reminder_due).length;
    }

    return {
      firm: serializeFirm(firm),
      stats,
      clients: visibleClients,
      matters: visibleMatters,
      cases: visibleCases,
      teamMembers,
      documentRequests: visibleDocumentRequests,
      medicalAssessmentRequests: visibleMedicalAssessmentRequests,
      doctors,
      claimForms: visibleClaimForms,
      permissions: {
        can_manage_team: canViewAllMatters,
        can_view_all_matters: canViewAllMatters
      }
    };
  } finally {
    firmDb.close();
  }
}

function createDefaultDocumentRequests(firmDb, clientId, caseId, context = {}) {
  const insert = firmDb.prepare(`
    INSERT INTO client_document_requests (client_id, case_id, document_type, label, instructions)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const [type, label, instructions] of coreClientDocumentRequests) {
    insert.run(clientId, caseId, type, label, instructions);
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

function findMedicalTemplateForReport(reportType) {
  const templates = db.prepare(`
    SELECT document_templates.*, COUNT(template_fields.id) AS field_count
    FROM document_templates
    LEFT JOIN template_fields ON template_fields.template_id = document_templates.id
    WHERE document_templates.status = 'ready'
    GROUP BY document_templates.id
    ORDER BY document_templates.updated_at DESC, document_templates.id DESC
  `).all();

  if (reportType === 'raf_1_medical_section') {
    return templates.find((template) => {
      const name = normalizeDataKey(template.name);
      return name.includes('raf1') || name.includes('rafclaimform1');
    }) || null;
  }

  if (reportType === 'raf_4_serious_injury') {
    return templates.find((template) => {
      const name = normalizeDataKey(template.name);
      return name.includes('raf4') || name.includes('rafclaimform4');
    }) || null;
  }

  return null;
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
    client_portal_visible: row.client_portal_visible !== 0,
    template: template ? serializeTemplate(template) : null,
    document: document ? serializeDocument(document) : null
  };
}

function serializeMedicalAssessmentRequest(row, clientOrigin = config.clientOrigin) {
  if (!row) return null;
  return {
    ...row,
    inherit_client_information: row.inherit_client_information !== 0,
    lock_prefilled_fields: row.lock_prefilled_fields !== 0,
    hide_prefilled_fields: Boolean(row.hide_prefilled_fields),
    secure_url: `${clientOrigin.replace(/\/$/, '')}/medical-assessment/${row.secure_token}`
  };
}

function buildClaimWorkflowSummary(row = {}) {
  const requested = Number(row.requested_documents || 0);
  const uploaded = Number(row.uploaded_documents || 0);
  const missing = Math.max(requested - uploaded, 0);
  const readiness = requested ? Math.round((uploaded / requested) * 100) : 0;
  const medicalStatus = row.medical_assessment_status || (Number(row.medical_assessment_count || 0) > 0 ? 'requested' : 'not_requested');
  return {
    claim_reference: row.case_reference || null,
    claim_status: row.claim_status || 'draft',
    readiness_percentage: readiness,
    missing_documents_count: missing,
    doctor_status: medicalStatus,
    submission_status: row.status === 'submitted' ? 'submitted' : row.status === 'closed' ? 'finalised' : 'not_submitted'
  };
}

function serializeMatter(row, teamById = new Map()) {
  if (!row) return null;
  const linkedClaim = row.linked_raf_case_id
    ? buildClaimWorkflowSummary(row)
    : null;

  return {
    id: row.id,
    client_id: row.client_id,
    matter_reference: row.matter_reference,
    matter_title: row.matter_title,
    matter_type: row.matter_type,
    responsible_lawyer_user_id: row.responsible_lawyer_user_id,
    assigned_assistant_user_id: row.assigned_assistant_user_id,
    status: row.status,
    priority: row.priority,
    opened_at: row.opened_at,
    deadline_json: row.deadline_json,
    deadlines: parseArrayJson(row.deadline_json),
    notes: row.notes || '',
    tasks: parseArrayJson(row.tasks_json),
    documents: parseArrayJson(row.documents_json),
    linked_raf_case_id: row.linked_raf_case_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    first_name: row.first_name,
    surname: row.surname,
    client_name: [row.first_name, row.surname].filter(Boolean).join(' '),
    responsible_lawyer: teamById.get(Number(row.responsible_lawyer_user_id)) || null,
    assigned_assistant: teamById.get(Number(row.assigned_assistant_user_id)) || null,
    linked_raf_claim: linkedClaim
  };
}

function getMatterRows(firmDb) {
  return firmDb.prepare(`
    SELECT
      matters.*,
      firm_clients.first_name,
      firm_clients.surname,
      raf_cases.case_reference,
      raf_cases.status AS claim_status,
      (
        SELECT COUNT(*) FROM client_document_requests
        WHERE client_document_requests.case_id = raf_cases.id
      ) AS requested_documents,
      (
        SELECT COUNT(*) FROM client_document_requests
        WHERE client_document_requests.case_id = raf_cases.id
          AND (
            client_document_requests.status = 'uploaded'
            OR EXISTS (
              SELECT 1 FROM client_uploads
              WHERE client_uploads.request_id = client_document_requests.id
            )
          )
      ) AS uploaded_documents,
      (
        SELECT COUNT(*) FROM medical_assessment_requests
        WHERE medical_assessment_requests.case_id = raf_cases.id
      ) AS medical_assessment_count,
      (
        SELECT medical_assessment_requests.status FROM medical_assessment_requests
        WHERE medical_assessment_requests.case_id = raf_cases.id
        ORDER BY medical_assessment_requests.id DESC LIMIT 1
      ) AS medical_assessment_status
    FROM matters
    JOIN firm_clients ON firm_clients.id = matters.client_id
    LEFT JOIN raf_cases ON raf_cases.id = matters.linked_raf_case_id
    ORDER BY matters.updated_at DESC, matters.opened_at DESC
  `).all();
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
      matters.matter_reference,
      matters.matter_title,
      matters.matter_type,
      matters.status AS matter_status,
      matters.priority AS matter_priority,
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
    LEFT JOIN matters ON matters.id = raf_cases.matter_id
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

  const aiProfile = parseJson(claim.ai_structured_json, { documents: [] });
  const aiDocuments = Array.isArray(aiProfile.documents) ? aiProfile.documents : [];
  for (const aiDocument of aiDocuments) {
    const extraction = aiDocument?.extraction || {};
    const claimant = Array.isArray(extraction.parties)
      ? extraction.parties.find((party) => /claimant|client|patient|injured/i.test(party?.role || '')) || extraction.parties[0] || {}
      : {};
    const accident = extraction.accident || {};
    const medical = extraction.medical || {};
    const employment = extraction.employment || {};
    const extractedBanking = extraction.banking || {};

    mergeMissingData(baseData, {
      first_name: claimant.first_name,
      surname: claimant.surname,
      full_name: claimant.full_name,
      claimant_name: claimant.full_name,
      id_number: claimant.id_number,
      passport_number: claimant.passport_number,
      date_of_birth: claimant.date_of_birth,
      residential_address: claimant.address,
      address: claimant.address,
      accident_date: accident.date,
      date_of_accident: accident.date,
      accident_time: accident.time,
      accident_location: accident.location,
      police_station: accident.police_station,
      police_case_number: accident.police_case_number,
      accident_report_number: accident.accident_report_number,
      claimant_role: accident.claimant_role,
      collision_description: accident.description,
      accident_description: accident.description,
      injuries: Array.isArray(medical.injuries) ? medical.injuries.join(', ') : '',
      diagnosis: Array.isArray(medical.diagnoses) ? medical.diagnoses.join(', ') : '',
      treatment: Array.isArray(medical.treatment) ? medical.treatment.join(', ') : '',
      occupation: employment.occupation,
      employer: employment.employer,
      income_before_accident: employment.income_before_accident,
      income_after_accident: employment.income_after_accident,
      bank_name: extractedBanking.bank_name,
      account_holder: extractedBanking.account_holder,
      account_number: extractedBanking.account_number,
      branch_code: extractedBanking.branch_code,
      branch_name: extractedBanking.branch_name,
      account_type: extractedBanking.account_type,
      ai_case_summary: extraction.summary
    });

    for (const item of Array.isArray(extraction.template_values) ? extraction.template_values : []) {
      mergeMissingData(baseData, { [item.field_name]: item.value });
    }
    for (const item of Array.isArray(extraction.facts) ? extraction.facts : []) {
      mergeMissingData(baseData, { [item.key]: item.value });
    }
  }

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

firmsRouter.use(authenticate);

function requireAdminOnly(req, res, next) {
  return requireAdmin(req, res, next);
}

function getUserFirmAccess(userId, firmId) {
  return db.prepare(`
    SELECT *
    FROM user_firm_access
    WHERE user_id = ? AND firm_id = ?
  `).get(userId, firmId);
}

function requireFirmAccess(options = {}) {
  return (req, res, next) => {
    const firm = getFirmOr404(req.params.id, res);
    if (!firm) return;
    req.firm = firm;

    if (req.user?.role === 'admin') return next();

    const access = getUserFirmAccess(req.user.id, firm.id);
    if (!access) return res.status(403).json({ error: 'Access to this firm workspace is required' });
    if (options.write && (req.user?.role === 'viewer' || access.access_level === 'viewer')) {
      return res.status(403).json({ error: 'Viewer access cannot change firm records' });
    }

    req.firmAccess = access;
    return next();
  };
}

function requireAssignedMatter(options = {}) {
  return (req, res, next) => {
    if (req.user?.role === 'admin' || req.firmAccess?.firm_role === 'firm_admin') return next();

    const firmDb = openFirmDatabase(req.firm);
    try {
      let permitted = null;
      if (options.caseParam) {
        permitted = firmDb.prepare(`
          SELECT raf_cases.id
          FROM raf_cases
          LEFT JOIN matters ON matters.id = raf_cases.matter_id
          WHERE raf_cases.id = ?
            AND (
              matters.responsible_lawyer_user_id = ?
              OR matters.assigned_assistant_user_id = ?
              OR raf_cases.responsible_lawyer_user_id = ?
              OR raf_cases.assigned_assistant_user_id = ?
            )
        `).get(req.params[options.caseParam], req.user.id, req.user.id, req.user.id, req.user.id);
      } else if (options.matterParam) {
        permitted = firmDb.prepare(`
          SELECT id FROM matters
          WHERE id = ? AND (responsible_lawyer_user_id = ? OR assigned_assistant_user_id = ?)
        `).get(req.params[options.matterParam], req.user.id, req.user.id);
      } else if (options.clientParam) {
        permitted = firmDb.prepare(`
          SELECT matters.id
          FROM matters
          WHERE client_id = ? AND (responsible_lawyer_user_id = ? OR assigned_assistant_user_id = ?)
          LIMIT 1
        `).get(req.params[options.clientParam], req.user.id, req.user.id);
      } else if (options.requestParam) {
        permitted = firmDb.prepare(`
          SELECT raf_cases.id
          FROM client_document_requests
          JOIN raf_cases ON raf_cases.id = client_document_requests.case_id
          LEFT JOIN matters ON matters.id = raf_cases.matter_id
          WHERE client_document_requests.id = ?
            AND (
              matters.responsible_lawyer_user_id = ?
              OR matters.assigned_assistant_user_id = ?
              OR raf_cases.responsible_lawyer_user_id = ?
              OR raf_cases.assigned_assistant_user_id = ?
            )
        `).get(req.params[options.requestParam], req.user.id, req.user.id, req.user.id, req.user.id);
      }
      if (!permitted) return res.status(403).json({ error: 'This matter is not assigned to you' });
      return next();
    } finally {
      firmDb.close();
    }
  };
}

firmsRouter.get('/', requireAdminOnly, (_req, res) => {
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

firmsRouter.get('/messages/overview', (req, res) => {
  const firms = req.user?.role === 'admin'
    ? db.prepare('SELECT * FROM firms ORDER BY name COLLATE NOCASE').all()
    : db.prepare(`
        SELECT firms.*
        FROM firms
        JOIN user_firm_access ON user_firm_access.firm_id = firms.id
        WHERE user_firm_access.user_id = ?
        ORDER BY firms.name COLLATE NOCASE
      `).all(req.user.id);

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

firmsRouter.get('/:id/messages', requireFirmAccess(), (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;
  res.json({ firm: serializeFirm(firm), messages: getFirmMessageThread(firm.id) });
});

firmsRouter.post('/:id/messages', requireFirmAccess({ write: true }), (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message is required' });

  const senderType = req.user?.role === 'admin'
    ? req.body?.sender_type === 'firm' ? 'firm' : 'admin'
    : 'firm';
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

firmsRouter.patch('/:id/messages/read', requireFirmAccess(), (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const readerType = req.user?.role === 'admin'
    ? req.body?.reader_type === 'firm' ? 'firm' : 'admin'
    : 'firm';
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

firmsRouter.post('/', requireAdminOnly, (req, res) => {
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

firmsRouter.get('/:id/workspace', requireFirmAccess(), (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;
  res.json(getWorkspacePayload(firm, req));
});

firmsRouter.get('/:id/team', requireFirmAccess(), (req, res) => {
  const firm = req.firm;
  const firmDb = openFirmDatabase(firm);
  try {
    return res.json({
      firm: serializeFirm(firm),
      can_manage_team: canManageFirmTeam(req),
      members: getFirmTeamMembers(firm.id, firmDb)
    });
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/team', requireFirmAccess({ write: true }), async (req, res, next) => {
  const firm = req.firm;
  if (!canManageFirmTeam(req)) return res.status(403).json({ error: 'Firm Admin access is required to add team members' });

  const name = cleanString(req.body?.name);
  const email = cleanString(req.body?.email).toLowerCase();
  const phone = cleanString(req.body?.phone);
  const jobTitle = cleanString(req.body?.job_title);
  const firmRole = cleanString(req.body?.firm_role) || 'assistant';
  const status = cleanString(req.body?.status) || 'active';
  const sendInvitation = Boolean(req.body?.send_invitation);
  const suppliedPassword = String(req.body?.password || '');
  const canSubmitClaims = firmRole === 'assistant' && Boolean(req.body?.can_submit_claims);

  if (!name || !email) return res.status(400).json({ error: 'Full name and email address are required' });
  if (!email.includes('@')) return res.status(400).json({ error: 'Enter a valid email address' });
  if (!firmTeamRoles.has(firmRole)) return res.status(400).json({ error: 'Choose Firm Admin, Lawyer, or Assistant' });
  if (!teamAccountStatuses.has(status)) return res.status(400).json({ error: 'Choose a valid account status' });
  if (!sendInvitation && suppliedPassword.length < 8) return res.status(400).json({ error: 'Temporary password must be at least 8 characters' });

  const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existingUser?.role === 'admin') return res.status(409).json({ error: 'This email belongs to a workspace administrator' });
  if (existingUser) {
    const otherAccess = db.prepare('SELECT firm_id FROM user_firm_access WHERE user_id = ? AND firm_id != ?').get(existingUser.id, firm.id);
    if (otherAccess) return res.status(409).json({ error: 'This user already belongs to another law firm' });
    const sameAccess = db.prepare('SELECT id FROM user_firm_access WHERE user_id = ? AND firm_id = ?').get(existingUser.id, firm.id);
    if (sameAccess) return res.status(409).json({ error: 'This user is already a member of this firm' });
  }

  const temporaryPassword = sendInvitation ? `Raf-${randomUUID().slice(0, 8)}!` : suppliedPassword;
  const passwordHash = bcrypt.hashSync(temporaryPassword, 12);
  const createMember = db.transaction(() => {
    let userId = existingUser?.id;
    if (existingUser) {
      db.prepare(`
        UPDATE users
        SET name = ?, password_hash = ?, role = 'staff', status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name, passwordHash, status, userId);
    } else {
      const result = db.prepare(`
        INSERT INTO users (name, email, password_hash, role, status, approved_by_user_id, approved_at)
        VALUES (?, ?, ?, 'staff', ?, ?, ?)
      `).run(name, email, passwordHash, status, req.user.id, status === 'active' ? new Date().toISOString() : null);
      userId = result.lastInsertRowid;
    }

    db.prepare(`
      INSERT INTO user_firm_access
        (user_id, firm_id, access_level, firm_role, phone, job_title, can_submit_claims)
      VALUES (?, ?, 'staff', ?, ?, ?, ?)
    `).run(userId, firm.id, firmRole, phone || null, jobTitle || null, canSubmitClaims ? 1 : 0);
    return userId;
  });

  const userId = createMember();
  let invitation = { sent: false };
  if (sendInvitation) {
    try {
      const providerResult = await sendPowerMail({
        to: email,
        subject: `${firm.name}: RAFFlow team invitation`,
        body: `Hi ${name},\n\nYou have been added to ${firm.name} on RAFFlow as ${firmRole.replace('_', ' ')}.\n\nLogin: ${config.clientOrigin.replace(/\/$/, '')}/login\nEmail: ${email}\nTemporary password: ${temporaryPassword}\n\nPlease sign in and change this temporary password with your administrator.`,
        data: {
          message_type: 'firm_team_invitation',
          firm_name: firm.name,
          team_member_name: name,
          role: firmRole,
          login_url: `${config.clientOrigin.replace(/\/$/, '')}/login`,
          temporary_password: temporaryPassword
        }
      });
      invitation = { sent: true, provider_result: providerResult };
    } catch (error) {
      invitation = { sent: false, error: error.message };
    }
  }

  const firmDb = openFirmDatabase(firm);
  try {
    return res.status(201).json({
      member: getFirmTeamMembers(firm.id, firmDb).find((member) => Number(member.id) === Number(userId)),
      members: getFirmTeamMembers(firm.id, firmDb),
      invitation,
      temporary_password: sendInvitation && !invitation.sent ? temporaryPassword : undefined
    });
  } catch (error) {
    return next(error);
  } finally {
    firmDb.close();
  }
});

firmsRouter.patch('/:id/team/:userId', requireFirmAccess({ write: true }), (req, res) => {
  const firm = req.firm;
  if (!canManageFirmTeam(req)) return res.status(403).json({ error: 'Firm Admin access is required to edit team members' });

  const member = getFirmMember(firm.id, req.params.userId);
  if (!member) return res.status(404).json({ error: 'Team member not found' });
  const name = cleanString(req.body?.name) || member.name;
  const email = cleanString(req.body?.email).toLowerCase() || member.email;
  const phone = req.body?.phone === undefined ? cleanString(member.phone) : cleanString(req.body.phone);
  const jobTitle = req.body?.job_title === undefined ? cleanString(member.job_title) : cleanString(req.body.job_title);
  const firmRole = cleanString(req.body?.firm_role) || member.firm_role;
  const status = cleanString(req.body?.status) || member.status;
  const newPassword = cleanString(req.body?.password);
  const canSubmitClaims = firmRole === 'assistant' && Boolean(req.body?.can_submit_claims);
  if (!firmTeamRoles.has(firmRole)) return res.status(400).json({ error: 'Choose Firm Admin, Lawyer, or Assistant' });
  if (!teamAccountStatuses.has(status)) return res.status(400).json({ error: 'Choose a valid account status' });
  if (newPassword && newPassword.length < 8) return res.status(400).json({ error: 'Temporary password must be at least 8 characters' });
  const duplicate = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, member.id);
  if (duplicate) return res.status(409).json({ error: 'Email address is already in use' });

  if (member.firm_role === 'firm_admin' && (firmRole !== 'firm_admin' || status !== 'active')) {
    const otherAdmins = db.prepare(`
      SELECT COUNT(*) AS count
      FROM user_firm_access
      JOIN users ON users.id = user_firm_access.user_id
      WHERE user_firm_access.firm_id = ? AND user_firm_access.firm_role = 'firm_admin'
        AND users.status = 'active' AND users.id != ?
    `).get(firm.id, member.id).count;
    if (Number(otherAdmins) < 1) return res.status(400).json({ error: 'At least one active Firm Admin is required' });
  }

  const updateMember = db.transaction(() => {
    if (newPassword) {
      db.prepare(`UPDATE users SET name = ?, email = ?, status = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(name, email, status, bcrypt.hashSync(newPassword, 12), member.id);
    } else {
      db.prepare(`UPDATE users SET name = ?, email = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(name, email, status, member.id);
    }
    db.prepare(`
      UPDATE user_firm_access
      SET firm_role = ?, access_level = 'staff', phone = ?, job_title = ?, can_submit_claims = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND firm_id = ?
    `).run(firmRole, phone || null, jobTitle || null, canSubmitClaims ? 1 : 0, member.id, firm.id);
  });
  updateMember();

  const firmDb = openFirmDatabase(firm);
  try {
    return res.json({
      member: getFirmTeamMembers(firm.id, firmDb).find((row) => Number(row.id) === Number(member.id)),
      members: getFirmTeamMembers(firm.id, firmDb)
    });
  } finally {
    firmDb.close();
  }
});

function getVisibleMattersPayload(firm, req) {
  const firmDb = openFirmDatabase(firm);
  try {
    const teamMembers = getFirmTeamMembers(firm.id, firmDb);
    const teamById = new Map(teamMembers.map((member) => [Number(member.id), member]));
    const canViewAllMatters = req.user?.role === 'admin' || req.firmAccess?.firm_role === 'firm_admin';
    const matters = getMatterRows(firmDb)
      .map((matter) => serializeMatter(matter, teamById))
      .filter((matter) => (
        canViewAllMatters
        || Number(matter.responsible_lawyer_user_id) === Number(req.user?.id)
        || Number(matter.assigned_assistant_user_id) === Number(req.user?.id)
      ));
    const notifications = db.prepare(`
      SELECT * FROM firm_user_notifications
      WHERE user_id = ? AND firm_id = ? AND notification_type = 'matter_assignment'
      ORDER BY created_at DESC, id DESC
      LIMIT 20
    `).all(req.user.id, firm.id);
    db.prepare(`
      UPDATE firm_user_notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
      WHERE user_id = ? AND firm_id = ? AND notification_type = 'matter_assignment'
    `).run(req.user.id, firm.id);

    return {
      firm: serializeFirm(firm),
      current_user_id: req.user?.id,
      matters,
      teamMembers,
      notifications,
      permissions: {
        can_manage_team: canViewAllMatters,
        can_view_all_matters: canViewAllMatters
      }
    };
  } finally {
    firmDb.close();
  }
}

firmsRouter.get('/:id/matters', requireFirmAccess(), (req, res) => {
  return res.json(getVisibleMattersPayload(req.firm, req));
});

firmsRouter.get('/:id/my-matters', requireFirmAccess(), (req, res) => {
  return res.json(getVisibleMattersPayload(req.firm, req));
});

firmsRouter.get('/:id/matters/:matterId', requireFirmAccess(), requireAssignedMatter({ matterParam: 'matterId' }), (req, res) => {
  const firm = req.firm;
  const firmDb = openFirmDatabase(firm);
  try {
    const teamMembers = getFirmTeamMembers(firm.id, firmDb);
    const teamById = new Map(teamMembers.map((member) => [Number(member.id), member]));
    const row = getMatterRows(firmDb).find((matter) => Number(matter.id) === Number(req.params.matterId));
    if (!row) return res.status(404).json({ error: 'Matter not found' });
    const matter = serializeMatter(row, teamById);
    const claim = matter.linked_raf_case_id ? getClaimWithClient(firmDb, matter.linked_raf_case_id) : null;
    return res.json({
      firm: serializeFirm(firm),
      matter,
      linked_claim: claim ? {
        id: claim.id,
        case_reference: claim.case_reference,
        status: claim.status,
        accident_date: claim.accident_date,
        matter_id: claim.matter_id
      } : null,
      activity_history: firmDb.prepare(`
        SELECT * FROM matter_assignment_history
        WHERE matter_id = ? OR case_id = ?
        ORDER BY created_at DESC, id DESC
      `).all(matter.id, matter.linked_raf_case_id || 0)
    });
  } finally {
    firmDb.close();
  }
});

firmsRouter.patch('/:id/matters/:matterId/assignment', requireFirmAccess({ write: true }), (req, res) => {
  const firm = req.firm;
  if (!canManageFirmTeam(req)) return res.status(403).json({ error: 'Firm Admin access is required to assign matters' });

  const lawyerId = Number(req.body?.responsible_lawyer_user_id || 0) || null;
  const assistantId = Number(req.body?.assigned_assistant_user_id || 0) || null;
  const assignmentNote = cleanString(req.body?.assignment_note);
  const reason = cleanString(req.body?.reason);
  if (!lawyerId) return res.status(400).json({ error: 'Choose a responsible lawyer' });

  const lawyer = getFirmMember(firm.id, lawyerId);
  const assistant = assistantId ? getFirmMember(firm.id, assistantId) : null;
  if (!lawyer || lawyer.status !== 'active' || !['lawyer', 'firm_admin'].includes(lawyer.firm_role)) {
    return res.status(400).json({ error: 'Choose an active lawyer from this firm' });
  }
  if (assistantId && (!assistant || assistant.status !== 'active' || assistant.firm_role !== 'assistant')) {
    return res.status(400).json({ error: 'Choose an active assistant from this firm' });
  }

  const firmDb = openFirmDatabase(firm);
  try {
    const matter = firmDb.prepare('SELECT * FROM matters WHERE id = ?').get(req.params.matterId);
    if (!matter) return res.status(404).json({ error: 'Matter not found' });
    const isReassignment = Boolean(matter.responsible_lawyer_user_id || matter.assigned_assistant_user_id);
    const changed = Number(matter.responsible_lawyer_user_id || 0) !== Number(lawyerId || 0)
      || Number(matter.assigned_assistant_user_id || 0) !== Number(assistantId || 0);
    if (!changed) return res.status(400).json({ error: 'Choose a different lawyer or assistant to reassign this matter' });
    if (isReassignment && !reason) return res.status(400).json({ error: 'Add a reason for reassignment' });

    const assignMatter = firmDb.transaction(() => {
      firmDb.prepare(`
        UPDATE matters
        SET responsible_lawyer_user_id = ?, assigned_assistant_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(lawyerId, assistantId, matter.id);
      if (matter.linked_raf_case_id) {
        firmDb.prepare(`
          UPDATE raf_cases
          SET responsible_lawyer_user_id = ?, assigned_assistant_user_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(lawyerId, assistantId, matter.linked_raf_case_id);
      }
      firmDb.prepare(`
        INSERT INTO matter_assignment_history
          (matter_id, case_id, previous_lawyer_user_id, previous_assistant_user_id,
           responsible_lawyer_user_id, assigned_assistant_user_id, assigned_by_user_id,
           assignment_note, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        matter.id,
        matter.linked_raf_case_id || null,
        matter.responsible_lawyer_user_id || null,
        matter.assigned_assistant_user_id || null,
        lawyerId,
        assistantId,
        req.user.id,
        assignmentNote || null,
        reason || null
      );
    });
    assignMatter();

    const action = isReassignment ? 'reassigned' : 'assigned';
    addAssignmentNotification({ userId: lawyerId, firmId: firm.id, caseId: matter.linked_raf_case_id || null, message: `${matter.matter_reference} was ${action} to you as responsible lawyer.` });
    if (assistantId) addAssignmentNotification({ userId: assistantId, firmId: firm.id, caseId: matter.linked_raf_case_id || null, message: `${matter.matter_reference} was ${action} to you as assigned assistant.` });

    return res.json(getVisibleMattersPayload(firm, req));
  } finally {
    firmDb.close();
  }
});

firmsRouter.patch('/:id/claims/:caseId/assignment', requireFirmAccess({ write: true }), (req, res) => {
  const firm = req.firm;
  if (!canManageFirmTeam(req)) return res.status(403).json({ error: 'Firm Admin access is required to assign matters' });
  const lawyerId = Number(req.body?.responsible_lawyer_user_id || 0) || null;
  const assistantId = Number(req.body?.assigned_assistant_user_id || 0) || null;
  const assignmentNote = cleanString(req.body?.assignment_note);
  const reason = cleanString(req.body?.reason);
  if (!lawyerId) return res.status(400).json({ error: 'Choose a responsible lawyer' });

  const lawyer = getFirmMember(firm.id, lawyerId);
  const assistant = assistantId ? getFirmMember(firm.id, assistantId) : null;
  if (!lawyer || lawyer.status !== 'active' || !['lawyer', 'firm_admin'].includes(lawyer.firm_role)) {
    return res.status(400).json({ error: 'Choose an active lawyer from this firm' });
  }
  if (assistantId && (!assistant || assistant.status !== 'active' || assistant.firm_role !== 'assistant')) {
    return res.status(400).json({ error: 'Choose an active assistant from this firm' });
  }

  const firmDb = openFirmDatabase(firm);
  try {
    const claim = firmDb.prepare(`
      SELECT raf_cases.*, matters.id AS linked_matter_id,
        matters.responsible_lawyer_user_id AS matter_lawyer_user_id,
        matters.assigned_assistant_user_id AS matter_assistant_user_id
      FROM raf_cases
      LEFT JOIN matters ON matters.id = raf_cases.matter_id
      WHERE raf_cases.id = ?
    `).get(req.params.caseId);
    if (!claim) return res.status(404).json({ error: 'Matter not found' });
    const currentLawyerId = claim.matter_lawyer_user_id || claim.responsible_lawyer_user_id;
    const currentAssistantId = claim.matter_assistant_user_id || claim.assigned_assistant_user_id;
    const isReassignment = Boolean(currentLawyerId || currentAssistantId);
    const changed = Number(currentLawyerId || 0) !== Number(lawyerId || 0)
      || Number(currentAssistantId || 0) !== Number(assistantId || 0);
    if (!changed) return res.status(400).json({ error: 'Choose a different lawyer or assistant to reassign this matter' });
    if (isReassignment && !reason) return res.status(400).json({ error: 'Add a reason for reassignment' });

    const assignMatter = firmDb.transaction(() => {
      firmDb.prepare(`
        UPDATE matters
        SET responsible_lawyer_user_id = ?, assigned_assistant_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(lawyerId, assistantId, claim.linked_matter_id || claim.matter_id);
      firmDb.prepare(`
        UPDATE raf_cases
        SET responsible_lawyer_user_id = ?, assigned_assistant_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(lawyerId, assistantId, claim.id);
      firmDb.prepare(`
        INSERT INTO matter_assignment_history
          (matter_id, case_id, previous_lawyer_user_id, previous_assistant_user_id,
           responsible_lawyer_user_id, assigned_assistant_user_id, assigned_by_user_id,
           assignment_note, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        claim.linked_matter_id || claim.matter_id || null,
        claim.id,
        currentLawyerId || null,
        currentAssistantId || null,
        lawyerId,
        assistantId,
        req.user.id,
        assignmentNote || null,
        reason || null
      );
    });
    assignMatter();

    const action = isReassignment ? 'reassigned' : 'assigned';
    addAssignmentNotification({ userId: lawyerId, firmId: firm.id, caseId: claim.id, message: `${claim.case_reference} was ${action} to you as responsible lawyer.` });
    if (assistantId) addAssignmentNotification({ userId: assistantId, firmId: firm.id, caseId: claim.id, message: `${claim.case_reference} was ${action} to you as assigned assistant.` });

    return res.json({
      workspace: getWorkspacePayload(firm, req),
      history: firmDb.prepare('SELECT * FROM matter_assignment_history WHERE case_id = ? ORDER BY created_at DESC, id DESC').all(claim.id)
    });
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/doctors', requireFirmAccess({ write: true }), (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const fullName = cleanString(req.body?.full_name);
  const practiceNumber = cleanString(req.body?.practice_number);
  const email = cleanString(req.body?.email);
  const phone = cleanString(req.body?.phone);
  const specialty = cleanString(req.body?.specialty);
  const relationshipNotes = cleanString(req.body?.relationship_notes);

  if (!fullName) return res.status(400).json({ error: 'Doctor name is required' });

  const firmDb = openFirmDatabase(firm);
  try {
    const result = firmDb.prepare(`
      INSERT INTO firm_doctors
        (full_name, practice_number, email, phone, specialty, relationship_notes, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(
      fullName,
      practiceNumber || null,
      email || null,
      phone || null,
      specialty || null,
      relationshipNotes || null
    );

    const doctor = serializeFirmDoctor(firmDb.prepare('SELECT * FROM firm_doctors WHERE id = ?').get(result.lastInsertRowid));
    return res.status(201).json({
      doctor,
      workspace: getWorkspacePayload(firm, req)
    });
  } finally {
    firmDb.close();
  }
});

firmsRouter.patch('/:id/doctors/:doctorId', requireFirmAccess({ write: true }), (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const fullName = cleanString(req.body?.full_name);
  const practiceNumber = cleanString(req.body?.practice_number);
  const email = cleanString(req.body?.email);
  const phone = cleanString(req.body?.phone);
  const specialty = cleanString(req.body?.specialty);
  const relationshipNotes = cleanString(req.body?.relationship_notes);
  const status = cleanString(req.body?.status) || 'active';

  if (!fullName) return res.status(400).json({ error: 'Doctor name is required' });
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Choose active or inactive status' });

  const firmDb = openFirmDatabase(firm);
  try {
    const existing = firmDb.prepare('SELECT * FROM firm_doctors WHERE id = ?').get(req.params.doctorId);
    if (!existing) return res.status(404).json({ error: 'Doctor not found' });

    firmDb.prepare(`
      UPDATE firm_doctors
      SET
        full_name = ?,
        practice_number = ?,
        email = ?,
        phone = ?,
        specialty = ?,
        relationship_notes = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      fullName,
      practiceNumber || null,
      email || null,
      phone || null,
      specialty || null,
      relationshipNotes || null,
      status,
      existing.id
    );

    const doctor = serializeFirmDoctor(firmDb.prepare('SELECT * FROM firm_doctors WHERE id = ?').get(existing.id));
    return res.json({
      doctor,
      workspace: getWorkspacePayload(firm, req)
    });
  } finally {
    firmDb.close();
  }
});

firmsRouter.delete('/:id/doctors/:doctorId', requireFirmAccess({ write: true }), (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const firmDb = openFirmDatabase(firm);
  try {
    const existing = firmDb.prepare('SELECT * FROM firm_doctors WHERE id = ?').get(req.params.doctorId);
    if (!existing) return res.status(404).json({ error: 'Doctor not found' });

    firmDb.prepare('DELETE FROM firm_doctors WHERE id = ?').run(existing.id);
    return res.json({
      deleted: true,
      doctor: serializeFirmDoctor(existing),
      workspace: getWorkspacePayload(firm, req)
    });
  } finally {
    firmDb.close();
  }
});

firmsRouter.get('/:id/templates', requireFirmAccess(), (req, res) => {
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

firmsRouter.get('/:id/documents', requireFirmAccess(), (req, res) => {
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

firmsRouter.get('/:id/claims/:caseId/forms', requireFirmAccess(), requireAssignedMatter({ caseParam: 'caseId' }), (req, res) => {
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

firmsRouter.post('/:id/claims/:caseId/medical-assessments', requireFirmAccess({ write: true }), requireAssignedMatter({ caseParam: 'caseId' }), async (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const reportType = cleanString(req.body?.report_type) || 'supporting_medical_report';
  const doctorName = cleanString(req.body?.doctor_name);
  const practiceNumber = cleanString(req.body?.practice_number);
  const doctorEmail = cleanString(req.body?.doctor_email);
  const doctorPhone = cleanString(req.body?.doctor_phone);
  const deadline = cleanString(req.body?.deadline);
  const deliveryMethod = cleanString(req.body?.delivery_method) || 'link';
  const inheritClientInformation = req.body?.inherit_client_information !== false;
  const lockPrefilledFields = req.body?.lock_prefilled_fields !== false;
  const hidePrefilledFields = Boolean(req.body?.hide_prefilled_fields);
  const refreshInheritedInformation = Boolean(req.body?.refresh_inherited_information);
  const clientOrigin = getRequestClientOrigin(req);

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
        (
          case_id, client_id, report_type, doctor_name, practice_number, doctor_email, doctor_phone,
          deadline, delivery_method, secure_token, status,
          inherit_client_information, lock_prefilled_fields, hide_prefilled_fields
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)
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
      token,
      inheritClientInformation ? 1 : 0,
      lockPrefilledFields ? 1 : 0,
      hidePrefilledFields ? 1 : 0
    );

    let request = serializeMedicalAssessmentRequest(firmDb.prepare('SELECT * FROM medical_assessment_requests WHERE id = ?').get(result.lastInsertRowid), clientOrigin);
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
        request = serializeMedicalAssessmentRequest(firmDb.prepare('SELECT * FROM medical_assessment_requests WHERE id = ?').get(request.id), clientOrigin);
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

firmsRouter.patch('/:id/claims/:caseId/medical-assessments/:requestId', requireFirmAccess({ write: true }), requireAssignedMatter({ caseParam: 'caseId' }), async (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const reportType = cleanString(req.body?.report_type) || 'supporting_medical_report';
  const doctorName = cleanString(req.body?.doctor_name);
  const practiceNumber = cleanString(req.body?.practice_number);
  const doctorEmail = cleanString(req.body?.doctor_email);
  const doctorPhone = cleanString(req.body?.doctor_phone);
  const deadline = cleanString(req.body?.deadline);
  const deliveryMethod = cleanString(req.body?.delivery_method) || 'link';
  const inheritClientInformation = req.body?.inherit_client_information !== false;
  const lockPrefilledFields = req.body?.lock_prefilled_fields !== false;
  const hidePrefilledFields = Boolean(req.body?.hide_prefilled_fields);
  const refreshInheritedInformation = Boolean(req.body?.refresh_inherited_information);
  const clientOrigin = getRequestClientOrigin(req);

  if (!medicalReportTypes.has(reportType)) return res.status(400).json({ error: 'Choose a valid medical report type' });
  if (!doctorName) return res.status(400).json({ error: 'Doctor name is required' });
  if (deliveryMethod !== 'link' && !doctorEmail && !doctorPhone) return res.status(400).json({ error: 'Doctor email or phone is required' });
  if (!['link', 'email', 'sms'].includes(deliveryMethod)) return res.status(400).json({ error: 'Choose link, email, or SMS delivery' });

  const firmDb = openFirmDatabase(firm);
  try {
    const claim = getClaimWithClient(firmDb, req.params.caseId);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const existing = firmDb.prepare(`
      SELECT * FROM medical_assessment_requests
      WHERE id = ? AND case_id = ? AND client_id = ?
    `).get(req.params.requestId, claim.id, claim.client_id);
    if (!existing) return res.status(404).json({ error: 'Medical assessment request not found' });

    firmDb.prepare(`
      UPDATE medical_assessment_requests
      SET
        report_type = ?,
        doctor_name = ?,
        practice_number = ?,
        doctor_email = ?,
        doctor_phone = ?,
        deadline = ?,
        delivery_method = ?,
        inherit_client_information = ?,
        lock_prefilled_fields = ?,
        hide_prefilled_fields = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      reportType,
      doctorName,
      practiceNumber || null,
      doctorEmail || null,
      doctorPhone || null,
      deadline || null,
      deliveryMethod,
      inheritClientInformation ? 1 : 0,
      lockPrefilledFields ? 1 : 0,
      hidePrefilledFields ? 1 : 0,
      existing.id
    );

    if (refreshInheritedInformation && inheritClientInformation) {
      const template = findMedicalTemplateForReport(reportType);
      if (template) {
        const fields = getTemplateFields(template.id).map(serializeField);
        const latestInheritedValues = buildClaimTemplateData({ firm, claim, fields });
        const existingValues = parseJson(existing.assessment_json, {});
        const refreshedValues = { ...existingValues };

        fields.forEach((field) => {
          const nextValue = latestInheritedValues[field.name];
          if (nextValue !== undefined && nextValue !== null && String(nextValue).trim() !== '') {
            refreshedValues[field.name] = nextValue;
          }
        });

        firmDb.prepare(`
          UPDATE medical_assessment_requests
          SET assessment_json = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(JSON.stringify(refreshedValues), existing.id);
      }
    }

    const request = serializeMedicalAssessmentRequest(
      firmDb.prepare('SELECT * FROM medical_assessment_requests WHERE id = ?').get(existing.id),
      clientOrigin
    );

    return res.json({
      request,
      workspace: getWorkspacePayload(firm, req)
    });
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/claims/:caseId/forms', requireFirmAccess({ write: true }), requireAssignedMatter({ caseParam: 'caseId' }), async (req, res, next) => {
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

firmsRouter.post('/:id/claims/:caseId/forms/:attachmentId/ai-suggestions', requireFirmAccess({ write: true }), requireAssignedMatter({ caseParam: 'caseId' }), async (req, res, next) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const firmDb = openFirmDatabase(firm);
  try {
    const claim = getClaimWithClient(firmDb, req.params.caseId);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const attachment = firmDb.prepare('SELECT * FROM claim_form_templates WHERE id = ? AND case_id = ?')
      .get(req.params.attachmentId, claim.id);
    if (!attachment) return res.status(404).json({ error: 'Attached template form not found' });

    const template = db.prepare('SELECT * FROM document_templates WHERE id = ? AND status = ?')
      .get(attachment.template_id, 'ready');
    if (!template) return res.status(404).json({ error: 'Template is not ready or was not found' });

    const pendingUploads = firmDb.prepare(`
      SELECT client_uploads.id
      FROM client_uploads
      JOIN client_document_requests ON client_document_requests.id = client_uploads.request_id
      WHERE client_document_requests.case_id = ?
        AND COALESCE(client_uploads.ai_status, 'pending') != 'completed'
      ORDER BY client_uploads.id
    `).all(claim.id);
    const scannedDocuments = [];
    for (const upload of pendingUploads) {
      const result = await processUploadedDocumentWithAi({ firmDb, uploadId: upload.id });
      scannedDocuments.push({
        upload_id: upload.id,
        status: result.status,
        error: result.error || null
      });
    }

    const refreshedClaim = getClaimWithClient(firmDb, claim.id);
    const fields = getTemplateFields(template.id).map(serializeField);
    const currentData = req.body?.data && typeof req.body.data === 'object' ? req.body.data : {};
    const generatedData = buildClaimTemplateData({ firm, claim: refreshedClaim, fields });
    const mergedData = mergeManualValues(generatedData, currentData);
    const emptyFields = fields.filter((field) => !hasManualValue(currentData[field.name]));
    const mappedSuggestions = emptyFields
      .filter((field) => hasManualValue(mergedData[field.name]))
      .map((field) => ({
        field_name: field.name,
        label: readableFieldLabel(field, fields),
        status: 'fillable',
        value: mergedData[field.name],
        source: 'Claim record or extracted document',
        reason: 'Matched to an existing verified record value.',
        confidence: 1
      }));
    const aiReview = await reviewMissingTemplateFieldsWithAi({
      claim: refreshedClaim,
      firm,
      fields,
      data: mergedData
    });
    const decisionsByField = new Map();
    for (const decision of [...mappedSuggestions, ...aiReview.decisions]) {
      if (!decisionsByField.has(decision.field_name) || decision.status === 'fillable') {
        decisionsByField.set(decision.field_name, decision);
      }
    }
    const decisions = [...decisionsByField.values()];
    const suggestions = decisions.filter((decision) => (
      decision.status === 'fillable' && hasManualValue(decision.value)
    ));

    return res.json({
      model: config.aiExtractionModel,
      scanned_documents: scannedDocuments,
      fields_checked: emptyFields.length,
      suggestions,
      decisions,
      no_evidence_count: decisions.filter((decision) => decision.status === 'no_evidence').length,
      review_required_count: decisions.filter((decision) => ['conflict', 'review_failed'].includes(decision.status)).length,
      error: aiReview.error || null
    });
  } catch (error) {
    return next(error);
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/claims/:caseId/forms/:attachmentId/fill-ai', requireFirmAccess({ write: true }), requireAssignedMatter({ caseParam: 'caseId' }), async (req, res, next) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const firmDb = openFirmDatabase(firm);
  try {
    let claim = getClaimWithClient(firmDb, req.params.caseId);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const attachment = firmDb.prepare('SELECT * FROM claim_form_templates WHERE id = ? AND case_id = ?')
      .get(req.params.attachmentId, claim.id);
    if (!attachment) return res.status(404).json({ error: 'Attached template form not found' });

    const template = db.prepare('SELECT * FROM document_templates WHERE id = ? AND status = ?').get(attachment.template_id, 'ready');
    if (!template) return res.status(404).json({ error: 'Template is not ready or was not found' });

    const pendingUploads = firmDb.prepare(`
      SELECT client_uploads.id
      FROM client_uploads
      JOIN client_document_requests ON client_document_requests.id = client_uploads.request_id
      WHERE client_document_requests.case_id = ?
        AND COALESCE(client_uploads.ai_status, 'pending') != 'completed'
      ORDER BY client_uploads.id
    `).all(claim.id);
    const aiResults = [];
    for (const upload of pendingUploads) {
      aiResults.push(await processUploadedDocumentWithAi({ firmDb, uploadId: upload.id }));
    }

    claim = getClaimWithClient(firmDb, claim.id);
    const fields = getTemplateFields(template.id).map(serializeField);
    const generatedData = buildClaimTemplateData({ firm, claim, fields });
    const dataOverride = mergeManualValues(generatedData, req.body?.data || {});

    const document = await generateFilledPdf({
      template,
      fields,
      data: dataOverride,
      userId: req.user.id,
      sourceType: 'claim_form_ai'
    });

    const filledInputs = Object.values(dataOverride).filter(hasManualValue).length;
    const finalAiProfile = parseJson(claim.ai_structured_json, { documents: [] });
    const aiProfileDocumentCount = Array.isArray(finalAiProfile.documents) ? finalAiProfile.documents.length : 0;

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
      ai_results: aiResults.map((result) => ({
        status: result.status,
        filled_templates: result.filledTemplates || 0,
        error: result.error || null
      })),
      input_status: {
        filled: filledInputs,
        total: fields.length,
        percentage: fields.length ? Math.round((filledInputs / fields.length) * 100) : 0
      },
      ai_profile_document_count: aiProfileDocumentCount,
      workspace: getWorkspacePayload(firm, req)
    });
  } catch (error) {
    return next(error);
  } finally {
    firmDb.close();
  }
});

function getAiAccessibleClaims(firmDb, req) {
  const canProcessAll = req.user?.role === 'admin' || req.firmAccess?.firm_role === 'firm_admin';
  return canProcessAll
    ? firmDb.prepare('SELECT id FROM raf_cases ORDER BY id').all()
    : firmDb.prepare(`
        SELECT raf_cases.id
        FROM raf_cases
        LEFT JOIN matters ON matters.id = raf_cases.matter_id
        WHERE matters.responsible_lawyer_user_id = ?
          OR matters.assigned_assistant_user_id = ?
          OR raf_cases.responsible_lawyer_user_id = ?
          OR raf_cases.assigned_assistant_user_id = ?
        ORDER BY raf_cases.id
      `).all(req.user.id, req.user.id, req.user.id, req.user.id);
}

function scopeAiClaims(claims, requestedCaseId) {
  if (requestedCaseId == null || requestedCaseId === '') return claims;
  const caseId = Number(requestedCaseId);
  if (!Number.isInteger(caseId) || caseId <= 0) {
    const error = new Error('A valid claim is required for this AI scan');
    error.status = 400;
    throw error;
  }
  const claim = claims.find((item) => Number(item.id) === caseId);
  if (!claim) {
    const error = new Error('This matter is not assigned to you');
    error.status = 403;
    throw error;
  }
  return [claim];
}

firmsRouter.get('/:id/claims/refresh-ai/plan', requireFirmAccess(), (req, res, next) => {
  const firm = req.firm;
  const firmDb = openFirmDatabase(firm);

  try {
    const claims = scopeAiClaims(getAiAccessibleClaims(firmDb, req), req.query.case_id);
    const claimIds = claims.map((claim) => Number(claim.id));
    if (!claimIds.length) return res.json({ model: config.aiExtractionModel, documents: [] });
    const placeholders = claimIds.map(() => '?').join(', ');
    const documents = firmDb.prepare(`
      SELECT
        client_uploads.id AS upload_id,
        client_uploads.original_filename,
        COALESCE(client_uploads.ai_status, 'pending') AS ai_status,
        client_uploads.ai_model,
        client_document_requests.label AS document_label,
        raf_cases.id AS case_id,
        raf_cases.case_reference,
        firm_clients.first_name,
        firm_clients.surname
      FROM client_uploads
      JOIN client_document_requests ON client_document_requests.id = client_uploads.request_id
      JOIN raf_cases ON raf_cases.id = client_document_requests.case_id
      JOIN firm_clients ON firm_clients.id = raf_cases.client_id
      WHERE raf_cases.id IN (${placeholders})
      ORDER BY firm_clients.surname COLLATE NOCASE, firm_clients.first_name COLLATE NOCASE,
        raf_cases.id, client_uploads.id
    `).all(...claimIds);

    return res.json({ model: config.aiExtractionModel, documents });
  } catch (error) {
    return next(error);
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/claims/refresh-ai/uploads/:uploadId', requireFirmAccess({ write: true }), async (req, res, next) => {
  const firm = req.firm;
  const firmDb = openFirmDatabase(firm);

  try {
    const permittedCaseIds = new Set(getAiAccessibleClaims(firmDb, req).map((claim) => Number(claim.id)));
    const upload = firmDb.prepare(`
      SELECT
        client_uploads.id AS upload_id,
        client_uploads.original_filename,
        client_document_requests.label AS document_label,
        raf_cases.id AS case_id,
        raf_cases.case_reference,
        firm_clients.first_name,
        firm_clients.surname
      FROM client_uploads
      JOIN client_document_requests ON client_document_requests.id = client_uploads.request_id
      JOIN raf_cases ON raf_cases.id = client_document_requests.case_id
      JOIN firm_clients ON firm_clients.id = raf_cases.client_id
      WHERE client_uploads.id = ?
    `).get(req.params.uploadId);
    if (!upload) return res.status(404).json({ error: 'Uploaded document not found' });
    if (!permittedCaseIds.has(Number(upload.case_id))) {
      return res.status(403).json({ error: 'This matter is not assigned to you' });
    }

    const result = await processUploadedDocumentWithAi({ firmDb, uploadId: upload.upload_id });
    return res.json({
      document: upload,
      status: result.status,
      model: config.aiExtractionModel,
      filled_templates: Number(result.filledTemplates || 0),
      error: result.error || null
    });
  } catch (error) {
    return next(error);
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/claims/refresh-ai', requireFirmAccess({ write: true }), async (req, res, next) => {
  const firm = req.firm;
  const firmDb = openFirmDatabase(firm);

  try {
    const claims = scopeAiClaims(getAiAccessibleClaims(firmDb, req), req.body?.case_id);

    const summary = {
      claims_checked: claims.length,
      uploads_checked: 0,
      uploads_extracted: 0,
      uploads_failed: 0,
      forms_updated: 0,
      forms_failed: 0,
      inputs_added: 0,
      fields_checked: 0,
      fillable_fields: 0,
      field_review_required: 0,
      field_review_failures: 0,
      field_results: []
    };

    for (const caseRecord of claims) {
      const uploads = req.body?.skip_uploads ? [] : firmDb.prepare(`
        SELECT client_uploads.id
        FROM client_uploads
        JOIN client_document_requests ON client_document_requests.id = client_uploads.request_id
        WHERE client_document_requests.case_id = ?
        ORDER BY client_uploads.id
      `).all(caseRecord.id);

      summary.uploads_checked += uploads.length;
      for (const upload of uploads) {
        const result = await processUploadedDocumentWithAi({ firmDb, uploadId: upload.id });
        if (result.status === 'completed') {
          summary.uploads_extracted += 1;
          summary.forms_updated += Number(result.filledTemplates || 0);
        }
        else summary.uploads_failed += 1;
      }

      const claim = getClaimWithClient(firmDb, caseRecord.id);
      if (!claim) continue;
      const attachments = firmDb.prepare('SELECT * FROM claim_form_templates WHERE case_id = ? ORDER BY id')
        .all(claim.id);

      for (const attachment of attachments) {
        try {
          const template = db.prepare('SELECT * FROM document_templates WHERE id = ? AND status = ?')
            .get(attachment.template_id, 'ready');
          if (!template) continue;

          const fields = getTemplateFields(template.id).map(serializeField);
          if (!fields.length) continue;
          const existingDocument = attachment.generated_document_id
            ? db.prepare('SELECT * FROM generated_documents WHERE id = ?').get(attachment.generated_document_id)
            : null;
          const existingData = parseJson(existingDocument?.input_json, {});
          const generatedData = buildClaimTemplateData({ firm, claim, fields });
          const mergedData = mergeManualValues(generatedData, existingData);
          const emptyBefore = fields.filter((field) => !hasManualValue(existingData[field.name]));
          const mappedResults = emptyBefore
            .filter((field) => hasManualValue(mergedData[field.name]))
            .map((field) => ({
              field_name: field.name,
              label: field.label,
              status: 'fillable',
              value: mergedData[field.name],
              source: 'Claim record or extracted document',
              reason: 'Matched to an existing verified record value.',
              confidence: 1
            }));
          const aiReview = await reviewMissingTemplateFieldsWithAi({ claim, firm, fields, data: mergedData });
          const reviewedData = { ...mergedData, ...aiReview.values };
          const inputsAdded = fields.reduce((count, field) => (
            !hasManualValue(existingData[field.name]) && hasManualValue(reviewedData[field.name]) ? count + 1 : count
          ), 0);

          const fieldResults = [...mappedResults, ...aiReview.decisions].map((decision) => ({
            case_id: claim.id,
            case_reference: claim.case_reference,
            client_name: `${claim.first_name} ${claim.surname}`,
            attachment_id: attachment.id,
            template_name: template.name,
            ...decision
          }));
          summary.fields_checked += emptyBefore.length;
          summary.fillable_fields += fieldResults.filter((decision) => decision.status === 'fillable').length;
          summary.field_review_required += fieldResults.filter((decision) => ['conflict', 'review_failed'].includes(decision.status)).length;
          summary.field_results.push(...fieldResults);
          if (aiReview.error) summary.field_review_failures += 1;

          if (!inputsAdded && existingDocument) continue;
          const document = await generateFilledPdf({
            template,
            fields,
            data: reviewedData,
            userId: req.user.id,
            sourceType: 'claim_form_ai_batch'
          });
          firmDb.prepare(`
            UPDATE claim_form_templates
            SET generated_document_id = ?, status = 'generated', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND case_id = ?
          `).run(document.id, attachment.id, claim.id);
          summary.forms_updated += 1;
          summary.inputs_added += inputsAdded;
        } catch {
          summary.forms_failed += 1;
        }
      }
    }

    return res.json({
      ...summary,
      workspace: getWorkspacePayload(firm, req)
    });
  } catch (error) {
    return next(error);
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/claims/:caseId/forms/:attachmentId/fill-manual', requireFirmAccess({ write: true }), requireAssignedMatter({ caseParam: 'caseId' }), async (req, res, next) => {
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

firmsRouter.patch('/:id/claims/:caseId/forms/:attachmentId/share', requireFirmAccess({ write: true }), requireAssignedMatter({ caseParam: 'caseId' }), (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const firmDb = openFirmDatabase(firm);
  try {
    const claim = getClaimWithClient(firmDb, req.params.caseId);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const visible = Boolean(req.body?.client_portal_visible);
    const result = firmDb.prepare(`
      UPDATE claim_form_templates
      SET client_portal_visible = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND case_id = ?
    `).run(visible ? 1 : 0, req.params.attachmentId, claim.id);

    if (result.changes === 0) return res.status(404).json({ error: 'Attached claim form not found' });

    return res.json({
      attached_forms: getClaimFormAttachments(firmDb, claim.id),
      workspace: getWorkspacePayload(firm, req)
    });
  } finally {
    firmDb.close();
  }
});

firmsRouter.delete('/:id/claims/:caseId/forms/:attachmentId', requireFirmAccess({ write: true }), requireAssignedMatter({ caseParam: 'caseId' }), (req, res) => {
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

firmsRouter.post('/:id/clients', requireFirmAccess({ write: true }), (req, res) => {
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
    reminder_time: reminderTimeInput,
    responsible_lawyer_user_id: responsibleLawyerUserIdInput,
    assigned_assistant_user_id: assignedAssistantUserIdInput,
    assignment_note: assignmentNoteInput
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
  const responsibleLawyerUserId = Number(responsibleLawyerUserIdInput || 0) || null;
  const assignedAssistantUserId = Number(assignedAssistantUserIdInput || 0) || null;
  if ((responsibleLawyerUserId || assignedAssistantUserId) && !canManageFirmTeam(req)) {
    return res.status(403).json({ error: 'Firm Admin access is required to assign a new matter' });
  }
  const responsibleLawyer = responsibleLawyerUserId ? getFirmMember(firm.id, responsibleLawyerUserId) : null;
  const assignedAssistant = assignedAssistantUserId ? getFirmMember(firm.id, assignedAssistantUserId) : null;
  if (responsibleLawyerUserId && (!responsibleLawyer || responsibleLawyer.status !== 'active' || !['lawyer', 'firm_admin'].includes(responsibleLawyer.firm_role))) {
    return res.status(400).json({ error: 'Choose an active responsible lawyer from this firm' });
  }
  if (assignedAssistantUserId && (!assignedAssistant || assignedAssistant.status !== 'active' || assignedAssistant.firm_role !== 'assistant')) {
    return res.status(400).json({ error: 'Choose an active assistant from this firm' });
  }
  if (assignedAssistantUserId && !responsibleLawyerUserId) return res.status(400).json({ error: 'Choose a responsible lawyer before assigning an assistant' });

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
      const matterReference = `MAT-${firm.slug.toUpperCase()}-${String(clientId).padStart(4, '0')}`;
      const matterTitle = `${resolvedSurname} v Road Accident Fund`;
      const matterResult = firmDb.prepare(`
        INSERT INTO matters (
          client_id, matter_reference, matter_title, matter_type,
          responsible_lawyer_user_id, assigned_assistant_user_id,
          status, priority, opened_at, deadline_json, notes, tasks_json, documents_json
        )
        VALUES (?, ?, ?, 'RAF matter', ?, ?, 'open', 'normal', CURRENT_TIMESTAMP, ?, '', '[]', '[]')
      `).run(
        clientId,
        matterReference,
        matterTitle,
        responsibleLawyerUserId,
        assignedAssistantUserId,
        JSON.stringify([
          deadlineData.internal_deadline ? { label: 'Internal deadline', date: deadlineData.internal_deadline } : null,
          deadlineData.lodgement_deadline ? { label: 'RAF lodgement deadline', date: deadlineData.lodgement_deadline } : null
        ].filter(Boolean))
      );

      const caseReference = `RAF-${firm.slug.toUpperCase()}-${String(clientId).padStart(4, '0')}`;
      const caseResult = firmDb.prepare(`
        INSERT INTO raf_cases (
          client_id, matter_id, case_reference, accident_date, accident_time, accident_location,
          police_station, police_case_number, claimant_role, collision_description,
          vehicle_json, driver_json, owner_json, witnesses_json, claim_amounts_json,
          statutory_form_set, required_forms_json, lodgement_deadline, internal_deadline,
          deadline_status, lawyer_review_status, original_tracking_json,
          responsible_lawyer_user_id, assigned_assistant_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        clientId,
        matterResult.lastInsertRowid,
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
        }),
        responsibleLawyerUserId,
        assignedAssistantUserId
      );

      firmDb.prepare(`
        UPDATE matters
        SET linked_raf_case_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(caseResult.lastInsertRowid, matterResult.lastInsertRowid);

      if (responsibleLawyerUserId) {
        firmDb.prepare(`
          INSERT INTO matter_assignment_history
            (matter_id, case_id, responsible_lawyer_user_id, assigned_assistant_user_id,
             assigned_by_user_id, assignment_note)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          matterResult.lastInsertRowid,
          caseResult.lastInsertRowid,
          responsibleLawyerUserId,
          assignedAssistantUserId,
          req.user.id,
          cleanString(assignmentNoteInput) || null
        );
      }

      createDefaultDocumentRequests(firmDb, clientId, caseResult.lastInsertRowid, {
        claimAmounts: compactClaimAmounts,
        requiredForms: formSelection.required_forms
      });
      return {
        client: firmDb.prepare('SELECT * FROM firm_clients WHERE id = ?').get(clientId),
        caseId: caseResult.lastInsertRowid,
        caseReference
      };
    });

    const created = createClient();
    if (responsibleLawyerUserId) {
      addAssignmentNotification({
        userId: responsibleLawyerUserId,
        firmId: firm.id,
        caseId: created.caseId,
        message: `${created.caseReference} was assigned to you as responsible lawyer.`
      });
    }
    if (assignedAssistantUserId) {
      addAssignmentNotification({
        userId: assignedAssistantUserId,
        firmId: firm.id,
        caseId: created.caseId,
        message: `${created.caseReference} was assigned to you as assigned assistant.`
      });
    }
    res.status(201).json({
      client: serializeFirmClient(created.client, config.clientOrigin),
      workspace: getWorkspacePayload(firm, req)
    });
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/clients/:clientId/invite', requireFirmAccess({ write: true }), requireAssignedMatter({ clientParam: 'clientId' }), async (req, res, next) => {
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

firmsRouter.patch('/:id/clients/:clientId/portal-settings', requireFirmAccess({ write: true }), requireAssignedMatter({ clientParam: 'clientId' }), (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;

  const firmDb = openFirmDatabase(firm);
  try {
    const client = firmDb.prepare('SELECT * FROM firm_clients WHERE id = ?').get(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const templatesVisible = req.body?.portal_templates_visible === undefined
      ? client.portal_templates_visible !== 0
      : Boolean(req.body.portal_templates_visible);
    const templateInputsEnabled = templatesVisible && (
      req.body?.portal_template_inputs_enabled === undefined
        ? client.portal_template_inputs_enabled !== 0
        : Boolean(req.body.portal_template_inputs_enabled)
    );

    firmDb.prepare(`
      UPDATE firm_clients
      SET
        portal_templates_visible = ?,
        portal_template_inputs_enabled = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      templatesVisible ? 1 : 0,
      templateInputsEnabled ? 1 : 0,
      client.id
    );

    const updatedClient = firmDb.prepare('SELECT * FROM firm_clients WHERE id = ?').get(client.id);
    return res.json({
      client: serializeFirmClient(updatedClient, getRequestClientOrigin(req)),
      workspace: getWorkspacePayload(firm, req)
    });
  } finally {
    firmDb.close();
  }
});

firmsRouter.post('/:id/clients/:clientId/email', requireFirmAccess({ write: true }), requireAssignedMatter({ clientParam: 'clientId' }), async (req, res, next) => {
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

firmsRouter.post('/:id/document-requests/:requestId/upload', requireFirmAccess({ write: true }), requireAssignedMatter({ requestParam: 'requestId' }), clientDocumentUpload.single('document'), async (req, res) => {
  const firm = getFirmOr404(req.params.id, res);
  if (!firm) return;
  if (!req.file) return res.status(400).json({ error: 'Document file is required' });

  const firmDb = openFirmDatabase(firm);
  try {
    const request = firmDb.prepare('SELECT * FROM client_document_requests WHERE id = ?').get(req.params.requestId);
    if (!request) return res.status(404).json({ error: 'Document request not found' });

    const uploadResult = firmDb.prepare(`
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

    await processUploadedDocumentWithAi({ firmDb, uploadId: uploadResult.lastInsertRowid });

    res.status(201).json(getWorkspacePayload(firm, req));
  } finally {
    firmDb.close();
  }
});

firmsRouter.get('/:id/uploads/:uploadId/download', requireFirmAccess(), (req, res) => {
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

firmsRouter.patch('/:id', requireAdminOnly, (req, res) => {
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

firmsRouter.patch('/:id/status', requireAdminOnly, (req, res) => {
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

firmsRouter.delete('/:id', requireAdminOnly, (req, res) => {
  const firm = db.prepare('SELECT * FROM firms WHERE id = ?').get(req.params.id);
  if (!firm) return res.status(404).json({ error: 'Firm not found' });

  db.prepare('DELETE FROM firms WHERE id = ?').run(req.params.id);

  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = `${getFirmDatabasePath(firm.database_filename)}${suffix}`;
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  res.json({ deleted: true, firm: serializeFirm(firm) });
});
