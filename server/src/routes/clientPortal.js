import express from 'express';
import { db } from '../db/db.js';
import { clientDocumentUpload } from '../middleware/upload.js';
import { openFirmDatabase } from '../services/firmDatabases.js';

export const clientPortalRouter = express.Router();

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
  const compacted = compactObject(value);
  return Object.keys(compacted).length ? JSON.stringify(compacted) : null;
}

function safeJsonArray(values) {
  const compacted = (Array.isArray(values) ? values : [values])
    .map(compactObject)
    .filter((item) => Object.keys(item).length);
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

function findClientPortal(token) {
  const firms = db.prepare("SELECT * FROM firms WHERE status = 'active'").all();

  for (const firm of firms) {
    const firmDb = openFirmDatabase(firm);
    try {
      const client = firmDb.prepare('SELECT * FROM firm_clients WHERE invite_token = ?').get(token);
      if (client) return { firm, firmDb, client };
      firmDb.close();
    } catch (error) {
      firmDb.close();
      throw error;
    }
  }

  return null;
}

function hasPendingDocuments(firmDb, clientId) {
  const row = firmDb.prepare(`
    SELECT COUNT(*) AS count
    FROM client_document_requests
    WHERE client_id = ? AND status != 'uploaded'
  `).get(clientId);
  return Number(row.count || 0) > 0;
}

function serializePortal(firm, firmDb, client) {
  const cases = firmDb.prepare(`
    SELECT *
    FROM raf_cases
    WHERE client_id = ?
    ORDER BY opened_at DESC
  `).all(client.id);

  const requests = firmDb.prepare(`
    SELECT
      client_document_requests.*,
      client_uploads.original_filename,
      client_uploads.uploaded_at
    FROM client_document_requests
    LEFT JOIN client_uploads ON client_uploads.request_id = client_document_requests.id
    WHERE client_document_requests.client_id = ?
    ORDER BY client_document_requests.created_at
  `).all(client.id);

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
    cases,
    requests
  };
}

clientPortalRouter.get('/:token', (req, res) => {
  const portal = findClientPortal(req.params.token);
  if (!portal) return res.status(404).json({ error: 'Client portal link is invalid or expired' });

  try {
    res.json(serializePortal(portal.firm, portal.firmDb, portal.client));
  } finally {
    portal.firmDb.close();
  }
});

clientPortalRouter.patch('/:token/intake', (req, res) => {
  const portal = findClientPortal(req.params.token);
  if (!portal) return res.status(404).json({ error: 'Client portal link is invalid or expired' });

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
    portal.firmDb.close();
    return res.status(400).json({ error: 'Email address must be valid' });
  }

  try {
    portal.firmDb.prepare(`
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
    `).run(
      cleanString(cell),
      cleanString(email).toLowerCase(),
      cleanString(passportNumber),
      cleanString(dateOfBirth),
      cleanString(residentialAddress),
      cleanString(occupation),
      cleanString(employerDetails),
      portal.client.id
    );

    const latestCase = portal.firmDb.prepare(`
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
      portal.firmDb.prepare(`
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
      `).run(
        cleanString(accidentTime),
        cleanString(accidentLocation),
        cleanString(policeStation),
        cleanString(policeCaseNumber),
        cleanString(collisionDescription),
        safeJson({ ...existingVehicle, description: vehicleDescription || existingVehicle.description }),
        safeJson({ ...existingDriver, name: driverName || existingDriver.name, contact: driverContact || existingDriver.contact }),
        safeJsonArray({ ...existingWitness, name: witnessName || existingWitness.name, contact: witnessContact || existingWitness.contact, statement: witnessStatement || existingWitness.statement }),
        latestCase.id
      );
    }

    const client = portal.firmDb.prepare('SELECT * FROM firm_clients WHERE id = ?').get(portal.client.id);
    return res.json(serializePortal(portal.firm, portal.firmDb, client));
  } finally {
    portal.firmDb.close();
  }
});

clientPortalRouter.post('/:token/requests/:requestId/upload', clientDocumentUpload.single('document'), (req, res) => {
  const portal = findClientPortal(req.params.token);
  if (!portal) return res.status(404).json({ error: 'Client portal link is invalid or expired' });
  if (!req.file) {
    portal.firmDb.close();
    return res.status(400).json({ error: 'Document file is required' });
  }

  try {
    const request = portal.firmDb.prepare(`
      SELECT *
      FROM client_document_requests
      WHERE id = ? AND client_id = ?
    `).get(req.params.requestId, portal.client.id);

    if (!request) return res.status(404).json({ error: 'Document request not found' });

    portal.firmDb.prepare(`
      INSERT INTO client_uploads
        (request_id, client_id, original_filename, stored_filename, mime_type, file_size)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      request.id,
      portal.client.id,
      req.file.originalname,
      req.clientUploadStoredFilename || req.file.filename,
      req.file.mimetype,
      req.file.size
    );

    portal.firmDb.prepare(`
      UPDATE client_document_requests
      SET status = 'uploaded', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(request.id);

    if (!hasPendingDocuments(portal.firmDb, portal.client.id)) {
      portal.firmDb.prepare(`
        UPDATE firm_clients
        SET next_reminder_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(portal.client.id);
    }

    res.status(201).json(serializePortal(portal.firm, portal.firmDb, portal.client));
  } finally {
    portal.firmDb.close();
  }
});
