import fs from 'node:fs';
import path from 'node:path';
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config, clientDistDir } from './config.js';
import { db, initializeDatabase } from './db/db.js';
import { activityLogger, logRequestError } from './services/activityLog.js';
import { activityLogsRouter } from './routes/activityLogs.js';
import { authRouter } from './routes/auth.js';
import { billingRouter } from './routes/billing.js';
import { clientPortalRouter } from './routes/clientPortal.js';
import { dashboardRouter } from './routes/dashboard.js';
import { documentsRouter } from './routes/documents.js';
import { firmsRouter } from './routes/firms.js';
import { medicalAssessmentsRouter } from './routes/medicalAssessments.js';
import { templatesRouter } from './routes/templates.js';
import { usersRouter } from './routes/users.js';
import { closeFirmDatabases } from './services/firmDatabases.js';
const app = express();
await initializeDatabase();
app.use(cors({
  origin: config.clientOrigin,
  credentials: true
}));
app.use(express.json({
  limit: '2mb'
}));
app.use(morgan('dev'));
app.use(activityLogger);
app.get('/api/health', async (_req, res) => {
  try {
    await db.prepare('SELECT 1').get();
    res.json({
      ok: true,
      service: 'orc-document-automation',
      database: 'connected'
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      service: 'orc-document-automation',
      database: 'unavailable'
    });
  }
});
app.use('/api/auth', authRouter);
app.use('/api/activity-logs', activityLogsRouter);
app.use('/api/billing', billingRouter);
app.use('/api/client-portal', clientPortalRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/firms', firmsRouter);
app.use('/api/medical-assessments', medicalAssessmentsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/users', usersRouter);
app.use('/api/documents', documentsRouter);
if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDistDir, 'index.html'));
  });
}
app.use(async (error, req, res, _next) => {
  console.error(error);
  const status = error.status || 500;
  await logRequestError(error, req, status);
  res.status(status).json({
    error: status === 500 ? 'Something went wrong' : error.message,
    detail: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await closeFirmDatabases();
    await db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
