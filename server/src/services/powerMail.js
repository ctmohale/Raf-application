import { config } from '../config.js';

function requirePowerMailConfig() {
  if (!config.powerMailApiKey) {
    const error = new Error('PowerMail API key is not configured');
    error.status = 503;
    throw error;
  }
  if (!config.powerMailFromEmail) {
    const error = new Error('PowerMail sender email is not configured');
    error.status = 503;
    throw error;
  }
}

export async function sendPowerMail({ to, subject, body, data = {}, templateKey = config.powerMailTemplateKey }) {
  requirePowerMailConfig();

  const payload = {
    from_email: config.powerMailFromEmail,
    to,
    data: {
      subject,
      body,
      ...data
    }
  };

  if (templateKey) payload.template_key = templateKey;
  else {
    payload.subject = subject;
    payload.body = body;
  }

  const response = await fetch(`${config.powerMailBaseUrl.replace(/\/$/, '')}/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.powerMailApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = result?.error || result?.message || 'PowerMail send failed';
    const error = new Error(message);
    error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw error;
  }

  return result;
}
