export const firmSchema = `
  CREATE TABLE IF NOT EXISTS firm_profile (
    id INT PRIMARY KEY,
    central_firm_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255),
    contact_email VARCHAR(320),
    contact_phone VARCHAR(100),
    address TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(320) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'client',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS document_templates (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(255) NOT NULL,
    original_filename VARCHAR(512) NOT NULL,
    stored_filename VARCHAR(512) NOT NULL,
    page_count INT NOT NULL DEFAULT 1,
    status VARCHAR(50) NOT NULL DEFAULT 'needs_setup',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_templates_user (user_id),
    CONSTRAINT fk_firm_templates_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS template_fields (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    template_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(255) NOT NULL,
    label VARCHAR(255) NOT NULL,
    page_number INT NOT NULL DEFAULT 1,
    x DOUBLE NOT NULL, y DOUBLE NOT NULL, width DOUBLE NOT NULL, height DOUBLE NOT NULL,
    field_type VARCHAR(50) NOT NULL DEFAULT 'text',
    required TINYINT(1) NOT NULL DEFAULT 0,
    default_value LONGTEXT,
    options_json LONGTEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_fields_template (template_id),
    CONSTRAINT fk_firm_fields_template FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS field_mappings (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    template_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(255) NOT NULL,
    source_type VARCHAR(50) NOT NULL DEFAULT 'spreadsheet',
    mapping_json LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_firm_mappings_template FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE CASCADE,
    CONSTRAINT fk_firm_mappings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS generated_documents (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    template_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    source_type VARCHAR(50) NOT NULL,
    file_name VARCHAR(512) NOT NULL,
    stored_filename VARCHAR(512) NOT NULL,
    input_json LONGTEXT NOT NULL,
    \`row_number\` INT,
    status VARCHAR(50) NOT NULL DEFAULT 'generated',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_docs_user (user_id),
    INDEX idx_docs_template (template_id),
    CONSTRAINT fk_firm_docs_template FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE CASCADE,
    CONSTRAINT fk_firm_docs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    template_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    last_used_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_firm_api_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_firm_api_template FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS firm_clients (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    first_name VARCHAR(255) NOT NULL,
    surname VARCHAR(255) NOT NULL,
    id_number VARCHAR(255) NOT NULL,
    cell VARCHAR(100) NOT NULL,
    email VARCHAR(320) NOT NULL,
    invite_token VARCHAR(255) NOT NULL UNIQUE,
    invite_sent_at DATETIME,
    auto_reminders_enabled TINYINT(1) NOT NULL DEFAULT 0,
    reminder_time VARCHAR(20) NOT NULL DEFAULT '09:00',
    next_reminder_at DATETIME,
    last_reminder_at DATETIME,
    passport_number VARCHAR(255),
    date_of_birth DATE,
    residential_address TEXT,
    occupation VARCHAR(255),
    employer_details TEXT,
    banking_json LONGTEXT,
    representative_json LONGTEXT,
    portal_templates_visible TINYINT(1) NOT NULL DEFAULT 1,
    portal_template_inputs_enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_clients_email (email),
    INDEX idx_clients_next_reminder (next_reminder_at)
  );

  CREATE TABLE IF NOT EXISTS raf_cases (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    client_id BIGINT UNSIGNED NOT NULL,
    matter_id BIGINT UNSIGNED,
    case_reference VARCHAR(255) NOT NULL UNIQUE,
    claim_type VARCHAR(100) NOT NULL DEFAULT 'RAF claim',
    accident_date DATE,
    accident_time VARCHAR(20),
    accident_location TEXT,
    police_station VARCHAR(255),
    police_case_number VARCHAR(255),
    claimant_role VARCHAR(100),
    collision_description LONGTEXT,
    vehicle_json LONGTEXT, driver_json LONGTEXT, owner_json LONGTEXT,
    witnesses_json LONGTEXT, claim_amounts_json LONGTEXT,
    statutory_form_set VARCHAR(255), required_forms_json LONGTEXT,
    lodgement_deadline DATE, internal_deadline DATE,
    deadline_status VARCHAR(100) NOT NULL DEFAULT 'attorney_review_required',
    lawyer_review_status VARCHAR(100) NOT NULL DEFAULT 'not_reviewed',
    original_tracking_json LONGTEXT,
    responsible_lawyer_user_id BIGINT UNSIGNED,
    assigned_assistant_user_id BIGINT UNSIGNED,
    ai_structured_json LONGTEXT, ai_summary LONGTEXT, ai_updated_at DATETIME,
    status VARCHAR(50) NOT NULL DEFAULT 'intake',
    opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cases_client (client_id),
    INDEX idx_cases_matter (matter_id),
    CONSTRAINT fk_cases_client FOREIGN KEY (client_id) REFERENCES firm_clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS matters (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    client_id BIGINT UNSIGNED NOT NULL,
    matter_reference VARCHAR(255) NOT NULL UNIQUE,
    matter_title VARCHAR(512) NOT NULL,
    matter_type VARCHAR(100) NOT NULL DEFAULT 'RAF matter',
    responsible_lawyer_user_id BIGINT UNSIGNED,
    assigned_assistant_user_id BIGINT UNSIGNED,
    status VARCHAR(50) NOT NULL DEFAULT 'open',
    priority VARCHAR(50) NOT NULL DEFAULT 'normal',
    opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deadline_json LONGTEXT, notes LONGTEXT, tasks_json LONGTEXT, documents_json LONGTEXT,
    linked_raf_case_id BIGINT UNSIGNED UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_matters_client (client_id),
    INDEX idx_matters_lawyer (responsible_lawyer_user_id),
    INDEX idx_matters_assistant (assigned_assistant_user_id),
    CONSTRAINT fk_matters_client FOREIGN KEY (client_id) REFERENCES firm_clients(id) ON DELETE CASCADE,
    CONSTRAINT fk_matters_case FOREIGN KEY (linked_raf_case_id) REFERENCES raf_cases(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS client_document_requests (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    client_id BIGINT UNSIGNED NOT NULL,
    case_id BIGINT UNSIGNED NOT NULL,
    document_type VARCHAR(255) NOT NULL,
    label VARCHAR(255) NOT NULL,
    instructions TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'requested',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_doc_requests_client (client_id),
    CONSTRAINT fk_requests_client FOREIGN KEY (client_id) REFERENCES firm_clients(id) ON DELETE CASCADE,
    CONSTRAINT fk_requests_case FOREIGN KEY (case_id) REFERENCES raf_cases(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS client_uploads (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    request_id BIGINT UNSIGNED NOT NULL,
    client_id BIGINT UNSIGNED NOT NULL,
    original_filename VARCHAR(512) NOT NULL,
    stored_filename VARCHAR(512) NOT NULL,
    mime_type VARCHAR(255),
    file_size BIGINT,
    ai_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    ai_model VARCHAR(255), ai_extracted_json LONGTEXT, ai_summary LONGTEXT,
    ai_error LONGTEXT, ai_processed_at DATETIME,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_uploads_client (client_id),
    CONSTRAINT fk_uploads_request FOREIGN KEY (request_id) REFERENCES client_document_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_uploads_client FOREIGN KEY (client_id) REFERENCES firm_clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS client_email_logs (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    client_id BIGINT UNSIGNED NOT NULL,
    subject VARCHAR(512) NOT NULL,
    body LONGTEXT NOT NULL,
    recipient_email VARCHAR(320) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email_logs_client (client_id),
    CONSTRAINT fk_email_logs_client FOREIGN KEY (client_id) REFERENCES firm_clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS claim_form_templates (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    case_id BIGINT UNSIGNED NOT NULL,
    template_id BIGINT UNSIGNED NOT NULL,
    generated_document_id BIGINT UNSIGNED,
    status VARCHAR(50) NOT NULL DEFAULT 'generated',
    client_portal_visible TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_claim_form (case_id, template_id),
    INDEX idx_claim_forms_template (template_id),
    CONSTRAINT fk_claim_forms_case FOREIGN KEY (case_id) REFERENCES raf_cases(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS medical_assessment_requests (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    case_id BIGINT UNSIGNED NOT NULL,
    client_id BIGINT UNSIGNED NOT NULL,
    report_type VARCHAR(255) NOT NULL,
    doctor_name VARCHAR(255) NOT NULL,
    practice_number VARCHAR(255), doctor_email VARCHAR(320), doctor_phone VARCHAR(100),
    deadline DATE, delivery_method VARCHAR(50) NOT NULL DEFAULT 'email',
    secure_token VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'requested',
    sent_at DATETIME, assessment_json LONGTEXT, submitted_at DATETIME,
    inherit_client_information TINYINT(1) NOT NULL DEFAULT 1,
    lock_prefilled_fields TINYINT(1) NOT NULL DEFAULT 1,
    hide_prefilled_fields TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_medical_assessments_case (case_id),
    CONSTRAINT fk_medical_case FOREIGN KEY (case_id) REFERENCES raf_cases(id) ON DELETE CASCADE,
    CONSTRAINT fk_medical_client FOREIGN KEY (client_id) REFERENCES firm_clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS firm_doctors (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    full_name VARCHAR(255) NOT NULL,
    practice_number VARCHAR(255), email VARCHAR(320), phone VARCHAR(100),
    specialty VARCHAR(255), relationship_notes LONGTEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_firm_doctors_status (status)
  );

  CREATE TABLE IF NOT EXISTS matter_assignment_history (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    matter_id BIGINT UNSIGNED,
    case_id BIGINT UNSIGNED NOT NULL,
    previous_lawyer_user_id BIGINT UNSIGNED,
    previous_assistant_user_id BIGINT UNSIGNED,
    responsible_lawyer_user_id BIGINT UNSIGNED,
    assigned_assistant_user_id BIGINT UNSIGNED,
    assigned_by_user_id BIGINT UNSIGNED NOT NULL,
    assignment_note TEXT, reason TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_assignment_history_case (case_id, created_at),
    CONSTRAINT fk_assignment_case FOREIGN KEY (case_id) REFERENCES raf_cases(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS firm_schema_migrations (
    name VARCHAR(191) PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;
