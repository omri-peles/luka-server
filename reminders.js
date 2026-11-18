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

const HOW = { call: 'בשיחת טלפון', whatsapp: 'בוואטסאפ', screen: 'במסך של לוקה' };
// how: 'screen' (said on her screen; goes to WhatsApp instead when the screen is closed), 'call' or 'whatsapp'.
// repeat: 'daily' fires every day at the same time. task: true means the text is a request for her to carry
// out at that time (for example a sales summary), and the answer is what gets delivered.
export function setReminder(minutes, text, how, repeat, task) {
  const m = Number(minutes); text = (text || '').toString().trim().slice(0, 300);
  how = HOW[how] ? how : 'screen'; repeat = repeat === 'daily' ? 'daily' : '';
  if (!(m >= 0.2 && m <= 60 * 24 * 30)) return 'לא נקבע: הזמן צריך להיות בין רבע דקה לשלושים יום.';
  if (!text) return 'לא נקבע: חסר על מה להזכיר.';
  const l = list(); if (l.length >= 100) return 'לא נקבע: יש כבר מאה תזכורות פתוחות.';
  const at = Date.now() + Math.round(m * 60000);
  l.push({ id: Date.now().toString(36), at, text, how, ...(repeat ? { repeat } : {}), ...(task ? { task: true } : {}) }); save();
  return `נקבע ל${when(at)}${repeat ? ', וכל יום באותה שעה' : ''}, ${HOW[how]}: ${text}.` + (how === 'screen' ? ' אם המסך של לוקה יהיה סגור באותו רגע, זה יישלח בוואטסאפ.' : '');
}
export function listReminders() {
  const l = list().slice().sort((a, b) => a.at - b.at);
  return l.length ? l.map(r => `- ${when(r.at)}${r.repeat ? ' (כל יום)' : ''}, ${HOW[r.how] || HOW.screen}${r.task ? ', משימה' : ''}: ${r.text}`).join('\n') : 'אין תזכורות פתוחות.';
}
export function cancelReminder(query, all) {
  const q = (query || '').toString().trim(); const l = list();
  const hit = l.filter(r => q && r.text.includes(q));
  if (all && hit.length) { for (const h of hit) l.splice(l.indexOf(h), 1); save(); return `בוטלו ${hit.length} תזכורות: ${hit.map(h => h.text).join('; ')}.`; }
  if (!hit.length) return 'לא נמצאה תזכורת מתאימה. הפתוחות:\n' + listReminders();
  if (hit.length > 1) return 'נמצאו כמה תזכורות מתאימות, צריך ניסוח מדויק יותר:\n' + hit.map(r => `- ${when(r.at)}: ${r.text}`).join('\n');
  l.splice(l.indexOf(hit[0]), 1); save();
  return `בוטלה התזכורת: ${hit[0].text}.`;
}
// Delivering one reminder the way he asked for it. A call that cannot be placed falls back to WhatsApp, then SMS.
async function deliver(r) {
  let text = 'אדוני, ביקשת שאזכיר לך: ' + r.text;
  if (r.task) {
    try {
      const agent = await import('./tablet-agent.js');
      const run = agent.chatStream('משימה מתוזמנת שאדוני קבע מראש, בצעי אותה עכשיו ומסרי את התוצאה בקצרה: ' + r.text, () => {}, { channel: r.how === 'call' ? 'call' : 'whatsapp' });
      const reply = await Promise.race([run, new Promise(res => setTimeout(() => res(null), 90000))]);
      text = reply ? String(reply).slice(0, 900) : 'אדוני, לא הצלחתי להשלים בזמן את המשימה שקבעת: ' + r.text;
    } catch (e) { text = 'אדוני, לא הצלחתי לבצע את המשימה שקבעת: ' + r.text; }
  }
  const phone = await import('./phone.js');
  const viaText = async () => { let x = await phone.whatsappOwner(text); if (!x || !x.ok) x = await phone.smsOwner(text); return x && x.ok; };
  if (r.how === 'call') { const x = await phone.callOwner(text); if (!x || !x.ok) { console.error('reminder call failed:', x && x.reason); await viaText(); } return; }
  if (r.how === 'whatsapp') { await viaText(); return; }
  say(text); save();
  if (Date.now() - (Number(load().lastTabletSeen) || 0) > 60000) await viaText();   // her screen is closed: do not let it get lost
}
setInterval(() => {
  try {
    const l = list(); const due = l.filter(r => r.at <= Date.now());
    if (!due.length) return;
    for (const r of due) {
      l.splice(l.indexOf(r), 1);
      if (r.repeat === 'daily') { let at = r.at + 86400000; while (at <= Date.now()) at += 86400000; l.push({ ...r, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at }); }
      deliver(r).catch(e => console.error('reminder delivery', e.message));
    }
    save();
  } catch (e) { console.error('reminders', e.message); }
}, 15000).unref();
