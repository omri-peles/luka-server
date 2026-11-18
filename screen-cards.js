// Data for the graphic windows on Luka's screen: calendar, mail, messages, shop, reminders.
// Each function returns numbers and short names for the page to draw, never sentences. Read only.
import { google } from 'googleapis';
import { get, set, load } from './store.js';
import { oauthClient } from './google.js';
import { shopifyOn, shopifyOrdersData, shopifyProductsData } from './shopify.js';

const TZ = () => process.env.TIMEZONE || 'Asia/Jerusalem';
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ() }).format(d);
const hm = (d) => new Intl.DateTimeFormat('he-IL', { timeZone: TZ(), hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const wd = (d) => new Intl.DateTimeFormat('he-IL', { timeZone: TZ(), weekday: 'short' }).format(d);
const dom = (d) => new Intl.DateTimeFormat('he-IL', { timeZone: TZ(), day: 'numeric' }).format(d);

export function authed() {
  const g = get('google');
  if (!g || !g.refresh_token) return null;
  const client = oauthClient();
  client.setCredentials(g);
  client.on('tokens', (t) => { const cur = get('google') || {}; set('google', { ...cur, ...t }); });
  return client;
}

export async function calendarCard(range) {
  const client = authed(); if (!client) return null;
  const span = range === 'week' ? 7 : range === 'today' ? 1 : 2;
  const now = new Date(), today = dayKey(now);
  const cal = google.calendar({ version: 'v3', auth: client });
  const res = await cal.events.list({ calendarId: 'primary', timeMin: new Date(now.getTime() - 24 * 3600000).toISOString(),
    timeMax: new Date(now.getTime() + span * 24 * 3600000).toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 40 });
  const keys = []; for (let i = 0; i < span; i++) keys.push(dayKey(new Date(now.getTime() + i * 24 * 3600000)));
  const days = keys.map((k, i) => { const d = new Date(now.getTime() + i * 24 * 3600000); return { key: k, wd: wd(d), dom: dom(d), today: i === 0, items: [] }; });
  for (const ev of (res.data.items || [])) {
    const all = !ev.start?.dateTime;
    const st = all ? null : new Date(ev.start.dateTime), en = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
    const k = all ? (ev.start?.date || '') : dayKey(st);
    const day = days.find(x => x.key === k); if (!day || day.items.length >= 6) continue;
    day.items.push({ t: all ? '' : hm(st), e: en ? hm(en) : '', title: (ev.summary || '').slice(0, 60), past: !!(en && en < now), live: !!(st && en && st <= now && en >= now) });
  }
  return { kind: 'calendar', now: hm(now), days: days.filter(d => d.today || d.items.length).slice(0, 4).map(({ key, ...d }) => d) };
}

export async function mailCard() {
  const client = authed(); if (!client) return null;
  const gmail = google.gmail({ version: 'v1', auth: client });
  const res = await gmail.users.messages.list({ userId: 'me', q: 'is:unread category:primary newer_than:3d', maxResults: 6 });
  const items = [];
  for (const m of (res.data.messages || [])) {
    try {
      const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['From', 'Subject'] });
      const h = full.data.payload?.headers || [];
      const from = (h.find(x => x.name === 'From')?.value || '').replace(/<[^>]*>/g, '').replace(/"/g, '').trim();
      items.push({ from: from.slice(0, 28), text: (h.find(x => x.name === 'Subject')?.value || '').slice(0, 70), at: hm(new Date(Number(full.data.internalDate) || Date.now())) });
    } catch (e) { /* skip */ }
  }
  return { kind: 'mail', count: items.length, items };
}

export function messagesCard() {
  const wa = (load().waRecent || []).slice(-6).reverse();
  return { kind: 'messages', count: wa.length, items: wa.map(m => ({ from: String(m.from || '').slice(0, 28), text: String(m.body || '').slice(0, 90), at: m.at ? hm(new Date(m.at)) : '' })) };
}

export function remindersCard() {
  const l = (load().reminders || []).slice().sort((a, b) => a.at - b.at).slice(0, 6);
  const now = Date.now();
  return { kind: 'reminders', count: l.length, items: l.map(r => ({ t: hm(new Date(r.at)), wd: dayKey(new Date(r.at)) === dayKey(new Date()) ? '' : wd(new Date(r.at)), mins: Math.max(0, Math.round((r.at - now) / 60000)), title: String(r.text || '').slice(0, 60) })) };
}

export async function ordersCard(days) {
  if (!shopifyOn()) return null;
  const d = await shopifyOrdersData(days); if (!d) return null;
  return { kind: 'orders', ...d };
}
export async function productsCard(query, lowStock) {
  if (!shopifyOn()) return null;
  const items = await shopifyProductsData(query, lowStock); if (!items) return null;
  return { kind: 'products', items };
}

// Which windows the words themselves call for, so they open even when she answers from what she already knows.
export function wanted(text) {
  const t = String(text || ''), out = [];
  if (/יומן|לו"ז|לוז |הלוז|פגיש|אירוע|מה יש לי (היום|מחר|השבוע)/.test(t) && !/יומן ה?שיחות/.test(t)) out.push(/שבוע/.test(t) ? 'calendar:week' : 'calendar');
  if (/מייל|אימייל|דואר/.test(t) && !/שלח|תשלח|כתבי/.test(t)) out.push('mail');
  if (/וואטסאפ|ווטסאפ|הודעות|הודעה חדשה/.test(t) && !/שלח|תשלח|כתבי/.test(t)) out.push('messages');
  if (/תזכור(ו)?ת/.test(t) && /מה|אילו|איזה|הראי|תראי|יש/.test(t)) out.push('reminders');
  return out;
}

export async function cardOf(what, inp = {}) {
  try {
    const [k, arg] = String(what).split(':');
    if (k === 'calendar') return await calendarCard(arg || inp.range);
    if (k === 'mail') return await mailCard();
    if (k === 'messages') return messagesCard();
    if (k === 'reminders') return remindersCard();
    if (k === 'orders') return await ordersCard(inp.days);
    if (k === 'products') return await productsCard(inp.query, inp.low_stock);
  } catch (e) { console.error('card', what, e.message); }
  return null;
}
