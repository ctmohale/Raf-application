import express from 'express';
import { config } from '../config.js';
import { db, serializeDocument, serializeTemplate } from '../db/db.js';
import { authenticate } from '../middleware/auth.js';
import { openFirmDatabase } from '../services/firmDatabases.js';

export const dashboardRouter = express.Router();

function getBillingRate() {
  const setting = db.prepare("SELECT value FROM app_settings WHERE key = 'billing_rate_per_application'").get();
  const rate = Number(setting?.value || config.billingRatePerApplication);
  return Number.isFinite(rate) && rate > 0 ? rate : config.billingRatePerApplication;
}

function getFirmBillingRate(firm, defaultBillingRate) {
  const firmRate = Number(firm.billing_rate_per_application);
  return Number.isFinite(firmRate) && firmRate > 0 ? firmRate : defaultBillingRate;
}

function getYearMonthBuckets() {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const year = new Date().getFullYear();

  return monthNames.map((monthName, index) => {
    const month = index + 1;
    return {
      key: `${year}-${String(month).padStart(2, '0')}`,
      month: monthName,
      applications: 0
    };
  });
}

function getFirmAnalyticsRow(firm, defaultBillingRate, monthKeys) {
  const firmDb = openFirmDatabase(firm);

  try {
    const billingRate = getFirmBillingRate(firm, defaultBillingRate);
    const clients = firmDb.prepare('SELECT COUNT(*) AS count FROM firm_clients').get().count;
    const applications = firmDb.prepare('SELECT COUNT(*) AS count FROM raf_cases').get().count;
    const openApplications = firmDb.prepare("SELECT COUNT(*) AS count FROM raf_cases WHERE status != 'closed'").get().count;
    const uploadedDocuments = firmDb.prepare('SELECT COUNT(*) AS count FROM client_uploads').get().count;
    const pendingDocumentRequests = firmDb.prepare("SELECT COUNT(*) AS count FROM client_document_requests WHERE status = 'requested'").get().count;
    const lastApplication = firmDb.prepare('SELECT MAX(opened_at) AS opened_at FROM raf_cases').get().opened_at;
    const monthlyRows = firmDb.prepare(`
      SELECT strftime('%Y-%m', opened_at) AS month_key, COUNT(*) AS applications
      FROM raf_cases
      GROUP BY month_key
    `).all();

    const monthlyApplications = monthlyRows
      .filter((row) => monthKeys.has(row.month_key))
      .map((row) => ({
        key: row.month_key,
        applications: row.applications
      }));

    return {
      firm_id: firm.id,
      firm_name: firm.name,
      slug: firm.slug,
      status: firm.status,
      contact_email: firm.contact_email,
      clients,
      applications,
      open_applications: openApplications,
      uploaded_documents: uploadedDocuments,
      pending_document_requests: pendingDocumentRequests,
      rate_per_application: billingRate,
      amount_due: applications * billingRate,
      last_application_at: lastApplication,
      monthly_applications: monthlyApplications
    };
  } finally {
    firmDb.close();
  }
}

function getAdminDashboardPayload() {
  const defaultBillingRate = getBillingRate();
  const monthBuckets = getYearMonthBuckets();
  const monthKeys = new Set(monthBuckets.map((bucket) => bucket.key));
  const firms = db.prepare('SELECT * FROM firms ORDER BY name COLLATE NOCASE').all();
  const rows = firms.map((firm) => getFirmAnalyticsRow(firm, defaultBillingRate, monthKeys));

  for (const row of rows) {
    for (const month of row.monthly_applications) {
      const bucket = monthBuckets.find((item) => item.key === month.key);
      if (bucket) bucket.applications += month.applications;
    }
  }

  const summary = rows.reduce((totals, row) => ({
    firms: totals.firms + 1,
    active_firms: totals.active_firms + (row.status === 'active' ? 1 : 0),
    clients: totals.clients + row.clients,
    applications: totals.applications + row.applications,
    open_applications: totals.open_applications + row.open_applications,
    uploaded_documents: totals.uploaded_documents + row.uploaded_documents,
    pending_document_requests: totals.pending_document_requests + row.pending_document_requests,
    amount_due: totals.amount_due + row.amount_due
  }), {
    firms: 0,
    active_firms: 0,
    clients: 0,
    applications: 0,
    open_applications: 0,
    uploaded_documents: 0,
    pending_document_requests: 0,
    amount_due: 0
  });

  return {
    dashboard_mode: 'admin',
    rate_per_application: defaultBillingRate,
    firm_summary: summary,
    firm_rows: rows.sort((a, b) => b.amount_due - a.amount_due || b.applications - a.applications),
    monthly_applications: monthBuckets.map(({ month, applications }) => ({ month, applications }))
  };
}

dashboardRouter.get('/', authenticate, (req, res) => {
  if (req.user.role === 'admin') {
    return res.json(getAdminDashboardPayload());
  }

  const totalTemplates = db.prepare('SELECT COUNT(*) AS count FROM document_templates WHERE user_id = ?').get(req.user.id).count;
  const totalDocuments = db.prepare('SELECT COUNT(*) AS count FROM generated_documents WHERE user_id = ?').get(req.user.id).count;
  const templatesNeedingSetup = db.prepare(`
    SELECT COUNT(*) AS count
    FROM document_templates
    WHERE user_id = ? AND status != 'ready'
  `).get(req.user.id).count;
  const recentDocuments = db.prepare(`
    SELECT generated_documents.*, document_templates.name AS template_name
    FROM generated_documents
    JOIN document_templates ON document_templates.id = generated_documents.template_id
    WHERE generated_documents.user_id = ?
    ORDER BY generated_documents.created_at DESC
    LIMIT 5
  `).all(req.user.id).map(serializeDocument);
  const setupTemplates = db.prepare(`
    SELECT document_templates.*, COUNT(template_fields.id) AS field_count
    FROM document_templates
    LEFT JOIN template_fields ON template_fields.template_id = document_templates.id
    WHERE document_templates.user_id = ? AND document_templates.status != 'ready'
    GROUP BY document_templates.id
    ORDER BY document_templates.created_at DESC
    LIMIT 5
  `).all(req.user.id).map(serializeTemplate);

  res.json({
    totalTemplates,
    totalDocuments,
    templatesNeedingSetup,
    estimatedManualMinutesSaved: totalDocuments * 12,
    recentDocuments,
    setupTemplates
  });
});
