import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/db.js';
export function signToken(user) {
  return jwt.sign({
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status
  }, config.jwtSecret, {
    expiresIn: '7d'
  });
}
export function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}
export async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({
    error: 'Authentication required'
  });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await db.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({
      error: 'Invalid session'
    });
    if (user.status !== 'active') return res.status(403).json({
      error: 'Account access is not active'
    });
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({
      error: 'Invalid or expired token'
    });
  }
}
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      error: 'Admin access required'
    });
  }
  return next();
}
export async function authenticateJwtOrApiKey(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) return await authenticate(req, res, next);
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || typeof apiKey !== 'string') {
    return res.status(401).json({
      error: 'Authentication or x-api-key required'
    });
  }
  const keyHash = hashApiKey(apiKey);
  const record = await db.prepare(`
    SELECT api_keys.*, users.email, users.name AS user_name, users.role
      , users.status AS user_status
    FROM api_keys
    JOIN users ON users.id = api_keys.user_id
    WHERE api_keys.key_hash = ?
  `).get(keyHash);
  if (!record) return res.status(401).json({
    error: 'Invalid API key'
  });
  if (record.user_status !== 'active') return res.status(403).json({
    error: 'Account access is not active'
  });
  await db.prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(record.id);
  req.user = {
    id: record.user_id,
    email: record.email,
    name: record.user_name,
    role: record.role,
    status: record.user_status
  };
  req.apiKey = record;
  return next();
}
