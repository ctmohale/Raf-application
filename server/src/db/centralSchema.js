export const centralSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(320) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'staff',
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    approved_by_user_id BIGINT UNSIGNED NULL,
    approved_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_approver FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS firms (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    contact_name VARCHAR(255),
    contact_email VARCHAR(320),
    contact_phone VARCHAR(100),
    address TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    database_filename VARCHAR(255) NOT NULL UNIQUE,
    billing_rate_per_application DECIMAL(12,2),
    created_by_user_id BIGINT UNSIGNED,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_firms_status (status),
    CONSTRAINT fk_firms_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    \`key\` VARCHAR(191) PRIMARY KEY,
    value LONGTEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id BIGINT UNSIGNED NOT NULL,
    \`key\` VARCHAR(191) NOT NULL,
    value LONGTEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, \`key\`),
    CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_firm_access (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    firm_id BIGINT UNSIGNED NOT NULL,
    access_level VARCHAR(50) NOT NULL DEFAULT 'staff',
    firm_role VARCHAR(50) NOT NULL DEFAULT 'assistant',
    phone VARCHAR(100),
    job_title VARCHAR(255),
    can_submit_claims TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_firm_access (user_id, firm_id),
    INDEX idx_user_firm_access_user (user_id),
    INDEX idx_user_firm_access_firm (firm_id),
    CONSTRAINT fk_user_firm_access_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_firm_access_firm FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS firm_user_notifications (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    firm_id BIGINT UNSIGNED NOT NULL,
    case_id BIGINT UNSIGNED,
    notification_type VARCHAR(100) NOT NULL DEFAULT 'matter_assignment',
    message TEXT NOT NULL,
    read_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_firm_notifications_user (user_id, read_at, created_at),
    CONSTRAINT fk_firm_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_firm_notifications_firm FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE
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
    CONSTRAINT fk_templates_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS template_fields (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    template_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(255) NOT NULL,
    label VARCHAR(255) NOT NULL,
    page_number INT NOT NULL DEFAULT 1,
    x DOUBLE NOT NULL,
    y DOUBLE NOT NULL,
    width DOUBLE NOT NULL,
    height DOUBLE NOT NULL,
    field_type VARCHAR(50) NOT NULL DEFAULT 'text',
    required TINYINT(1) NOT NULL DEFAULT 0,
    default_value LONGTEXT,
    options_json LONGTEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_fields_template (template_id),
    CONSTRAINT fk_fields_template FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS field_mappings (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    template_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(255) NOT NULL,
    source_type VARCHAR(50) NOT NULL DEFAULT 'spreadsheet',
    mapping_json LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_mappings_template FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE CASCADE,
    CONSTRAINT fk_mappings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
    CONSTRAINT fk_docs_template FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE CASCADE,
    CONSTRAINT fk_docs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    template_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    last_used_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_api_keys_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_api_keys_template FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS firm_messages (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    firm_id BIGINT UNSIGNED NOT NULL,
    sender_type ENUM('admin', 'firm') NOT NULL,
    sender_name VARCHAR(255) NOT NULL,
    body LONGTEXT NOT NULL,
    read_by_admin TINYINT(1) NOT NULL DEFAULT 0,
    read_by_firm TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_firm_messages_firm (firm_id, created_at),
    CONSTRAINT fk_firm_messages_firm FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    level VARCHAR(50) NOT NULL DEFAULT 'info',
    event_type VARCHAR(100) NOT NULL DEFAULT 'request',
    action VARCHAR(255) NOT NULL,
    method VARCHAR(20),
    path TEXT,
    status_code INT,
    duration_ms INT,
    firm_id BIGINT UNSIGNED,
    firm_name VARCHAR(255),
    user_id BIGINT UNSIGNED,
    user_name VARCHAR(255),
    user_email VARCHAR(320),
    user_role VARCHAR(50),
    entity_type VARCHAR(100),
    entity_id VARCHAR(255),
    ip_address VARCHAR(100),
    user_agent TEXT,
    message LONGTEXT,
    metadata_json LONGTEXT,
    error_stack LONGTEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_activity_logs_created (created_at),
    INDEX idx_activity_logs_firm (firm_id, created_at),
    INDEX idx_activity_logs_level (level, created_at),
    INDEX idx_activity_logs_event (event_type, created_at),
    CONSTRAINT fk_activity_logs_firm FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE SET NULL,
    CONSTRAINT fk_activity_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );
`;
