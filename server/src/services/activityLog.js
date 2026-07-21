import { db } from '../db/db.js';
const SENSITIVE_KEY_PATTERN = /(password|token|secret|api[_-]?key|authorization|signature|data_url|base64|file|pdf|image)/i;
const MAX_STRING_LENGTH = 300;
function safeJson(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      note: 'Unable to serialize metadata'
    });
  }
}
function sanitizeValue(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[redacted]';
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 25).map(item => sanitizeValue(item));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 50).map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, entryKey)]));
  }
  return value;
}
function getPathname(req) {
  return req.originalUrl?.split('?')[0] || req.path || '';
}
function getFirmIdentifierFromPath(pathname) {
  const patterns = [/^\/api\/firms\/([^/]+)/, /^\/api\/billing\/firm\/([^/]+)/, /^\/api\/billing\/firms\/([^/]+)/];
  for (const pattern of patterns) {
    const match = pathname.match(pattern);
    const identifier = match?.[1];
    if (!identifier || ['messages', 'overview'].includes(identifier)) continue;
    return identifier;
  }
  return null;
}
async function getFirmFromRequest(req) {
  const explicitFirmId = req.params?.firmId || req.params?.id || req.body?.firm_id || req.query?.firm_id;
  const identifier = explicitFirmId || getFirmIdentifierFromPath(getPathname(req));
  if (!identifier) return null;
  try {
    return (await db.prepare('SELECT id, name FROM firms WHERE id = ? OR slug = ?').get(identifier, identifier)) || null;
  } catch {
    return null;
  }
}
function getMetadata(req) {
  const metadata = {};
  if (req.query && Object.keys(req.query).length) metadata.query = sanitizeValue(req.query);
  if (req.params && Object.keys(req.params).length) metadata.params = sanitizeValue(req.params);
  if (req.body && Object.keys(req.body).length) metadata.body = sanitizeValue(req.body);
  if (req.apiKey?.id) metadata.api_key_id = req.apiKey.id;
  return Object.keys(metadata).length ? metadata : null;
}
export async function logActivity(entry) {
  try {
    await db.prepare(`
      INSERT INTO activity_logs (
        level, event_type, action, method, path, status_code, duration_ms,
        firm_id, firm_name, user_id, user_name, user_email, user_role,
        entity_type, entity_id, ip_address, user_agent, message,
        metadata_json, error_stack
      )
      VALUES (
        :level, :event_type, :action, :method, :path, :status_code, :duration_ms,
        :firm_id, :firm_name, :user_id, :user_name, :user_email, :user_role,
        :entity_type, :entity_id, :ip_address, :user_agent, :message,
        :metadata_json, :error_stack
      )
    `).run({
      level: entry.level || 'info',
      event_type: entry.event_type || 'request',
      action: entry.action || 'Activity',
      method: entry.method || null,
      path: entry.path || null,
      status_code: entry.status_code ?? null,
      duration_ms: entry.duration_ms ?? null,
      firm_id: entry.firm_id ?? null,
      firm_name: entry.firm_name || null,
      user_id: entry.user_id ?? null,
      user_name: entry.user_name || null,
      user_email: entry.user_email || null,
      user_role: entry.user_role || null,
      entity_type: entry.entity_type || null,
      entity_id: entry.entity_id == null ? null : String(entry.entity_id),
      ip_address: entry.ip_address || null,
      user_agent: entry.user_agent || null,
      message: entry.message || null,
      metadata_json: typeof entry.metadata_json === 'string' ? entry.metadata_json : safeJson(entry.metadata),
      error_stack: entry.error_stack || null
    });
  } catch (error) {
    console.warn('Unable to write activity log:', error.message);
  }
}
export function activityLogger(req, res, next) {
  const pathname = getPathname(req);
  if (!pathname.startsWith('/api') || pathname === '/api/health') return next();
  const startedAt = Date.now();
  res.on('finish', async () => {
    const durationMs = Date.now() - startedAt;
    const statusCode = res.statusCode;
    const user = req.user || {};
    const firm = await getFirmFromRequest(req);
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    const action = `${req.method} ${pathname}`;
    await logActivity({
      level,
      event_type: 'request',
      action,
      method: req.method,
      path: pathname,
      status_code: statusCode,
      duration_ms: durationMs,
      firm_id: firm?.id,
      firm_name: firm?.name,
      user_id: user.id,
      user_name: user.name,
      user_email: user.email,
      user_role: user.role,
      ip_address: req.ip,
      user_agent: req.get('user-agent'),
      message: `${action} returned ${statusCode} in ${durationMs}ms`,
      metadata: getMetadata(req)
    });
  });
  return next();
}
export async function logRequestError(error, req, statusCode = 500) {
  const pathname = getPathname(req);
  if (!pathname.startsWith('/api')) return;
  const user = req.user || {};
  const firm = await getFirmFromRequest(req);
  await logActivity({
    level: 'error',
    event_type: 'error',
    action: 'Unhandled API error',
    method: req.method,
    path: pathname,
    status_code: statusCode,
    firm_id: firm?.id,
    firm_name: firm?.name,
    user_id: user.id,
    user_name: user.name,
    user_email: user.email,
    user_role: user.role,
    ip_address: req.ip,
    user_agent: req.get('user-agent'),
    message: error?.message || 'Unhandled server error',
    metadata: getMetadata(req),
    error_stack: error?.stack || null
  });
}
