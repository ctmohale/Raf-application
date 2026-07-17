import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { clientUploadsDir, firmsDir } from '../config.js';

export const coreClientDocumentRequests = Object.freeze([
  ['claimant_id', 'ID / Passport', 'Certified identity document.'],
  ['police_accident_report', 'Police Report', 'Police accident records.'],
  ['client_accident_affidavit', 'Accident Affidavit', 'Signed accident statement.'],
  ['medical_documents', 'Medical Records', 'Treatment and medical records.'],
  ['medical_expenses', 'Medical Bills', 'Invoices and payment proof.'],
  ['employment_income', 'Employment & Income', 'Income and work records.'],
  ['banking_proof', 'Banking Proof', 'Bank letter or statement.'],
  ['photographs', 'Photos', 'Injury and accident photos.']
]);

export function slugifyFirmName(name) {
  const slug = String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'firm';
}

export function getFirmDatabasePath(databaseFilename) {
  return path.join(firmsDir, databaseFilename);
}

export function openFirmDatabase(firm) {
  initializeFirmDatabase(firm);
  const firmDb = new Database(getFirmDatabasePath(firm.database_filename));
  firmDb.pragma('journal_mode = WAL');
  firmDb.pragma('foreign_keys = ON');
  return firmDb;
}

export function initializeFirmDatabase(firm) {
  const firmDb = new Database(getFirmDatabasePath(firm.database_filename));

  try {
    firmDb.pragma('journal_mode = WAL');
    firmDb.pragma('foreign_keys = ON');

    firmDb.exec(`
      CREATE TABLE IF NOT EXISTS firm_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        central_firm_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        contact_name TEXT,
        contact_email TEXT,
        contact_phone TEXT,
        address TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'client',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS document_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        stored_filename TEXT NOT NULL,
        page_count INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'needs_setup',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS template_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        label TEXT NOT NULL,
        page_number INTEGER NOT NULL DEFAULT 1,
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        field_type TEXT NOT NULL DEFAULT 'text',
        required INTEGER NOT NULL DEFAULT 0,
        default_value TEXT,
        options_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS field_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'spreadsheet',
        mapping_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS generated_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        file_name TEXT NOT NULL,
        stored_filename TEXT NOT NULL,
        input_json TEXT NOT NULL,
        row_number INTEGER,
        status TEXT NOT NULL DEFAULT 'generated',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        template_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        last_used_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS firm_clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        surname TEXT NOT NULL,
        id_number TEXT NOT NULL,
        cell TEXT NOT NULL,
        email TEXT NOT NULL,
        invite_token TEXT NOT NULL UNIQUE,
        invite_sent_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS raf_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        matter_id INTEGER,
        case_reference TEXT NOT NULL UNIQUE,
        claim_type TEXT NOT NULL DEFAULT 'RAF claim',
        accident_date TEXT,
        status TEXT NOT NULL DEFAULT 'intake',
        opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES firm_clients(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS matters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        matter_reference TEXT NOT NULL UNIQUE,
        matter_title TEXT NOT NULL,
        matter_type TEXT NOT NULL DEFAULT 'RAF matter',
        responsible_lawyer_user_id INTEGER,
        assigned_assistant_user_id INTEGER,
        status TEXT NOT NULL DEFAULT 'open',
        priority TEXT NOT NULL DEFAULT 'normal',
        opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deadline_json TEXT,
        notes TEXT,
        tasks_json TEXT,
        documents_json TEXT,
        linked_raf_case_id INTEGER UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES firm_clients(id) ON DELETE CASCADE,
        FOREIGN KEY (linked_raf_case_id) REFERENCES raf_cases(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS client_document_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        case_id INTEGER NOT NULL,
        document_type TEXT NOT NULL,
        label TEXT NOT NULL,
        instructions TEXT,
        status TEXT NOT NULL DEFAULT 'requested',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES firm_clients(id) ON DELETE CASCADE,
        FOREIGN KEY (case_id) REFERENCES raf_cases(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS client_uploads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL,
        client_id INTEGER NOT NULL,
        original_filename TEXT NOT NULL,
        stored_filename TEXT NOT NULL,
        mime_type TEXT,
        file_size INTEGER,
        ai_status TEXT NOT NULL DEFAULT 'pending',
        ai_model TEXT,
        ai_extracted_json TEXT,
        ai_summary TEXT,
        ai_error TEXT,
        ai_processed_at TEXT,
        uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES client_document_requests(id) ON DELETE CASCADE,
        FOREIGN KEY (client_id) REFERENCES firm_clients(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS client_email_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES firm_clients(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS claim_form_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        template_id INTEGER NOT NULL,
        generated_document_id INTEGER,
        status TEXT NOT NULL DEFAULT 'generated',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (case_id) REFERENCES raf_cases(id) ON DELETE CASCADE,
        UNIQUE(case_id, template_id)
      );

      CREATE TABLE IF NOT EXISTS medical_assessment_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        client_id INTEGER NOT NULL,
        report_type TEXT NOT NULL,
        doctor_name TEXT NOT NULL,
        practice_number TEXT,
        doctor_email TEXT,
        doctor_phone TEXT,
        deadline TEXT,
        delivery_method TEXT NOT NULL DEFAULT 'email',
        secure_token TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'requested',
        sent_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (case_id) REFERENCES raf_cases(id) ON DELETE CASCADE,
        FOREIGN KEY (client_id) REFERENCES firm_clients(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS firm_doctors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        practice_number TEXT,
        email TEXT,
        phone TEXT,
        specialty TEXT,
        relationship_notes TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS matter_assignment_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        matter_id INTEGER,
        case_id INTEGER NOT NULL,
        previous_lawyer_user_id INTEGER,
        previous_assistant_user_id INTEGER,
        responsible_lawyer_user_id INTEGER,
        assigned_assistant_user_id INTEGER,
        assigned_by_user_id INTEGER NOT NULL,
        assignment_note TEXT,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (case_id) REFERENCES raf_cases(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS firm_schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_templates_user ON document_templates(user_id);
      CREATE INDEX IF NOT EXISTS idx_fields_template ON template_fields(template_id);
      CREATE INDEX IF NOT EXISTS idx_docs_user ON generated_documents(user_id);
      CREATE INDEX IF NOT EXISTS idx_docs_template ON generated_documents(template_id);
      CREATE INDEX IF NOT EXISTS idx_clients_email ON firm_clients(email);
      CREATE INDEX IF NOT EXISTS idx_clients_invite_token ON firm_clients(invite_token);
      CREATE INDEX IF NOT EXISTS idx_cases_client ON raf_cases(client_id);
      CREATE INDEX IF NOT EXISTS idx_matters_client ON matters(client_id);
      CREATE INDEX IF NOT EXISTS idx_matters_lawyer ON matters(responsible_lawyer_user_id);
      CREATE INDEX IF NOT EXISTS idx_matters_assistant ON matters(assigned_assistant_user_id);
      CREATE INDEX IF NOT EXISTS idx_doc_requests_client ON client_document_requests(client_id);
      CREATE INDEX IF NOT EXISTS idx_uploads_client ON client_uploads(client_id);
      CREATE INDEX IF NOT EXISTS idx_email_logs_client ON client_email_logs(client_id);
      CREATE INDEX IF NOT EXISTS idx_claim_forms_case ON claim_form_templates(case_id);
      CREATE INDEX IF NOT EXISTS idx_claim_forms_template ON claim_form_templates(template_id);
      CREATE INDEX IF NOT EXISTS idx_medical_assessments_case ON medical_assessment_requests(case_id);
      CREATE INDEX IF NOT EXISTS idx_medical_assessments_token ON medical_assessment_requests(secure_token);
      CREATE INDEX IF NOT EXISTS idx_firm_doctors_status ON firm_doctors(status);
      CREATE INDEX IF NOT EXISTS idx_matter_assignment_history_case ON matter_assignment_history(case_id, created_at);
    `);

    const clientColumns = firmDb.prepare('PRAGMA table_info(firm_clients)').all().map((column) => column.name);
    const addClientColumn = (name, definition) => {
      if (!clientColumns.includes(name)) {
        firmDb.prepare(`ALTER TABLE firm_clients ADD COLUMN ${name} ${definition}`).run();
      }
    };

    addClientColumn('auto_reminders_enabled', 'INTEGER NOT NULL DEFAULT 0');
    addClientColumn('reminder_time', "TEXT NOT NULL DEFAULT '09:00'");
    addClientColumn('next_reminder_at', 'TEXT');
    addClientColumn('last_reminder_at', 'TEXT');
    addClientColumn('passport_number', 'TEXT');
    addClientColumn('date_of_birth', 'TEXT');
    addClientColumn('residential_address', 'TEXT');
    addClientColumn('occupation', 'TEXT');
    addClientColumn('employer_details', 'TEXT');
    addClientColumn('banking_json', 'TEXT');
    addClientColumn('representative_json', 'TEXT');
    addClientColumn('portal_templates_visible', 'INTEGER NOT NULL DEFAULT 1');
    addClientColumn('portal_template_inputs_enabled', 'INTEGER NOT NULL DEFAULT 1');

    const claimFormColumns = firmDb.prepare('PRAGMA table_info(claim_form_templates)').all().map((column) => column.name);
    const addClaimFormColumn = (name, definition) => {
      if (!claimFormColumns.includes(name)) {
        firmDb.prepare(`ALTER TABLE claim_form_templates ADD COLUMN ${name} ${definition}`).run();
      }
    };

    addClaimFormColumn('client_portal_visible', 'INTEGER NOT NULL DEFAULT 1');

    const caseColumns = firmDb.prepare('PRAGMA table_info(raf_cases)').all().map((column) => column.name);
    const addCaseColumn = (name, definition) => {
      if (!caseColumns.includes(name)) {
        firmDb.prepare(`ALTER TABLE raf_cases ADD COLUMN ${name} ${definition}`).run();
      }
    };

    addCaseColumn('accident_time', 'TEXT');
    addCaseColumn('accident_location', 'TEXT');
    addCaseColumn('police_station', 'TEXT');
    addCaseColumn('police_case_number', 'TEXT');
    addCaseColumn('claimant_role', 'TEXT');
    addCaseColumn('collision_description', 'TEXT');
    addCaseColumn('vehicle_json', 'TEXT');
    addCaseColumn('driver_json', 'TEXT');
    addCaseColumn('owner_json', 'TEXT');
    addCaseColumn('witnesses_json', 'TEXT');
    addCaseColumn('claim_amounts_json', 'TEXT');
    addCaseColumn('statutory_form_set', 'TEXT');
    addCaseColumn('required_forms_json', 'TEXT');
    addCaseColumn('lodgement_deadline', 'TEXT');
    addCaseColumn('internal_deadline', 'TEXT');
    addCaseColumn('deadline_status', "TEXT NOT NULL DEFAULT 'attorney_review_required'");
    addCaseColumn('lawyer_review_status', "TEXT NOT NULL DEFAULT 'not_reviewed'");
    addCaseColumn('original_tracking_json', 'TEXT');
    addCaseColumn('responsible_lawyer_user_id', 'INTEGER');
    addCaseColumn('assigned_assistant_user_id', 'INTEGER');
    addCaseColumn('matter_id', 'INTEGER');
    addCaseColumn('ai_structured_json', 'TEXT');
    addCaseColumn('ai_summary', 'TEXT');
    addCaseColumn('ai_updated_at', 'TEXT');
    firmDb.prepare('CREATE INDEX IF NOT EXISTS idx_cases_matter ON raf_cases(matter_id)').run();

    const matterColumns = firmDb.prepare('PRAGMA table_info(matters)').all().map((column) => column.name);
    const addMatterColumn = (name, definition) => {
      if (!matterColumns.includes(name)) {
        firmDb.prepare(`ALTER TABLE matters ADD COLUMN ${name} ${definition}`).run();
      }
    };

    addMatterColumn('deadline_json', 'TEXT');
    addMatterColumn('notes', 'TEXT');
    addMatterColumn('tasks_json', 'TEXT');
    addMatterColumn('documents_json', 'TEXT');
    addMatterColumn('linked_raf_case_id', 'INTEGER');

    const uploadColumns = firmDb.prepare('PRAGMA table_info(client_uploads)').all().map((column) => column.name);
    const addUploadColumn = (name, definition) => {
      if (!uploadColumns.includes(name)) {
        firmDb.prepare(`ALTER TABLE client_uploads ADD COLUMN ${name} ${definition}`).run();
      }
    };

    addUploadColumn('ai_status', "TEXT NOT NULL DEFAULT 'pending'");
    addUploadColumn('ai_model', 'TEXT');
    addUploadColumn('ai_extracted_json', 'TEXT');
    addUploadColumn('ai_summary', 'TEXT');
    addUploadColumn('ai_error', 'TEXT');
    addUploadColumn('ai_processed_at', 'TEXT');

    const medicalAssessmentColumns = firmDb.prepare('PRAGMA table_info(medical_assessment_requests)').all().map((column) => column.name);
    const addMedicalAssessmentColumn = (name, definition) => {
      if (!medicalAssessmentColumns.includes(name)) {
        firmDb.prepare(`ALTER TABLE medical_assessment_requests ADD COLUMN ${name} ${definition}`).run();
      }
    };

    addMedicalAssessmentColumn('assessment_json', 'TEXT');
    addMedicalAssessmentColumn('submitted_at', 'TEXT');
    addMedicalAssessmentColumn('inherit_client_information', 'INTEGER NOT NULL DEFAULT 1');
    addMedicalAssessmentColumn('lock_prefilled_fields', 'INTEGER NOT NULL DEFAULT 1');
    addMedicalAssessmentColumn('hide_prefilled_fields', 'INTEGER NOT NULL DEFAULT 0');

    const documentRequestColumns = firmDb.prepare('PRAGMA table_info(client_document_requests)').all().map((column) => column.name);
    if (!documentRequestColumns.includes('instructions')) {
      firmDb.prepare('ALTER TABLE client_document_requests ADD COLUMN instructions TEXT').run();
    }

    const assignmentHistoryColumns = firmDb.prepare('PRAGMA table_info(matter_assignment_history)').all().map((column) => column.name);
    if (!assignmentHistoryColumns.includes('matter_id')) {
      firmDb.prepare('ALTER TABLE matter_assignment_history ADD COLUMN matter_id INTEGER').run();
    }

    const coreDocumentRequestMigration = 'limit-client-document-requests-to-four-v1';
    const coreDocumentRequestMigrationApplied = firmDb.prepare(
      'SELECT 1 FROM firm_schema_migrations WHERE name = ?'
    ).get(coreDocumentRequestMigration);

    if (!coreDocumentRequestMigrationApplied) {
      const coreDocumentTypes = coreClientDocumentRequests.map(([type]) => type);
      const placeholders = coreDocumentTypes.map(() => '?').join(', ');
      const migrateDocumentRequests = firmDb.transaction(() => {
        firmDb.prepare(`
          DELETE FROM client_document_requests
          WHERE document_type NOT IN (${placeholders})
            AND NOT EXISTS (
              SELECT 1 FROM client_uploads
              WHERE client_uploads.request_id = client_document_requests.id
            )
        `).run(...coreDocumentTypes);
        firmDb.prepare('INSERT INTO firm_schema_migrations (name) VALUES (?)')
          .run(coreDocumentRequestMigration);
      });
      migrateDocumentRequests();
    }

    const essentialDocumentMigration = 'expand-essential-client-documents-v2';
    const essentialDocumentMigrationApplied = firmDb.prepare(
      'SELECT 1 FROM firm_schema_migrations WHERE name = ?'
    ).get(essentialDocumentMigration);

    if (!essentialDocumentMigrationApplied) {
      const essentialDocumentTypes = coreClientDocumentRequests.map(([type]) => type);
      const placeholders = essentialDocumentTypes.map(() => '?').join(', ');
      const migrateEssentialDocuments = firmDb.transaction(() => {
        firmDb.prepare(`
          DELETE FROM client_document_requests
          WHERE document_type NOT IN (${placeholders})
            AND NOT EXISTS (
              SELECT 1 FROM client_uploads
              WHERE client_uploads.request_id = client_document_requests.id
            )
        `).run(...essentialDocumentTypes);

        const cases = firmDb.prepare('SELECT id, client_id FROM raf_cases').all();
        const findRequest = firmDb.prepare(
          'SELECT id FROM client_document_requests WHERE case_id = ? AND document_type = ? ORDER BY id LIMIT 1'
        );
        const updateRequest = firmDb.prepare(
          'UPDATE client_document_requests SET label = ?, instructions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        );
        const insertRequest = firmDb.prepare(`
          INSERT INTO client_document_requests (client_id, case_id, document_type, label, instructions)
          VALUES (?, ?, ?, ?, ?)
        `);

        for (const caseRecord of cases) {
          for (const [type, label, instructions] of coreClientDocumentRequests) {
            const existing = findRequest.get(caseRecord.id, type);
            if (existing) updateRequest.run(label, instructions, existing.id);
            else insertRequest.run(caseRecord.client_id, caseRecord.id, type, label, instructions);
          }
        }

        firmDb.prepare('INSERT INTO firm_schema_migrations (name) VALUES (?)')
          .run(essentialDocumentMigration);
      });
      migrateEssentialDocuments();
    }

    const compactDocumentLabelsMigration = 'compact-document-labels-v3';
    const compactDocumentLabelsApplied = firmDb.prepare(
      'SELECT 1 FROM firm_schema_migrations WHERE name = ?'
    ).get(compactDocumentLabelsMigration);

    if (!compactDocumentLabelsApplied) {
      const updateDocumentRequest = firmDb.prepare(`
        UPDATE client_document_requests
        SET label = ?, instructions = ?, updated_at = CURRENT_TIMESTAMP
        WHERE document_type = ?
      `);
      const migrateCompactLabels = firmDb.transaction(() => {
        for (const [type, label, instructions] of coreClientDocumentRequests) {
          updateDocumentRequest.run(label, instructions, type);
        }
        firmDb.prepare('INSERT INTO firm_schema_migrations (name) VALUES (?)')
          .run(compactDocumentLabelsMigration);
      });
      migrateCompactLabels();
    }

    const shortDocumentGuidanceMigration = 'short-document-guidance-v4';
    const shortDocumentGuidanceApplied = firmDb.prepare(
      'SELECT 1 FROM firm_schema_migrations WHERE name = ?'
    ).get(shortDocumentGuidanceMigration);

    if (!shortDocumentGuidanceApplied) {
      const updateDocumentRequest = firmDb.prepare(`
        UPDATE client_document_requests
        SET label = ?, instructions = ?, updated_at = CURRENT_TIMESTAMP
        WHERE document_type = ?
      `);
      const migrateShortGuidance = firmDb.transaction(() => {
        for (const [type, label, instructions] of coreClientDocumentRequests) {
          updateDocumentRequest.run(label, instructions, type);
        }
        firmDb.prepare('INSERT INTO firm_schema_migrations (name) VALUES (?)')
          .run(shortDocumentGuidanceMigration);
      });
      migrateShortGuidance();
    }

    const mattersSplitMigration = 'split-matters-from-raf-claims-v1';
    const mattersSplitApplied = firmDb.prepare(
      'SELECT 1 FROM firm_schema_migrations WHERE name = ?'
    ).get(mattersSplitMigration);

    if (!mattersSplitApplied) {
      const migrateMatters = firmDb.transaction(() => {
        const claims = firmDb.prepare(`
          SELECT raf_cases.*, firm_clients.first_name, firm_clients.surname
          FROM raf_cases
          JOIN firm_clients ON firm_clients.id = raf_cases.client_id
          ORDER BY raf_cases.id
        `).all();
        const insertMatter = firmDb.prepare(`
          INSERT INTO matters
            (
              client_id, matter_reference, matter_title, matter_type,
              responsible_lawyer_user_id, assigned_assistant_user_id,
              status, priority, opened_at, deadline_json, notes,
              tasks_json, documents_json, linked_raf_case_id
            )
          VALUES (?, ?, ?, 'RAF matter', ?, ?, ?, 'normal', ?, ?, '', '[]', '[]', ?)
        `);
        const updateClaimMatter = firmDb.prepare(`
          UPDATE raf_cases
          SET matter_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `);

        for (const claim of claims) {
          if (claim.matter_id) continue;
          const matterReference = `MAT-${String(claim.id).padStart(5, '0')}`;
          const matterTitle = `${claim.surname || 'Client'} v Road Accident Fund`;
          const matterStatus = claim.status === 'closed' ? 'closed' : claim.status === 'submitted' ? 'pending' : 'open';
          const deadlineJson = JSON.stringify([
            claim.internal_deadline ? { label: 'Internal deadline', date: claim.internal_deadline } : null,
            claim.lodgement_deadline ? { label: 'RAF lodgement deadline', date: claim.lodgement_deadline } : null
          ].filter(Boolean));
          const result = insertMatter.run(
            claim.client_id,
            matterReference,
            matterTitle,
            claim.responsible_lawyer_user_id || null,
            claim.assigned_assistant_user_id || null,
            matterStatus,
            claim.opened_at || new Date().toISOString(),
            deadlineJson,
            claim.id
          );
          updateClaimMatter.run(result.lastInsertRowid, claim.id);
        }
        firmDb.prepare(`
          UPDATE matter_assignment_history
          SET matter_id = (
            SELECT raf_cases.matter_id
            FROM raf_cases
            WHERE raf_cases.id = matter_assignment_history.case_id
          )
          WHERE matter_id IS NULL
        `).run();
        firmDb.prepare('INSERT INTO firm_schema_migrations (name) VALUES (?)')
          .run(mattersSplitMigration);
      });
      migrateMatters();
    }

    firmDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_clients_next_reminder ON firm_clients(next_reminder_at);
    `);

    const firmUploadDir = path.join(clientUploadsDir, firm.slug);
    fs.mkdirSync(firmUploadDir, { recursive: true });

    const flatUploads = firmDb.prepare('SELECT id, stored_filename FROM client_uploads').all()
      .filter((upload) => path.basename(upload.stored_filename) === upload.stored_filename);
    const updateStoredFilename = firmDb.prepare('UPDATE client_uploads SET stored_filename = ? WHERE id = ?');

    for (const upload of flatUploads) {
      const firmStoredFilename = path.join(firm.slug, upload.stored_filename);
      const currentPath = path.join(clientUploadsDir, upload.stored_filename);
      const firmPath = path.join(clientUploadsDir, firmStoredFilename);

      if (fs.existsSync(currentPath) && !fs.existsSync(firmPath)) {
        fs.renameSync(currentPath, firmPath);
      }

      if (fs.existsSync(firmPath)) {
        updateStoredFilename.run(firmStoredFilename, upload.id);
      }
    }

    firmDb.prepare(`
      INSERT INTO firm_profile
        (id, central_firm_id, name, slug, contact_name, contact_email, contact_phone, address)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        central_firm_id = excluded.central_firm_id,
        name = excluded.name,
        slug = excluded.slug,
        contact_name = excluded.contact_name,
        contact_email = excluded.contact_email,
        contact_phone = excluded.contact_phone,
        address = excluded.address,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      firm.id,
      firm.name,
      firm.slug,
      firm.contact_name || null,
      firm.contact_email || null,
      firm.contact_phone || null,
      firm.address || null
    );
  } finally {
    firmDb.close();
  }
}
