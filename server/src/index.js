import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config, clientDistDir } from './config.js';
import './db/db.js';
import { activityLogger, logRequestError } from './services/activityLog.js';
import { activityLogsRouter } from './routes/activityLogs.js';
import { authRouter } from './routes/auth.js';
import { billingRouter } from './routes/billing.js';
import { clientPortalRouter } from './routes/clientPortal.js';
import { dashboardRouter } from './routes/dashboard.js';
import { documentsRouter } from './routes/documents.js';
import { firmsRouter } from './routes/firms.js';
import { templatesRouter } from './routes/templates.js';

const app = express();

app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
app.use(activityLogger);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'orc-document-automation' });
});

app.use('/api/auth', authRouter);
app.use('/api/activity-logs', activityLogsRouter);
app.use('/api/billing', billingRouter);
app.use('/api/client-portal', clientPortalRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/firms', firmsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/documents', documentsRouter);

if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDistDir, 'index.html'));
  });
}

app.use((error, req, res, _next) => {
  console.error(error);
  const status = error.status || 500;
  logRequestError(error, req, status);
  res.status(status).json({
    error: status === 500 ? 'Something went wrong' : error.message,
    detail: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
