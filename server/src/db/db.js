import path from 'node:path';
import Database from 'better-sqlite3';
import { dataDir } from '../config.js';

export const db = new Database(path.join(dataDir, 'app.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    status TEXT NOT NULL DEFAULT 'active',
    approved_by_user_id INTEGER,
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS firms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    address TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    database_filename TEXT NOT NULL UNIQUE,
    created_by_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_firm_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    firm_id INTEGER NOT NULL,
    access_level TEXT NOT NULL DEFAULT 'staff',
    firm_role TEXT NOT NULL DEFAULT 'assistant',
    phone TEXT,
    job_title TEXT,
    can_submit_claims INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, firm_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS firm_user_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    firm_id INTEGER NOT NULL,
    case_id INTEGER,
    notification_type TEXT NOT NULL DEFAULT 'matter_assignment',
    message TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE
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

  CREATE TABLE IF NOT EXISTS firm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_id INTEGER NOT NULL,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('admin', 'firm')),
    sender_name TEXT NOT NULL,
    body TEXT NOT NULL,
    read_by_admin INTEGER NOT NULL DEFAULT 0,
    read_by_firm INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'info',
    event_type TEXT NOT NULL DEFAULT 'request',
    action TEXT NOT NULL,
    method TEXT,
    path TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    firm_id INTEGER,
    firm_name TEXT,
    user_id INTEGER,
    user_name TEXT,
    user_email TEXT,
    user_role TEXT,
    entity_type TEXT,
    entity_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    message TEXT,
    metadata_json TEXT,
    error_stack TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_templates_user ON document_templates(user_id);
  CREATE INDEX IF NOT EXISTS idx_firms_status ON firms(status);
  CREATE INDEX IF NOT EXISTS idx_user_firm_access_user ON user_firm_access(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_firm_access_firm ON user_firm_access(firm_id);
  CREATE INDEX IF NOT EXISTS idx_firm_user_notifications_user ON firm_user_notifications(user_id, read_at, created_at);
  CREATE INDEX IF NOT EXISTS idx_fields_template ON template_fields(template_id);
  CREATE INDEX IF NOT EXISTS idx_docs_user ON generated_documents(user_id);
  CREATE INDEX IF NOT EXISTS idx_docs_template ON generated_documents(template_id);
  CREATE INDEX IF NOT EXISTS idx_firm_messages_firm ON firm_messages(firm_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_activity_logs_firm ON activity_logs(firm_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_activity_logs_level ON activity_logs(level, created_at);
  CREATE INDEX IF NOT EXISTS idx_activity_logs_event ON activity_logs(event_type, created_at);
`);

const firmColumns = db.prepare('PRAGMA table_info(firms)').all().map((column) => column.name);
if (!firmColumns.includes('billing_rate_per_application')) {
  db.prepare('ALTER TABLE firms ADD COLUMN billing_rate_per_application REAL').run();
}

const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
if (!userColumns.includes('status')) {
  db.prepare("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'").run();
}
if (!userColumns.includes('approved_by_user_id')) {
  db.prepare('ALTER TABLE users ADD COLUMN approved_by_user_id INTEGER').run();
}
if (!userColumns.includes('approved_at')) {
  db.prepare('ALTER TABLE users ADD COLUMN approved_at TEXT').run();
}
if (!userColumns.includes('updated_at')) {
  db.prepare('ALTER TABLE users ADD COLUMN updated_at TEXT').run();
}
db.prepare("UPDATE users SET role = 'staff' WHERE role = 'client'").run();
db.prepare("UPDATE users SET status = 'active' WHERE status IS NULL OR status = ''").run();
db.prepare("UPDATE users SET approved_at = COALESCE(approved_at, created_at), updated_at = COALESCE(updated_at, created_at)").run();

const firmAccessColumns = db.prepare('PRAGMA table_info(user_firm_access)').all().map((column) => column.name);
const addFirmAccessColumn = (name, definition) => {
  if (!firmAccessColumns.includes(name)) db.prepare(`ALTER TABLE user_firm_access ADD COLUMN ${name} ${definition}`).run();
};
addFirmAccessColumn('firm_role', "TEXT NOT NULL DEFAULT 'assistant'");
addFirmAccessColumn('phone', 'TEXT');
addFirmAccessColumn('job_title', 'TEXT');
addFirmAccessColumn('can_submit_claims', 'INTEGER NOT NULL DEFAULT 0');

export function serializeField(row) {
  if (!row) return null;
  return {
    ...row,
    page_number: Number(row.page_number),
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    required: Boolean(row.required),
    options: row.options_json ? JSON.parse(row.options_json) : []
  };
}

export function serializeTemplate(row) {
  if (!row) return null;
  return {
    ...row,
    page_count: Number(row.page_count),
    field_count: Number(row.field_count || 0)
  };
}

export function serializeDocument(row) {
  if (!row) return null;
  return {
    ...row,
    row_number: row.row_number == null ? null : Number(row.row_number),
    input: row.input_json ? JSON.parse(row.input_json) : {}
  };
}
