import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { db } from './db.js';

export async function ensureBootstrapAdmin() {
  const useRenderDemoDefaults = process.env.NODE_ENV === 'production' && config.databaseDriver === 'sqlite';
  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || (useRenderDemoDefaults ? 'demo@example.com' : '')).trim().toLowerCase();
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || (useRenderDemoDefaults ? 'password123' : ''));
  const name = String(process.env.BOOTSTRAP_ADMIN_NAME || 'Demo Admin').trim();

  if (!email && !password) return;
  if (!email || password.length < 8) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL and a BOOTSTRAP_ADMIN_PASSWORD of at least 8 characters are required');
  }

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    await db.prepare(`
      UPDATE users
      SET role = 'admin', status = 'active', approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(existing.id);
    return;
  }

  await db.prepare(`
    INSERT INTO users (name, email, password_hash, role, status, approved_at)
    VALUES (?, ?, ?, 'admin', 'active', CURRENT_TIMESTAMP)
  `).run(name, email, bcrypt.hashSync(password, 12));
  console.log(`Bootstrap administrator created for ${email}`);
}
