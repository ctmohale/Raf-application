import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { clientUploadsDir, firmsDir } from '../config.js';

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
        case_reference TEXT NOT NULL UNIQUE,
        claim_type TEXT NOT NULL DEFAULT 'RAF claim',
        accident_date TEXT,
        status TEXT NOT NULL DEFAULT 'intake',
        opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES firm_clients(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS client_document_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        case_id INTEGER NOT NULL,
        document_type TEXT NOT NULL,
        label TEXT NOT NULL,
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

      CREATE INDEX IF NOT EXISTS idx_templates_user ON document_templates(user_id);
      CREATE INDEX IF NOT EXISTS idx_fields_template ON template_fields(template_id);
      CREATE INDEX IF NOT EXISTS idx_docs_user ON generated_documents(user_id);
      CREATE INDEX IF NOT EXISTS idx_docs_template ON generated_documents(template_id);
      CREATE INDEX IF NOT EXISTS idx_clients_email ON firm_clients(email);
      CREATE INDEX IF NOT EXISTS idx_clients_invite_token ON firm_clients(invite_token);
      CREATE INDEX IF NOT EXISTS idx_cases_client ON raf_cases(client_id);
      CREATE INDEX IF NOT EXISTS idx_doc_requests_client ON client_document_requests(client_id);
      CREATE INDEX IF NOT EXISTS idx_uploads_client ON client_uploads(client_id);
      CREATE INDEX IF NOT EXISTS idx_email_logs_client ON client_email_logs(client_id);
      CREATE INDEX IF NOT EXISTS idx_claim_forms_case ON claim_form_templates(case_id);
      CREATE INDEX IF NOT EXISTS idx_claim_forms_template ON claim_form_templates(template_id);
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
