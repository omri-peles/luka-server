// Read-only access to the owner's Google Drive (tablet agent only).
// Active only after the owner approves Drive access once at /auth/google/drive .
// Uses the same Google connection as the calendar and mail; nothing in google.js changes.
import { google } from 'googleapis';
import { oauthClient } from './google.js';
import { get, set } from './store.js';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/drive.readonly'];
const MORE = [...SCOPES, 'https://www.googleapis.com/auth/gmail.send'];
export const driveOn = () => { const g = get('google'); return !!(g && g.refresh_token && /drive/.test(g.scope || '')); };

function drive() {
  const g = get('google'); const c = oauthClient(); c.setCredentials(g);
  c.on('tokens', (t) => set('google', { ...(get('google') || {}), ...t }));
  return google.drive({ version: 'v3', auth: c });
}
export function mountDrive(app) {
  // The approval link. The answer comes back to the existing /auth/google/callback.
  app.get('/auth/google/drive', (_req, res) => res.redirect(oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES })));
  app.get('/auth/google/more', (_req, res) => res.redirect(oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: MORE })));
}
const KIND = { 'application/vnd.google-apps.document': 'מסמך', 'application/vnd.google-apps.spreadsheet': 'גיליון', 'application/vnd.google-apps.presentation': 'מצגת', 'application/pdf': 'PDF', 'application/vnd.google-apps.folder': 'תיקייה' };

export async function driveSearch(query) {
  try {
    const q = (query || '').toString().replace(/['\\]/g, ' ').trim();
    const r = await drive().files.list({ q: (q ? `(name contains '${q}' or fullText contains '${q}') and ` : '') + 'trashed = false', orderBy: q ? undefined : 'modifiedTime desc', pageSize: 12, fields: 'files(id,name,mimeType,modifiedTime)' });
    const f = r.data.files || [];
    if (!f.length) return 'לא נמצאו קבצים מתאימים בדרייב.';
    return f.map(x => `- ${x.name} (${KIND[x.mimeType] || 'קובץ'}, עודכן ${String(x.modifiedTime).slice(0, 10)}) id: ${x.id}`).join('\n');
  } catch (e) { return 'לא הצלחתי לחפש בדרייב: ' + String(e.message || e).slice(0, 200); }
}
export async function driveRead(id) {
  try {
    const d = drive(); id = (id || '').toString().trim();
    const meta = (await d.files.get({ fileId: id, fields: 'id,name,mimeType,size' })).data;
    const t = meta.mimeType; const cap = (s) => String(s).slice(0, 24000);
    if (t === 'application/vnd.google-apps.document' || t === 'application/vnd.google-apps.presentation')
      return `הקובץ "${meta.name}":\n` + cap((await d.files.export({ fileId: id, mimeType: 'text/plain' }, { responseType: 'text' })).data);
    if (t === 'application/vnd.google-apps.spreadsheet')
      return `הגיליון "${meta.name}" (הלשונית הראשונה, CSV):\n` + cap((await d.files.export({ fileId: id, mimeType: 'text/csv' }, { responseType: 'text' })).data);
    if (/^text\/|json|csv|xml/.test(t))
      return `הקובץ "${meta.name}":\n` + cap((await d.files.get({ fileId: id, alt: 'media' }, { responseType: 'text' })).data);
    if (t === 'application/pdf') {
      if (Number(meta.size) > 4 * 1024 * 1024) return `הקובץ "${meta.name}" הוא PDF גדול מ-4 מגה, ואיני יכולה לקרוא אותו.`;
      const buf = Buffer.from((await d.files.get({ fileId: id, alt: 'media' }, { responseType: 'arraybuffer' })).data);
      return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }, { type: 'text', text: `זה הקובץ "${meta.name}".` }];
    }
    return `הקובץ "${meta.name}" הוא מסוג שאיני יכולה לקרוא (${t}).`;
  } catch (e) { return 'לא הצלחתי לקרוא את הקובץ: ' + String(e.message || e).slice(0, 200); }
}
