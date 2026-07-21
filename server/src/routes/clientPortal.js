import fs from 'node:fs';
import express from 'express';
import { db, serializeDocument, serializeField, serializeTemplate } from '../db/db.js';
import { originalsDir, resolveInside } from '../config.js';
import { clientDocumentUpload } from '../middleware/upload.js';
import { openFirmDatabase } from '../services/firmDatabases.js';
import { generateFilledPdf, validateDataAgainstFields } from '../services/pdfFill.js';
import { processUploadedDocumentWithAi } from '../services/aiDocumentExtraction.js';
import { getTemplateFields } from '../services/templateAccess.js';
export const clientPortalRouter = express.Router();
function cleanString(value) {
  return String(value || '').trim();
}
function compactObject(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [key, cleanString(entryValue)]).filter(([, entryValue]) => entryValue !== ''));
}
function safeJson(value) {
  const compacted = compactObject(value);
  return Object.keys(compacted).length ? JSON.stringify(compacted) : null;
}
function safeJsonArray(values) {
  const compacted = (Array.isArray(values) ? values : [values]).map(compactObject).filter(item => Object.keys(item).length);
  return compacted.length ? JSON.stringify(compacted) : null;
}
function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
async function getPortalClaimFormAttachment(firmDb, clientId, attachmentId) {
  return await firmDb.prepare(`
    SELECT
      claim_form_templates.*,
      raf_cases.case_reference,
      raf_cases.client_id
    FROM claim_form_templates
    JOIN raf_cases ON raf_cases.id = claim_form_templates.case_id
    WHERE claim_form_templates.id = ? AND raf_cases.client_id = ? AND claim_form_templates.client_portal_visible != 0
  `).get(attachmentId, clientId);
}
async function serializePortalClaimForm(row) {
  const template = await db.prepare(`
    SELECT document_templates.*, COUNT(template_fields.id) AS field_count
    FROM document_templates
    LEFT JOIN template_fields ON template_fields.template_id = document_templates.id
    WHERE document_templates.id = ?
    GROUP BY document_templates.id
  `).get(row.template_id);
  const fields = template ? (await getTemplateFields(template.id)).map(serializeField) : [];
  const document = row.generated_document_id ? await db.prepare(`
      SELECT generated_documents.*, document_templates.name AS template_name
      FROM generated_documents
      JOIN document_templates ON document_templates.id = generated_documents.template_id
      WHERE generated_documents.id = ?
    `).get(row.generated_document_id) : null;
  return {
    ...row,
    template: template ? {
      ...serializeTemplate(template),
      fields
    } : null,
    document: document ? serializeDocument(document) : null
  };
}
async function findClientPortal(token) {
  const firms = await db.prepare("SELECT * FROM firms WHERE status = 'active'").all();
  for (const firm of firms) {
    const firmDb = await openFirmDatabase(firm);
    try {
      const client = await firmDb.prepare('SELECT * FROM firm_clients WHERE invite_token = ?').get(token);
      if (client) return {
        firm,
        firmDb,
        client
      };
      await firmDb.close();
    } catch (error) {
      await firmDb.close();
      throw error;
    }
  }
  return null;
}
async function hasPendingDocuments(firmDb, clientId) {
  const row = await firmDb.prepare(`
    SELECT COUNT(*) AS count
    FROM client_document_requests
    WHERE client_id = ? AND status != 'uploaded'
  `).get(clientId);
  return Number(row.count || 0) > 0;
}
async function serializePortal(firm, firmDb, client) {
  const templateViewEnabled = client.portal_templates_visible !== 0;
  const templateInputsEnabled = templateViewEnabled && client.portal_template_inputs_enabled !== 0;
  const cases = await firmDb.prepare(`
    SELECT *
    FROM raf_cases
    WHERE client_id = ?
    ORDER BY opened_at DESC
  `).all(client.id);
  const requests = await firmDb.prepare(`
    SELECT
      client_document_requests.*,
      COUNT(client_uploads.id) AS upload_count,
      (
        SELECT latest_upload.original_filename
        FROM client_uploads AS latest_upload
        WHERE latest_upload.request_id = client_document_requests.id
        ORDER BY latest_upload.id DESC
        LIMIT 1
      ) AS original_filename,
      (
        SELECT latest_upload.uploaded_at
        FROM client_uploads AS latest_upload
        WHERE latest_upload.request_id = client_document_requests.id
        ORDER BY latest_upload.id DESC
        LIMIT 1
      ) AS uploaded_at
      ,(
        SELECT latest_upload.ai_status
        FROM client_uploads AS latest_upload
        WHERE latest_upload.request_id = client_document_requests.id
        ORDER BY latest_upload.id DESC
        LIMIT 1
      ) AS ai_status
      ,(
        SELECT latest_upload.ai_summary
        FROM client_uploads AS latest_upload
        WHERE latest_upload.request_id = client_document_requests.id
        ORDER BY latest_upload.id DESC
        LIMIT 1
      ) AS ai_summary
      ,(
        SELECT latest_upload.ai_error
        FROM client_uploads AS latest_upload
        WHERE latest_upload.request_id = client_document_requests.id
        ORDER BY latest_upload.id DESC
        LIMIT 1
      ) AS ai_error
    FROM client_document_requests
    LEFT JOIN client_uploads ON client_uploads.request_id = client_document_requests.id
    WHERE client_document_requests.client_id = ?
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
  `).all(client.id);
  const claimForms = templateViewEnabled ? await Promise.all((await firmDb.prepare(`
    SELECT
      claim_form_templates.*,
      raf_cases.case_reference,
      raf_cases.client_id
    FROM claim_form_templates
    JOIN raf_cases ON raf_cases.id = claim_form_templates.case_id
    WHERE raf_cases.client_id = ? AND claim_form_templates.client_portal_visible != 0
    ORDER BY claim_form_templates.created_at DESC, claim_form_templates.id DESC
  `).all(client.id)).map(serializePortalClaimForm)) : [];
  return {
    firm: {
      id: firm.id,
      name: firm.name,
      contact_email: firm.contact_email,
      contact_phone: firm.contact_phone
    },
    client: {
      id: client.id,
      first_name: client.first_name,
      surname: client.surname,
      id_number: client.id_number,
      passport_number: client.passport_number,
      date_of_birth: client.date_of_birth,
      email: client.email,
      cell: client.cell,
      residential_address: client.residential_address,
      occupation: client.occupation,
      employer_details: client.employer_details
    },
    portal_permissions: {
      template_view_enabled: templateViewEnabled,
      template_inputs_enabled: templateInputsEnabled
    },
    cases,
    requests,
    claimForms
  };
}
clientPortalRouter.get('/:token', async (req, res) => {
  const portal = await findClientPortal(req.params.token);
  if (!portal) return res.status(404).json({
    error: 'Client portal link is invalid or expired'
  });
  try {
    res.json(await serializePortal(portal.firm, portal.firmDb, portal.client));
  } finally {
    await portal.firmDb.close();
  }
});
clientPortalRouter.patch('/:token/intake', async (req, res) => {
  const portal = await findClientPortal(req.params.token);
  if (!portal) return res.status(404).json({
    error: 'Client portal link is invalid or expired'
  });
  const {
    cell,
    email,
    passport_number: passportNumber,
    date_of_birth: dateOfBirth,
    residential_address: residentialAddress,
    occupation,
    employer_details: employerDetails,
    accident_time: accidentTime,
    accident_location: accidentLocation,
    police_station: policeStation,
    police_case_number: policeCaseNumber,
    collision_description: collisionDescription,
    vehicle_description: vehicleDescription,
    driver_name: driverName,
    driver_contact: driverContact,
    witness_name: witnessName,
    witness_contact: witnessContact,
    witness_statement: witnessStatement
  } = req.body || {};
  if (email && !String(email).includes('@')) {
    await portal.firmDb.close();
    return res.status(400).json({
      error: 'Email address must be valid'
    });
  }
  try {
    await portal.firmDb.prepare(`
      UPDATE firm_clients
      SET
        cell = COALESCE(NULLIF(?, ''), cell),
        email = COALESCE(NULLIF(?, ''), email),
        passport_number = COALESCE(NULLIF(?, ''), passport_number),
        date_of_birth = COALESCE(NULLIF(?, ''), date_of_birth),
        residential_address = COALESCE(NULLIF(?, ''), residential_address),
        occupation = COALESCE(NULLIF(?, ''), occupation),
        employer_details = COALESCE(NULLIF(?, ''), employer_details),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(cleanString(cell), cleanString(email).toLowerCase(), cleanString(passportNumber), cleanString(dateOfBirth), cleanString(residentialAddress), cleanString(occupation), cleanString(employerDetails), portal.client.id);
    const latestCase = await portal.firmDb.prepare(`
      SELECT *
      FROM raf_cases
      WHERE client_id = ?
      ORDER BY opened_at DESC
      LIMIT 1
    `).get(portal.client.id);
    if (latestCase) {
      const existingVehicle = parseJson(latestCase.vehicle_json);
      const existingDriver = parseJson(latestCase.driver_json);
      const existingWitnesses = parseJson(latestCase.witnesses_json, []);
      const existingWitness = Array.isArray(existingWitnesses) ? existingWitnesses[0] || {} : {};
      await portal.firmDb.prepare(`
        UPDATE raf_cases
        SET
          accident_time = COALESCE(NULLIF(?, ''), accident_time),
          accident_location = COALESCE(NULLIF(?, ''), accident_location),
          police_station = COALESCE(NULLIF(?, ''), police_station),
          police_case_number = COALESCE(NULLIF(?, ''), police_case_number),
          collision_description = COALESCE(NULLIF(?, ''), collision_description),
          vehicle_json = COALESCE(?, vehicle_json),
          driver_json = COALESCE(?, driver_json),
          witnesses_json = COALESCE(?, witnesses_json),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(cleanString(accidentTime), cleanString(accidentLocation), cleanString(policeStation), cleanString(policeCaseNumber), cleanString(collisionDescription), safeJson({
        ...existingVehicle,
        description: vehicleDescription || existingVehicle.description
      }), safeJson({
        ...existingDriver,
        name: driverName || existingDriver.name,
        contact: driverContact || existingDriver.contact
      }), safeJsonArray({
        ...existingWitness,
        name: witnessName || existingWitness.name,
        contact: witnessContact || existingWitness.contact,
        statement: witnessStatement || existingWitness.statement
      }), latestCase.id);
    }
    const client = await portal.firmDb.prepare('SELECT * FROM firm_clients WHERE id = ?').get(portal.client.id);
    return res.json(await serializePortal(portal.firm, portal.firmDb, client));
  } finally {
    await portal.firmDb.close();
  }
});
clientPortalRouter.get('/:token/forms/:attachmentId/template/pdf', async (req, res) => {
  const portal = await findClientPortal(req.params.token);
  if (!portal) return res.status(404).json({
    error: 'Client portal link is invalid or expired'
  });
  try {
    if (portal.client.portal_templates_visible === 0) {
      return res.status(403).json({
        error: 'Template viewing is disabled for this shared link'
      });
    }
    const attachment = await getPortalClaimFormAttachment(portal.firmDb, portal.client.id, req.params.attachmentId);
    if (!attachment) return res.status(404).json({
      error: 'Attached template form not found for this client'
    });
    const template = await db.prepare('SELECT * FROM document_templates WHERE id = ?').get(attachment.template_id);
    if (!template) return res.status(404).json({
      error: 'Template not found'
    });
    const filePath = resolveInside(originalsDir, template.stored_filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({
      error: 'PDF is missing from storage'
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${template.original_filename}"`);
    return fs.createReadStream(filePath).pipe(res);
  } finally {
    await portal.firmDb.close();
  }
});
clientPortalRouter.patch('/:token/forms/:attachmentId', async (req, res, next) => {
  const portal = await findClientPortal(req.params.token);
  if (!portal) return res.status(404).json({
    error: 'Client portal link is invalid or expired'
  });
  try {
    if (portal.client.portal_templates_visible === 0 || portal.client.portal_template_inputs_enabled === 0) {
      return res.status(403).json({
        error: 'Template input is disabled for this shared link'
      });
    }
    const attachment = await getPortalClaimFormAttachment(portal.firmDb, portal.client.id, req.params.attachmentId);
    if (!attachment) return res.status(404).json({
      error: 'Attached template form not found for this client'
    });
    const template = await db.prepare('SELECT * FROM document_templates WHERE id = ? AND status = ?').get(attachment.template_id, 'ready');
    if (!template) return res.status(404).json({
      error: 'Template is not ready or was not found'
    });
    const fields = (await getTemplateFields(template.id)).map(serializeField);
    const existingDocument = attachment.generated_document_id ? await db.prepare('SELECT * FROM generated_documents WHERE id = ?').get(attachment.generated_document_id) : null;
    const existingData = parseJson(existingDocument?.input_json, {});
    const submittedData = req.body?.data && typeof req.body.data === 'object' ? req.body.data : {};
    const data = {
      ...existingData,
      ...submittedData
    };
    const errors = validateDataAgainstFields(fields, data);
    if (errors.length) return res.status(400).json({
      error: errors.join(', ')
    });
    const document = await generateFilledPdf({
      template,
      fields,
      data,
      userId: existingDocument?.user_id || template.user_id,
      sourceType: 'client_portal_claim_form'
    });
    await portal.firmDb.prepare(`
      UPDATE claim_form_templates
      SET generated_document_id = ?, status = 'generated', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(document.id, attachment.id);
    const client = await portal.firmDb.prepare('SELECT * FROM firm_clients WHERE id = ?').get(portal.client.id);
    return res.json(await serializePortal(portal.firm, portal.firmDb, client));
  } catch (error) {
    return next(error);
  } finally {
    await portal.firmDb.close();
  }
});
clientPortalRouter.post('/:token/requests/:requestId/upload', clientDocumentUpload.single('document'), async (req, res) => {
  const portal = await findClientPortal(req.params.token);
  if (!portal) return res.status(404).json({
    error: 'Client portal link is invalid or expired'
  });
  if (!req.file) {
    await portal.firmDb.close();
    return res.status(400).json({
      error: 'Document file is required'
    });
  }
  try {
    const request = await portal.firmDb.prepare(`
      SELECT *
      FROM client_document_requests
      WHERE id = ? AND client_id = ?
    `).get(req.params.requestId, portal.client.id);
    if (!request) return res.status(404).json({
      error: 'Document request not found'
    });
    const uploadResult = await portal.firmDb.prepare(`
      INSERT INTO client_uploads
        (request_id, client_id, original_filename, stored_filename, mime_type, file_size)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(request.id, portal.client.id, req.file.originalname, req.clientUploadStoredFilename || req.file.filename, req.file.mimetype, req.file.size);
    await portal.firmDb.prepare(`
      UPDATE client_document_requests
      SET status = 'uploaded', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(request.id);
    if (!(await hasPendingDocuments(portal.firmDb, portal.client.id))) {
      await portal.firmDb.prepare(`
        UPDATE firm_clients
        SET next_reminder_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(portal.client.id);
    }
    await processUploadedDocumentWithAi({
      firmDb: portal.firmDb,
      uploadId: uploadResult.lastInsertRowid
    });
    res.status(201).json(await serializePortal(portal.firm, portal.firmDb, portal.client));
  } finally {
    await portal.firmDb.close();
  }
});
