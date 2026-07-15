import express from 'express';
import fs from 'node:fs';
import { db, serializeField, serializeTemplate } from '../db/db.js';
import { originalsDir, resolveInside } from '../config.js';
import { openFirmDatabase } from '../services/firmDatabases.js';
import { getTemplateFields } from '../services/templateAccess.js';

export const medicalAssessmentsRouter = express.Router();

const medicalReportTypes = new Map([
  ['raf_1_medical_section', 'RAF 1 medical section'],
  ['raf_4_serious_injury', 'RAF 4 serious-injury assessment'],
  ['supporting_medical_report', 'General supporting medical report'],
  ['specialist_report', 'Additional specialist report']
]);

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

function isEnabled(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === '1';
}

function cleanAssessmentValues(values = {}) {
  const allowedFields = [
    'examination_date',
    'injuries',
    'clinical_findings',
    'diagnosis',
    'treatment',
    'impairment',
    'recommendations',
    'notes'
  ];
  return Object.fromEntries(
    allowedFields.map((field) => [field, String(values[field] || '').trim()])
  );
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function findTemplateForReport(reportType) {
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
      const name = normalizeKey(template.name);
      return name.includes('raf_1') || name === 'raf1' || name.includes('rafclaimform_1');
    }) || null;
  }

  if (reportType === 'raf_4_serious_injury') {
    return templates.find((template) => {
      const name = normalizeKey(template.name);
      return name.includes('raf_4') || name === 'raf4' || name.includes('rafclaimform_4');
    }) || null;
  }

  return null;
}

function buildTemplateFallbackValues(fields, firm, row) {
  const patientName = [row.first_name, row.surname].filter(Boolean).join(' ');
  const representative = parseJson(row.representative_json, {});
  const banking = parseJson(row.banking_json, {});
  const vehicle = parseJson(row.vehicle_json, {});
  const driver = parseJson(row.driver_json, {});
  const owner = parseJson(row.owner_json, {});

  const fallbackByKey = {
    name_and_surname: patientName,
    title_name_and_surname: patientName,
    name: patientName,
    claimant_name: patientName,
    patient: patientName,
    date_of_birth: row.date_of_birth || '',
    title_date_of_birth: row.date_of_birth || '',
    irth_date: row.date_of_birth || '',
    id_number: row.id_number || '',
    id_number_passport: firstValue(row.id_number, row.passport_number),
    id_or_passport: firstValue(row.id_number, row.passport_number),
    passport_number: row.passport_number || '',
    passport_number_certificate_or_passport: row.passport_number || '',
    contact_number: row.cell || '',
    cellular_number: row.cell || '',
    driver_cell_phone_number: firstValue(driver.cell, driver.phone, driver.contact_number),
    vehicle_owner_cell_number: firstValue(owner.cell, owner.phone, owner.contact_number),
    cell: row.cell || '',
    tel_cell: row.cell || '',
    home_telephone_number: row.cell || '',
    work_telephone_number: row.cell || '',
    telephone_number: firstValue(row.doctor_phone, row.cell),
    e_mail_address: firstValue(row.doctor_email, row.client_email),
    email: row.client_email || '',
    claim_number: row.case_reference || '',
    claim_number_if_available: row.case_reference || '',
    case_reference: row.case_reference || '',
    date_of_accident: row.accident_date || '',
    accident_date: row.accident_date || '',
    injury_date: row.accident_date || '',
    accident_location: row.accident_location || '',
    place_of_accident: row.accident_location || '',
    collision_description: row.collision_description || '',
    describe_the_accident: row.collision_description || '',
    describe_the_nature_of_the_motor_vehicle: row.collision_description || '',
    residential_address_complex: row.residential_address || '',
    postal_address_complex: row.residential_address || '',
    occupation: row.occupation || '',
    employer_details: row.employer_details || '',
    name_and_address_of_police_station: row.police_station || '',
    police_station: row.police_station || '',
    police_case_number: row.police_case_number || '',
    vehicle_registration_number: vehicle.registration_number || '',
    vehicle_registration_number_all_vehicles: vehicle.registration_number || '',
    driver_name_surname: [driver.first_name, driver.surname].filter(Boolean).join(' ') || driver.name || '',
    driver_physical_address_complex: driver.address || driver.physical_address || '',
    drivers_licence_number: driver.licence_number || driver.license_number || '',
    vehicle_owner_name_surname: [owner.first_name, owner.surname].filter(Boolean).join(' ') || owner.name || '',
    vehicle_owner_telephone_number: firstValue(owner.telephone, owner.phone, owner.contact_number),
    vehicle_owner_physical_address_complex: owner.address || owner.physical_address || '',
    representative_name_surname: [representative.first_name, representative.surname].filter(Boolean).join(' ') || representative.name || '',
    name_of_firm: firm.name || '',
    bank_name: banking.bank_name || banking.bank || '',
    branch_number: banking.branch_number || banking.branch_code || '',
    account_number: banking.account_number || '',
    name_of_account_holder: banking.account_holder || banking.account_holder_name || '',
    doctor_name: row.doctor_name || '',
    name_surname: row.doctor_name || '',
    name_print: row.doctor_name || '',
    evaluator_printed_name: row.doctor_name || '',
    practice_number: row.practice_number || '',
    practice_number_hpcsa_and_or_bhf: row.practice_number || ''
  };

  return fields.reduce((values, field) => {
    const byName = fallbackByKey[normalizeKey(field.name)];
    const byLabel = fallbackByKey[normalizeKey(field.label)];
    const value = byName ?? byLabel;
    if (value !== undefined && value !== null && value !== '') values[field.name] = value;
    return values;
  }, {});
}

