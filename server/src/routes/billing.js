import express from 'express';
import { config } from '../config.js';
import { db } from '../db/db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { openFirmDatabase } from '../services/firmDatabases.js';

export const billingRouter = express.Router();

billingRouter.use(authenticate);

function requireAdminOnly(req, res, next) {
  return requireAdmin(req, res, next);
}

function canReadFirmBilling(req, firm) {
  if (req.user?.role === 'admin') return true;
  const access = db.prepare(`
    SELECT id
    FROM user_firm_access
    WHERE user_id = ? AND firm_id = ?
  `).get(req.user.id, firm.id);
  return Boolean(access);
}

function getBillingRate() {
  const setting = db.prepare("SELECT value FROM app_settings WHERE key = 'billing_rate_per_application'").get();
  const rate = Number(setting?.value || config.billingRatePerApplication);
  return Number.isFinite(rate) && rate > 0 ? rate : config.billingRatePerApplication;
}

function setBillingRate(rate) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('billing_rate_per_application', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(String(rate));
}

function getFirmBillingRate(firm, defaultBillingRate) {
  const firmRate = Number(firm.billing_rate_per_application);
  return Number.isFinite(firmRate) && firmRate > 0 ? firmRate : defaultBillingRate;
}

function buildBillingPayload(firms) {
  const defaultBillingRate = getBillingRate();
  const rows = firms.map((firm) => getFirmBillingRow(firm, defaultBillingRate));
  const summary = rows.reduce((totals, row) => ({
    firms: totals.firms + 1,
    clients: totals.clients + row.clients,
    applications: totals.applications + row.applications,
    amount_due: totals.amount_due + row.amount_due
  }), { firms: 0, clients: 0, applications: 0, amount_due: 0 });

  return {
    rate_per_application: defaultBillingRate,
    summary,
    rows
  };
}

function getFirmBillingRow(firm, defaultBillingRate) {
  const firmDb = openFirmDatabase(firm);

  try {
    const billingRate = getFirmBillingRate(firm, defaultBillingRate);
    const clients = firmDb.prepare('SELECT COUNT(*) AS count FROM firm_clients').get().count;
    const applications = firmDb.prepare('SELECT COUNT(*) AS count FROM raf_cases').get().count;
    const openApplications = firmDb.prepare("SELECT COUNT(*) AS count FROM raf_cases WHERE status != 'closed'").get().count;
    const uploadedDocuments = firmDb.prepare('SELECT COUNT(*) AS count FROM client_uploads').get().count;
    const lastApplication = firmDb.prepare('SELECT MAX(opened_at) AS opened_at FROM raf_cases').get().opened_at;
    const amountDue = applications * billingRate;

    return {
      firm_id: firm.id,
      firm_name: firm.name,
      slug: firm.slug,
      status: firm.status,
      contact_email: firm.contact_email,
      custom_rate_per_application: firm.billing_rate_per_application == null ? null : billingRate,
      clients,
      applications,
      open_applications: openApplications,
      uploaded_documents: uploadedDocuments,
      rate_per_application: billingRate,
      amount_due: amountDue,
      last_application_at: lastApplication
    };
  } finally {
    firmDb.close();
  }
}

billingRouter.get('/firm/:id', (req, res) => {
  const firm = db.prepare('SELECT * FROM firms WHERE id = ? OR slug = ?').get(req.params.id, req.params.id);
  if (!firm) return res.status(404).json({ error: 'Firm not found' });
  if (!canReadFirmBilling(req, firm)) return res.status(403).json({ error: 'Access to this firm workspace is required' });

  const defaultBillingRate = getBillingRate();
  const row = getFirmBillingRow(firm, defaultBillingRate);

  res.json({
    rate_per_application: defaultBillingRate,
    summary: {
      firms: 1,
      clients: row.clients,
      applications: row.applications,
      amount_due: row.amount_due
    },
    rows: [row],
    firm: {
      id: firm.id,
      name: firm.name,
      slug: firm.slug,
      status: firm.status,
      contact_email: firm.contact_email
    }
  });
});

billingRouter.get('/', requireAdminOnly, (_req, res) => {
  const firms = db.prepare('SELECT * FROM firms ORDER BY name COLLATE NOCASE').all();
  res.json(buildBillingPayload(firms));
});

billingRouter.patch('/rate', requireAdminOnly, (req, res) => {
  const rate = Number(req.body?.rate_per_application);
  if (!Number.isFinite(rate) || rate <= 0) {
    return res.status(400).json({ error: 'Billing rate must be a positive number' });
  }

  setBillingRate(rate);
  const firms = db.prepare('SELECT * FROM firms ORDER BY name COLLATE NOCASE').all();
  return res.json(buildBillingPayload(firms));
});

billingRouter.patch('/firms/:id/rate', requireAdminOnly, (req, res) => {
  const rate = Number(req.body?.rate_per_application);
  if (!Number.isFinite(rate) || rate <= 0) {
    return res.status(400).json({ error: 'Firm billing rate must be a positive number' });
  }

  const result = db.prepare(`
    UPDATE firms
    SET billing_rate_per_application = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? OR slug = ?
  `).run(rate, req.params.id, req.params.id);

  if (result.changes === 0) return res.status(404).json({ error: 'Firm not found' });

  const firms = db.prepare('SELECT * FROM firms ORDER BY name COLLATE NOCASE').all();
  return res.json(buildBillingPayload(firms));
});
