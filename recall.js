// Luka's long memory of what was said: every turn is kept in a log on the data volume, and she can
// look things up in it by meaning (not by exact words), using the fast model as the reader.
import fs from 'fs';
import path from 'path';

const FILE = path.resolve('./data/history.jsonl');
const KEY = () => process.env.ANTHROPIC_API_KEY;
const day = (ms) => new Date(ms).toLocaleString('he-IL', { timeZone: process.env.TIMEZONE || 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

export function logTurn(user, reply, channel) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify({ at: Date.now(), ch: channel || 'tablet', u: String(user || '').slice(0, 1500), a: String(reply || '').slice(0, 2500) }) + '\n');
    const st = fs.statSync(FILE);
    if (st.size > 6 * 1024 * 1024) { const lines = fs.readFileSync(FILE, 'utf8').split('\n'); fs.writeFileSync(FILE, lines.slice(Math.floor(lines.length / 3)).join('\n')); }   // keep it bounded
  } catch (e) { console.error('history log', e.message); }
}

export async function recall(query) {
  query = (query || '').toString().trim(); if (query.length < 2) return 'חסר מה לחפש.';
  let rows = [];
  try { rows = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch (e) { return 'אין עדיין יומן שיחות שמור. הוא נשמר מהיום והלאה.'; }
  if (!rows.length) return 'אין עדיין יומן שיחות שמור.';
  let text = ''; const parts = [];
  for (let i = rows.length - 1; i >= 0; i--) {                       // newest first, up to what the reader can take
    const r = rows[i]; const p = `[${day(r.at)}, ${r.ch === 'call' ? 'טלפון' : r.ch === 'whatsapp' ? 'וואטסאפ' : 'טאבלט'}]\nאדוני: ${r.u}\nלוקה: ${r.a}`;
    if (text.length + p.length > 240000) break;
    parts.push(p); text += p;
  }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': KEY(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 900,
        system: 'לפניך יומן שיחות בין אדוני לבין העוזרת לוקה. מצא בו כל מה שנוגע לשאלה, גם אם נאמר במילים אחרות, והחזר תקציר מדויק עם התאריך של כל פרט. צטט רק מה שבאמת מופיע ביומן. אם אין שם דבר רלוונטי, כתוב בדיוק: לא נמצא.',
        messages: [{ role: 'user', content: 'השאלה: ' + query + '\n\nהיומן (מהחדש לישן):\n\n' + parts.join('\n\n') }] }) });
    if (!r.ok) return 'החיפוש ביומן השיחות לא הצליח (HTTP ' + r.status + ').';
    const j = await r.json();
    return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').slice(0, 3000) || 'לא נמצא.';
  } catch (e) { return 'החיפוש ביומן השיחות לא הצליח.'; }
}