function mergeValuesWithFallback(fallbackValues, savedValues) {
  return Object.entries({ ...fallbackValues, ...savedValues }).reduce((values, [key, value]) => {
    const savedValue = savedValues[key];
    const fallbackValue = fallbackValues[key];
    values[key] = savedValue === undefined || savedValue === null || String(savedValue).trim() === ''
      ? fallbackValue ?? ''
      : savedValue;
    return values;
  }, {});
}

function cleanTemplateValues(values = {}, fields = []) {
  const allowedKeys = new Set();
  fields.forEach((field) => {
    allowedKeys.add(field.name);
    allowedKeys.add(`${field.name}__field_${field.id}`);
  });

  return Object.fromEntries(
    Object.entries(values)
      .filter(([key]) => allowedKeys.has(key))
      .map(([key, value]) => [key, typeof value === 'boolean' ? value : String(value ?? '').trim()])
  );
}

function getAssessmentByToken(tokenValue) {
  const token = String(tokenValue || '').trim();
  const firms = db.prepare("SELECT * FROM firms WHERE status = 'active' ORDER BY id").all();
  for (const firm of firms) {
    const firmDb = openFirmDatabase(firm);
    let keepOpen = false;
    try {
      const row = firmDb.prepare(`
        SELECT
          medical_assessment_requests.*,
          firm_clients.first_name,
          firm_clients.surname,
          firm_clients.id_number,
          firm_clients.email AS client_email,
          firm_clients.passport_number,
          firm_clients.date_of_birth,
          firm_clients.cell,
          firm_clients.residential_address,
          firm_clients.occupation,
          firm_clients.employer_details,
          firm_clients.banking_json,
          firm_clients.representative_json,
          raf_cases.case_reference,
          raf_cases.accident_date,
          raf_cases.accident_time,
          raf_cases.accident_location,
          raf_cases.police_station,
          raf_cases.police_case_number,
          raf_cases.collision_description,
          raf_cases.vehicle_json,
          raf_cases.driver_json,
          raf_cases.owner_json
        FROM medical_assessment_requests
        JOIN firm_clients ON firm_clients.id = medical_assessment_requests.client_id
        JOIN raf_cases ON raf_cases.id = medical_assessment_requests.case_id
        WHERE medical_assessment_requests.secure_token = ?
      `).get(token);

      if (row) {
        keepOpen = true;
        return { firm, firmDb, row };
      }
    } finally {
      if (!keepOpen) firmDb.close();
    }
  }

  return null;
}

