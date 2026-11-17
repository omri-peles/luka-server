// Sending email from the owner's Gmail (tablet agent only).
// Active only after the owner approves the extra permission once at /auth/google/more .
import { google } from 'googleapis';
import { oauthClient } from './google.js';
import { get, set } from './store.js';
import { confirmed, ASK } from './gate.js';

export const mailOn = () => { const g = get('google'); return !!(g && g.refresh_token && /gmail\.send/.test(g.scope || '')); };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

export async function sendEmail(to, subject, body) {
  to = (to || '').toString().trim(); subject = (subject || '').toString().trim().slice(0, 200); body = (body || '').toString().trim();
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) return 'לא נשלח: כתובת המייל לא תקינה. צריך כתובת מלאה אחת.';
  if (!subject || !body) return 'לא נשלח: חסר נושא או תוכן.';
  if (!confirmed('mail:' + to + '|' + subject)) return ASK(`מייל אל ${to}, בנושא "${subject}", עם התוכן: ${body.slice(0, 400)}`);
  try {
    const c = oauthClient(); c.setCredentials(get('google'));
    c.on('tokens', (t) => set('google', { ...(get('google') || {}), ...t }));
    const raw = [`To: ${to}`, `Subject: =?UTF-8?B?${b64(subject)}?=`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(body)].join('\r\n');
    await google.gmail({ version: 'v1', auth: c }).users.messages.send({ userId: 'me', requestBody: { raw: Buffer.from(raw).toString('base64url') } });
    return `המייל נשלח אל ${to}.`;
  } catch (e) { return 'המייל לא נשלח: ' + String(e.message || e).slice(0, 200); }
}
