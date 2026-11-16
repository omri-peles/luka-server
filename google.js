// Google OAuth + Gmail + Calendar access.
import { google } from 'googleapis';
import { load, save, set, get } from './store.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  // calendar.events = read + write events (lets Luka create/update, and still list)
  'https://www.googleapis.com/auth/calendar.events'
];

export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function authUrl() {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',           // force a refresh_token
    scope: SCOPES
  });
}

export async function handleCallback(code) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  // Keep the refresh_token (long-lived). Access tokens are refreshed automatically.
  const existing = get('google') || {};
  set('google', { ...existing, ...tokens });
  return true;
}

export function isConnected() {
  const g = get('google');
  return !!(g && g.refresh_token);
}

function authed() {
  const g = get('google');
  if (!g || !g.refresh_token) return null;
  const client = oauthClient();
  client.setCredentials(g);
  // Persist refreshed tokens
  client.on('tokens', (t) => {
    const cur = get('google') || {};
    set('google', { ...cur, ...t });
  });
  return client;
}

// Returns new important unread emails not seen before.
// [{ id, from, subject, snippet }]
export async function newImportantEmails() {
  const client = authed();
  if (!client) return [];
  const gmail = google.gmail({ version: 'v1', auth: client });
  const s = load();
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread category:primary newer_than:1d',
    maxResults: 10
  });
  const out = [];
  for (const m of (res.data.messages || [])) {
    if (s.seenEmailIds.includes(m.id)) continue;
    try {
      const full = await gmail.users.messages.get({
        userId: 'me', id: m.id, format: 'metadata',
        metadataHeaders: ['From', 'Subject']
      });
      const headers = full.data.payload?.headers || [];
      const from = headers.find(h => h.name === 'From')?.value || '';
      const subject = headers.find(h => h.name === 'Subject')?.value || '(ללא נושא)';
      out.push({ id: m.id, from, subject, snippet: full.data.snippet || '' });
    } catch { /* skip this one */ }
  }
  // Mark all fetched as seen (even non-important) to avoid re-processing
  for (const m of (res.data.messages || [])) {
    if (!s.seenEmailIds.includes(m.id)) s.seenEmailIds.push(m.id);
  }
  if (s.seenEmailIds.length > 800) s.seenEmailIds = s.seenEmailIds.slice(-800);
  save();
  return out;
}

// Returns calendar events starting within the next `minutes` not yet alerted.
// [{ id, summary, start }]
export async function upcomingEvents(minutes = 15) {
  const client = authed();
  if (!client) return [];
  const cal = google.calendar({ version: 'v3', auth: client });
  const now = new Date();
  const soon = new Date(now.getTime() + minutes * 60000);
  const res = await cal.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: soon.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 10
  });
  const s = load();
  const out = [];
  for (const ev of (res.data.items || [])) {
    if (s.alertedEventIds.includes(ev.id)) continue;
    out.push({
      id: ev.id,
      summary: ev.summary || '(אירוע ללא שם)',
      start: ev.start?.dateTime || ev.start?.date || ''
    });
  }
  return out;
}

// Human-readable Hebrew agenda for the next `hours` hours (for answering chat questions).
// Default widened to 14 days so events a week+ out still surface to Luka.
export async function agendaText(hours = 336) {
  const client = authed();
  if (!client) return '';
  const cal = google.calendar({ version: 'v3', auth: client });
  const now = new Date();
  const end = new Date(now.getTime() + hours * 3600 * 1000);
  const res = await cal.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 25
  });
  const items = res.data.items || [];
  if (!items.length) return 'אין אירועים ביומן בטווח הקרוב.';
  const tz = process.env.TIMEZONE || 'Asia/Jerusalem';
  const fmt = new Intl.DateTimeFormat('he-IL', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtDay = new Intl.DateTimeFormat('he-IL', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'numeric' });
  return items.map(ev => {
    if (ev.start?.dateTime) return '• ' + fmt.format(new Date(ev.start.dateTime)) + ' — ' + (ev.summary || '(ללא שם)');
    const d = ev.start?.date ? new Date(ev.start.date + 'T00:00:00') : null;
    return '• ' + (d ? fmtDay.format(d) + ' (כל היום)' : '') + ' — ' + (ev.summary || '(ללא שם)');
  }).join('\n');
}

