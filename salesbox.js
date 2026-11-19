// A separate mailbox used only for the website-selling program, so that cold outreach never
// puts the owner's own mailbox at risk. It has its own Google sign-in and its own stored key;
// the owner's main Google connection is not touched.
import { google } from 'googleapis';
import { oauthClient } from './google.js';
import { get, set } from './store.js';

const SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'];
const WANT = () => (process.env.SALES_MAILBOX || 'luka20web@gmail.com').trim().toLowerCase();
export const salesBoxOn = () => !!(get('googleSales') || {}).refresh_token;
export const salesBoxAddress = () => (get('googleSales') || {}).email || '';

export function salesGmail() {
  const g = get('googleSales'); if (!g || !g.refresh_token) return null;
  const c = oauthClient(); c.setCredentials(g);
  c.on('tokens', t => set('googleSales', { ...(get('googleSales') || {}), ...t }));
  return google.gmail({ version: 'v1', auth: c });
}

export function mountSales(app) {
  app.get('/auth/sales', (_req, res) => {
    try { res.redirect(oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent select_account', scope: SCOPES, state: 'sales', login_hint: WANT() })); }
    catch (e) { res.status(500).send('Google OAuth not configured: ' + e.message); }
  });
}

// Called from the shared Google callback when the sign-in was started at /auth/sales.
export async function salesCallback(req, res) {
  try {
    const c = oauthClient(); const { tokens } = await c.getToken(req.query.code); c.setCredentials(tokens);
    const email = ((await google.gmail({ version: 'v1', auth: c }).users.getProfile({ userId: 'me' })).data.emailAddress || '').toLowerCase();
    if (email !== WANT()) return res.status(400).send(`<h2 dir="rtl">נכנסת עם ${email}, ולא עם ${WANT()}.</h2><p dir="rtl">שום דבר לא נשמר. חזור אל /auth/sales ובחר בחשבון ${WANT()}.</p>`);
    if (!tokens.refresh_token) return res.status(400).send('<h2 dir="rtl">Google לא החזיר מפתח קבוע.</h2><p dir="rtl">נסה שוב דרך /auth/sales.</p>');
    set('googleSales', { ...tokens, email });
    res.send(`<h2 dir="rtl">תיבת הפניות ${email} חוברה ללוקה.</h2><p dir="rtl">אפשר לסגור את החלון.</p>`);
  } catch (e) { res.status(500).send('שגיאה בחיבור תיבת הפניות: ' + e.message); }
}