function serializeAssessmentPayload(firm, row) {
  const template = findTemplateForReport(row.report_type);
  const fields = template ? getTemplateFields(template.id).map(serializeField) : [];
  const savedValues = parseJson(row.assessment_json, {});
  const inheritClientInformation = isEnabled(row.inherit_client_information, true);
  const lockPrefilledFields = isEnabled(row.lock_prefilled_fields, true);
  const hidePrefilledFields = isEnabled(row.hide_prefilled_fields, false);
  const fallbackValues = template && inheritClientInformation ? buildTemplateFallbackValues(fields, firm, row) : {};
  const inheritedKeys = new Set(Object.keys(fallbackValues).filter((key) => String(fallbackValues[key] || '').trim() !== ''));
  const templateFields = fields.map((field) => {
    const inherited = inheritedKeys.has(field.name) || inheritedKeys.has(`${field.name}__field_${field.id}`);
    return {
      ...field,
      inherited_value: inherited,
      locked: inherited && lockPrefilledFields,
      hidden: inherited && hidePrefilledFields
    };
  });

  return {
    firm: { name: firm.name, contact_email: firm.contact_email, contact_phone: firm.contact_phone },
    assessment: {
      report_type: row.report_type,
      report_label: medicalReportTypes.get(row.report_type) || 'Medical assessment',
      doctor_name: row.doctor_name,
      practice_number: row.practice_number,
      deadline: row.deadline,
      status: row.status,
      created_at: row.created_at,
      submitted_at: row.submitted_at,
      inherit_client_information: inheritClientInformation,
      lock_prefilled_fields: lockPrefilledFields,
      hide_prefilled_fields: hidePrefilledFields,
      values: mergeValuesWithFallback(fallbackValues, savedValues)
    },
    template: template ? {
      ...serializeTemplate(template),
      fields: templateFields
    } : null,
    patient: {
      first_name: row.first_name,
      surname: row.surname,
      date_of_birth: row.date_of_birth,
      id_number: row.id_number,
      cell: row.cell
    },
    claim: {
      case_reference: row.case_reference,
      accident_date: row.accident_date,
      accident_time: row.accident_time,
      accident_location: row.accident_location,
      collision_description: row.collision_description
    }
  };
}

medicalAssessmentsRouter.get('/:token', (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(404).json({ error: 'Assessment link not found' });

  const match = getAssessmentByToken(token);
  if (!match) return res.status(404).json({ error: 'Assessment link not found' });

  const { firm, firmDb, row } = match;
  try {
    return res.json(serializeAssessmentPayload(firm, row));
  } finally {
    firmDb.close();
  }
});

medicalAssessmentsRouter.get('/:token/template/pdf', (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(404).json({ error: 'Assessment link not found' });

  const match = getAssessmentByToken(token);
  if (!match) return res.status(404).json({ error: 'Assessment link not found' });

  const { firmDb, row } = match;
  try {
    const template = findTemplateForReport(row.report_type);
    if (!template) return res.status(404).json({ error: 'Assessment template not found' });

    const filePath = resolveInside(originalsDir, template.stored_filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'PDF is missing from storage' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${template.original_filename}"`);
    return fs.createReadStream(filePath).pipe(res);
  } finally {
    firmDb.close();
  }
});

medicalAssessmentsRouter.patch('/:token', (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(404).json({ error: 'Assessment link not found' });

  const match = getAssessmentByToken(token);
  if (!match) return res.status(404).json({ error: 'Assessment link not found' });

  const { firm, firmDb, row } = match;
  try {
    const template = findTemplateForReport(row.report_type);
    const fields = template ? getTemplateFields(template.id).map(serializeField) : [];
    const fallbackValues = template && isEnabled(row.inherit_client_information, true)
      ? buildTemplateFallbackValues(fields, firm, row)
      : {};
    const values = template
      ? cleanTemplateValues(req.body?.values || {}, fields)
      : cleanAssessmentValues(req.body?.values || {});
    if (template && (isEnabled(row.lock_prefilled_fields, true) || isEnabled(row.hide_prefilled_fields, false))) {
      Object.entries(fallbackValues).forEach(([key, value]) => {
        if (String(value || '').trim() !== '') values[key] = value;
      });
    }
    const submit = Boolean(req.body?.submit);
    firmDb.prepare(`
      UPDATE medical_assessment_requests
      SET assessment_json = ?,
          status = ?,
          submitted_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE submitted_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(values), submit ? 'submitted' : row.status, submit ? 1 : 0, row.id);

    const updated = firmDb.prepare(`
      SELECT
        medical_assessment_requests.*,
        firm_clients.first_name,
        firm_clients.surname,
        firm_clients.id_number,
        firm_clients.email AS client_email,
        firm_clients.passport_number,
        firm_clients.date_of_birth,
        firm_clients.cell,
        firm_clients.residential_address,
        firm_clients.occupation,
        firm_clients.employer_details,
        firm_clients.banking_json,
        firm_clients.representative_json,
        raf_cases.case_reference,
        raf_cases.accident_date,
        raf_cases.accident_time,
        raf_cases.accident_location,
        raf_cases.police_station,
        raf_cases.police_case_number,
        raf_cases.collision_description,
        raf_cases.vehicle_json,
        raf_cases.driver_json,
        raf_cases.owner_json
      FROM medical_assessment_requests
      JOIN firm_clients ON firm_clients.id = medical_assessment_requests.client_id
      JOIN raf_cases ON raf_cases.id = medical_assessment_requests.case_id
      WHERE medical_assessment_requests.id = ?
    `).get(row.id);

    return res.json(serializeAssessmentPayload(firm, updated));
  } finally {
    firmDb.close();
  }
});
