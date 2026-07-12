import express from 'express';
import { db } from '../db/db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

export const activityLogsRouter = express.Router();

activityLogsRouter.use(authenticate, requireAdmin);

function parseLimit(value) {
  const limit = Number(value || 100);
  if (!Number.isFinite(limit)) return 100;
  return Math.max(1, Math.min(200, Math.trunc(limit)));
}

function parseOffset(value) {
  const offset = Number(value || 0);
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.trunc(offset);
}

function parseMetadata(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildFilters(query) {
  const clauses = [];
  const params = {};

  if (query.level && query.level !== 'all') {
    clauses.push('level = @level');
    params.level = query.level;
  }

  if (query.event_type && query.event_type !== 'all') {
    clauses.push('event_type = @event_type');
    params.event_type = query.event_type;
  }

  if (query.firm_id && query.firm_id !== 'all') {
    clauses.push('firm_id = @firm_id');
    params.firm_id = query.firm_id;
  }

  if (query.method && query.method !== 'all') {
    clauses.push('method = @method');
    params.method = query.method;
  }

  if (query.status && query.status !== 'all') {
    clauses.push('status_code = @status_code');
    params.status_code = Number(query.status);
  }

  const search = String(query.q || '').trim();
  if (search) {
    clauses.push(`(
      action LIKE @search OR path LIKE @search OR message LIKE @search OR
      user_name LIKE @search OR user_email LIKE @search OR firm_name LIKE @search
    )`);
    params.search = `%${search}%`;
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

function serializeLog(row) {
  return {
    ...row,
    metadata: parseMetadata(row.metadata_json)
  };
}

activityLogsRouter.get('/', (req, res) => {
  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);
  const { where, params } = buildFilters(req.query);
  const queryParams = { ...params, limit, offset };

  const logs = db.prepare(`
    SELECT *
    FROM activity_logs
    ${where}
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT @limit OFFSET @offset
  `).all(queryParams).map(serializeLog);

  const countRow = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN level = 'warn' THEN 1 ELSE 0 END) AS warnings,
      SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS today,
      COUNT(DISTINCT firm_id) AS firm_count
    FROM activity_logs
    ${where}
  `).get(params);

  const levels = db.prepare(`
    SELECT level, COUNT(*) AS count
    FROM activity_logs
    ${where}
    GROUP BY level
  `).all(params);

  const firms = db.prepare(`
    SELECT id, name, slug
    FROM firms
    ORDER BY name COLLATE NOCASE
  `).all();

  res.json({
    logs,
    summary: {
      total: Number(countRow.total || 0),
      errors: Number(countRow.errors || 0),
      warnings: Number(countRow.warnings || 0),
      today: Number(countRow.today || 0),
      firm_count: Number(countRow.firm_count || 0),
      levels,
      firms,
      limit,
      offset
    }
  });
});