// Recent unread primary emails (subject + sender) for answering chat questions.
export async function recentEmailText(n = 5) {
  const client = authed();
  if (!client) return '';
  const gmail = google.gmail({ version: 'v1', auth: client });
  const res = await gmail.users.messages.list({ userId: 'me', q: 'is:unread category:primary newer_than:3d', maxResults: n });
  const out = [];
  for (const m of (res.data.messages || [])) {
    try {
      const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['From', 'Subject'] });
      const h = full.data.payload?.headers || [];
      const from = h.find(x => x.name === 'From')?.value || '';
      const subj = h.find(x => x.name === 'Subject')?.value || '(ללא נושא)';
      out.push('• ' + subj + ' — ' + from);
    } catch { /* skip */ }
  }
  return out.length ? out.join('\n') : 'אין מיילים חדשים שלא נקראו.';
}

// ---- Calendar WRITE ----
const TZ = () => process.env.TIMEZONE || 'Asia/Jerusalem';

// Build a Google start/end object. If the value is a date only (YYYY-MM-DD) → all-day.
function timeObj(v) {
  if (!v) return null;
  return (String(v).length <= 10)
    ? { date: v }
    : { dateTime: v, timeZone: TZ() };
}

// Create a new event. start/end are ISO strings (with offset or local) or YYYY-MM-DD for all-day.
// If end is missing, defaults to 1 hour after a timed start.
export async function createEvent({ title, start, end, description, location }) {
  const client = authed();
  if (!client) throw new Error('google-not-connected');
  const cal = google.calendar({ version: 'v3', auth: client });
  let endVal = end;
  if (!endVal && start && String(start).length > 10) {
    endVal = new Date(new Date(start).getTime() + 60 * 60000).toISOString();
  }
  const requestBody = {
    summary: title || 'אירוע',
    description: description || undefined,
    location: location || undefined,
    start: timeObj(start),
    end: timeObj(endVal || start)
  };
  const res = await cal.events.insert({ calendarId: 'primary', requestBody });
  return { id: res.data.id, summary: res.data.summary, start: res.data.start, link: res.data.htmlLink };
}

// Find upcoming events whose title contains `query` (case-insensitive), to locate one to update.
export async function findEvents(query, days = 60) {
  const client = authed();
  if (!client) return [];
  const cal = google.calendar({ version: 'v3', auth: client });
  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);
  const res = await cal.events.list({
    calendarId: 'primary', timeMin: now.toISOString(), timeMax: end.toISOString(),
    singleEvents: true, orderBy: 'startTime', maxResults: 50,
    q: query || undefined
  });
  return (res.data.items || []).map(ev => ({
    id: ev.id,
    summary: ev.summary || '(ללא שם)',
    start: ev.start?.dateTime || ev.start?.date || ''
  }));
}

// Update an existing event by id. Only provided fields change (patch).
export async function updateEvent({ id, title, start, end, description, location }) {
  const client = authed();
  if (!client) throw new Error('google-not-connected');
  const cal = google.calendar({ version: 'v3', auth: client });
  const requestBody = {};
  if (title) requestBody.summary = title;
  if (description) requestBody.description = description;
  if (location) requestBody.location = location;
  if (start) requestBody.start = timeObj(start);
  if (end) requestBody.end = timeObj(end);
  const res = await cal.events.patch({ calendarId: 'primary', eventId: id, requestBody });
  return { id: res.data.id, summary: res.data.summary, start: res.data.start, link: res.data.htmlLink };
}
