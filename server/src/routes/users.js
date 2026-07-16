import express from 'express';
import { db } from '../db/db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

export const usersRouter = express.Router();

const allowedRoles = new Set(['admin', 'staff', 'viewer']);
const allowedStatuses = new Set(['pending', 'active', 'suspended']);
const allowedFirmAccessLevels = new Set(['staff', 'viewer']);
const allowedThemes = new Set(['light', 'dark']);

function serializeUser(row) {
  const firmAccess = db.prepare(`
    SELECT
      user_firm_access.firm_id,
      user_firm_access.access_level,
      user_firm_access.firm_role,
      user_firm_access.phone,
      user_firm_access.job_title,
      user_firm_access.can_submit_claims,
      firms.name AS firm_name,
      firms.slug AS firm_slug
    FROM user_firm_access
    JOIN firms ON firms.id = user_firm_access.firm_id
    WHERE user_firm_access.user_id = ?
    ORDER BY firms.name COLLATE NOCASE
  `).all(row.id).map((access) => ({
    ...access,
    can_submit_claims: Boolean(access.can_submit_claims)
  }));

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    approved_by_user_id: row.approved_by_user_id,
    approved_at: row.approved_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    firm_access: firmAccess
  };
}

function listUsers() {
  return db.prepare(`
    SELECT id, name, email, role, status, approved_by_user_id, approved_at, created_at, updated_at
    FROM users
    ORDER BY
      CASE status
        WHEN 'pending' THEN 0
        WHEN 'active' THEN 1
        ELSE 2
      END,
      created_at DESC
  `).all().map(serializeUser);
}

function activeAdminCount(excludeUserId = null) {
  const params = excludeUserId ? { excludeUserId } : {};
  const excludeClause = excludeUserId ? 'AND id != @excludeUserId' : '';
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM users
    WHERE role = 'admin' AND status = 'active' ${excludeClause}
  `).get(params).count;
}

usersRouter.get('/me/settings', authenticate, (req, res) => {
  const setting = db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'theme'").get(req.user.id);
  return res.json({ settings: { theme: setting?.value === 'dark' ? 'dark' : 'light' } });
});

usersRouter.patch('/me/settings', authenticate, (req, res) => {
  const theme = String(req.body?.theme || '').trim();
  if (!allowedThemes.has(theme)) return res.status(400).json({ error: 'Choose light or dark theme' });

  db.prepare(`
    INSERT INTO user_settings (user_id, key, value, updated_at)
    VALUES (?, 'theme', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(req.user.id, theme);

  return res.json({ settings: { theme } });
});

usersRouter.use(authenticate, requireAdmin);

usersRouter.get('/', (_req, res) => {
  const firms = db.prepare(`
    SELECT id, name, slug, status
    FROM firms
    ORDER BY name COLLATE NOCASE
  `).all();
  res.json({ users: listUsers(), firms });
});

usersRouter.patch('/:id/access', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const role = String(req.body?.role || target.role).trim();
  const status = String(req.body?.status || target.status).trim();
  const hasFirmId = req.body?.firm_id !== null && req.body?.firm_id !== undefined && req.body?.firm_id !== '';
  const firmId = hasFirmId ? Number(req.body.firm_id) : null;
  const firmAccessLevel = String(req.body?.firm_access_level || 'staff').trim();
  if (!allowedRoles.has(role)) return res.status(400).json({ error: 'Choose a valid access role' });
  if (!allowedStatuses.has(status)) return res.status(400).json({ error: 'Choose a valid account status' });
  if (hasFirmId && (!Number.isInteger(firmId) || firmId < 1)) return res.status(400).json({ error: 'Choose a valid law firm workspace' });
  if (firmId && !allowedFirmAccessLevels.has(firmAccessLevel)) return res.status(400).json({ error: 'Choose a valid firm access level' });

  if (firmId) {
    const firm = db.prepare('SELECT id FROM firms WHERE id = ?').get(firmId);
    if (!firm) return res.status(400).json({ error: 'Choose a valid law firm workspace' });
  }

  const isSelf = Number(target.id) === Number(req.user.id);
  const removesAdminAccess = target.role === 'admin' && (role !== 'admin' || status !== 'active');
  if (isSelf && (role !== target.role || status !== target.status)) {
    return res.status(400).json({ error: 'Ask another active admin to change your own access' });
  }
  if (removesAdminAccess && activeAdminCount(target.id) < 1) {
    return res.status(400).json({ error: 'At least one active admin is required' });
  }

  const approvedAt = status === 'active'
    ? target.approved_at || new Date().toISOString()
    : target.approved_at;
  const approvedBy = status === 'active'
    ? target.approved_by_user_id || req.user.id
    : target.approved_by_user_id;
  const effectiveFirmAccessLevel = role === 'viewer' ? 'viewer' : firmAccessLevel;

  const updateAccess = db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET role = ?, status = ?, approved_by_user_id = ?, approved_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(role, status, approvedBy, approvedAt, target.id);

    db.prepare('DELETE FROM user_firm_access WHERE user_id = ?').run(target.id);
    if (firmId && role !== 'admin') {
      db.prepare(`
        INSERT INTO user_firm_access (user_id, firm_id, access_level)
        VALUES (?, ?, ?)
      `).run(target.id, firmId, effectiveFirmAccessLevel);
    }
  });
  updateAccess();

  const user = db.prepare(`
    SELECT id, name, email, role, status, approved_by_user_id, approved_at, created_at, updated_at
    FROM users
    WHERE id = ?
  `).get(target.id);

  return res.json({ user: serializeUser(user), users: listUsers() });
});
