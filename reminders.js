// Reminders and timers for the tablet agent. Kept on the data volume, so they survive restarts.
// When one is due, Luka says it on the tablet (the same queue as her other announcements).
import { load, save } from './store.js';

function list() { const s = load(); if (!Array.isArray(s.reminders)) s.reminders = []; return s.reminders; }
function say(text) {
  const s = load(); if (!Array.isArray(s.updates)) s.updates = [];
  s.updates.push({ id: Date.now().toString(36), text, at: Date.now() });
  if (s.updates.length > 50) s.updates = s.updates.slice(-50);
}
const when = (ms) => new Date(ms).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', hour: '2-digit', minute: '2-digit' });

export function setReminder(minutes, text) {
  const m = Number(minutes); text = (text || '').toString().trim().slice(0, 200);
  if (!(m >= 0.2 && m <= 60 * 24 * 30)) return 'לא נקבע: הזמן צריך להיות בין רבע דקה לשלושים יום.';
  if (!text) return 'לא נקבע: חסר על מה להזכיר.';
  const l = list(); if (l.length >= 100) return 'לא נקבע: יש כבר מאה תזכורות פתוחות.';
  const at = Date.now() + Math.round(m * 60000);
  l.push({ id: Date.now().toString(36), at, text }); save();
  return `נקבעה תזכורת ל${when(at)}: ${text}. היא תיאמר במסך של לוקה כשהוא פתוח.`;
}
export function listReminders() {
  const l = list().slice().sort((a, b) => a.at - b.at);
  return l.length ? l.map(r => `- ${when(r.at)}: ${r.text}`).join('\n') : 'אין תזכורות פתוחות.';
}
export function cancelReminder(query) {
  const q = (query || '').toString().trim(); const l = list();
  const hit = l.filter(r => q && r.text.includes(q));
  if (!hit.length) return 'לא נמצאה תזכורת מתאימה. הפתוחות:\n' + listReminders();
  if (hit.length > 1) return 'נמצאו כמה תזכורות מתאימות, צריך ניסוח מדויק יותר:\n' + hit.map(r => `- ${when(r.at)}: ${r.text}`).join('\n');
  l.splice(l.indexOf(hit[0]), 1); save();
  return `בוטלה התזכורת: ${hit[0].text}.`;
}
setInterval(() => {
  try {
    const l = list(); const due = l.filter(r => r.at <= Date.now());
    if (!due.length) return;
    for (const r of due) { say('תזכורת, אדוני: ' + r.text); l.splice(l.indexOf(r), 1); }
    save();
  } catch (e) { console.error('reminders', e.message); }
}, 15000).unref();
