import express from 'express';
import { db } from '../db/db.js';
import { openFirmDatabase } from '../services/firmDatabases.js';

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
          firm_clients.date_of_birth,
          firm_clients.cell,
          raf_cases.case_reference,
          raf_cases.accident_date,
          raf_cases.accident_time,
          raf_cases.accident_location,
          raf_cases.collision_description
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
      values: parseJson(row.assessment_json, {})
    },
    patient: {
      first_name: row.first_name,
      surname: row.surname,
      date_of_birth: row.date_of_birth,
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

medicalAssessmentsRouter.patch('/:token', (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(404).json({ error: 'Assessment link not found' });

  const match = getAssessmentByToken(token);
  if (!match) return res.status(404).json({ error: 'Assessment link not found' });

  const { firm, firmDb, row } = match;
  try {
    const values = cleanAssessmentValues(req.body?.values || {});
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
        firm_clients.date_of_birth,
        firm_clients.cell,
        raf_cases.case_reference,
        raf_cases.accident_date,
        raf_cases.accident_time,
        raf_cases.accident_location,
        raf_cases.collision_description
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
