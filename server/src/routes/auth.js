import express from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db/db.js';
import { signToken } from '../middleware/auth.js';
export const authRouter = express.Router();
async function getUserFirmAccess(userId) {
  return (await db.prepare(`
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
  `).all(userId)).map(access => ({
    ...access,
    can_submit_claims: Boolean(access.can_submit_claims)
  }));
}
async function getUserTheme(userId) {
  const setting = await db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND `key` = 'theme'").get(userId);
  return setting?.value === 'dark' ? 'dark' : 'light';
}
async function serializeAuthUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    theme: await getUserTheme(row.id),
    firm_access: await getUserFirmAccess(row.id)
  };
}
authRouter.post('/register', async (req, res) => {
  const {
    name,
    email,
    password
  } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({
      error: 'Name, email, and password are required'
    });
  }
  if (String(password).length < 8) {
    return res.status(400).json({
      error: 'Password must be at least 8 characters'
    });
  }
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (existing) return res.status(409).json({
    error: 'Email is already registered'
  });
  const userCount = (await db.prepare('SELECT COUNT(*) AS count FROM users').get()).count;
  const role = userCount === 0 ? 'admin' : 'staff';
  const status = userCount === 0 ? 'active' : 'pending';
  const passwordHash = bcrypt.hashSync(password, 12);
  const result = await db.prepare(`
    INSERT INTO users (name, email, password_hash, role, status, approved_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, String(email).toLowerCase(), passwordHash, role, status, status === 'active' ? new Date().toISOString() : null);
  const user = await serializeAuthUser(await db.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(result.lastInsertRowid));
  if (status !== 'active') {
    return res.status(201).json({
      user,
      pendingApproval: true,
      message: 'Account created. An administrator must approve your access before you can sign in.'
    });
  }
  return res.status(201).json({
    user,
    token: signToken(user)
  });
});
authRouter.post('/login', async (req, res) => {
  const {
    email,
    password
  } = req.body || {};
  if (!email || !password) return res.status(400).json({
    error: 'Email and password are required'
  });
  const row = await db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({
      error: 'Invalid email or password'
    });
  }
  if (row.status === 'pending') {
    return res.status(403).json({
      error: 'Your account is waiting for admin approval'
    });
  }
  if (row.status === 'suspended') {
    return res.status(403).json({
      error: 'Your account has been suspended by an administrator'
    });
  }
  const user = await serializeAuthUser(row);
  return res.json({
    user,
    token: signToken(user)
  });
});
