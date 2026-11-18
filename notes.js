// Things Luka said on her own initiative (a meeting found in a mail, material before a meeting, an alert about
// the computer). They are kept for a couple of hours so that when the owner answers "yes, add it", she knows to what.
import { load, save } from './store.js';
export function note(text) { const s = load(); s.proNotes = [...(s.proNotes || []), { at: Date.now(), text: String(text).slice(0, 700) }].slice(-6); save(); }
export function recentNotes() { const n = (load().proNotes || []).filter(x => Date.now() - x.at < 2 * 3600000); return n.length ? n.map(x => '- ' + x.text).join('\n') : ''; }
export function routineOn(name) { const r = load().routines || {}; return r[name] !== false; }
export function setRoutine(name, on) {
  const names = { premeeting: 'הכנה לפני פגישה', mailevents: 'זיהוי פגישות במיילים', computer: 'התראות על מצב המחשב' };
  if (name === 'all') { const s = load(); s.routines = { premeeting: !!on, mailevents: !!on, computer: !!on }; save(); return (on ? 'הופעלו' : 'כובו') + ' כל היוזמות: ' + Object.values(names).join(', ') + '.'; }
  if (!names[name]) return 'אין יוזמה כזו. הקיימות: premeeting, mailevents, computer.';
  const s = load(); s.routines = { ...(s.routines || {}), [name]: !!on }; save();
  return `${names[name]}: ${on ? 'פעיל' : 'כבוי'}.`;
}
export function routinesText() { return ['premeeting', 'mailevents', 'computer'].map(n => `${n}: ${routineOn(n) ? 'פעיל' : 'כבוי'}`).join(', '); }
// live translation mode
export function setTranslate(on, to) { const s = load(); if (on) s.translate = { to: String(to || 'אנגלית').slice(0, 30), until: Date.now() + 45 * 60000 }; else delete s.translate; save(); return on ? `מצב תרגום פעיל: כל מה שייאמר יתורגם ל${s.translate.to}, למשך עד 45 דקות או עד שאדוני יבקש להפסיק.` : 'מצב התרגום כובה.'; }
export function translateTo() { const t = load().translate; return t && t.until > Date.now() ? t.to : ''; }

// how she talks: a standing style the owner can switch by voice
const STYLES = { 'רגיל': '', 'מקצועי': 'סגנון הדיבור שאדוני בחר: מקצועי וענייני. משפטים קצרים, בלי בדיחות ובלי התרגשות.', 'הומוריסטי': 'סגנון הדיבור שאדוני בחר: קליל ושנון. מותר הומור עדין וציני קצת, בלי להגזים ובלי לפגוע בדיוק.', 'רגוע': 'סגנון הדיבור שאדוני בחר: רגוע, חם ואיטי. משפטים רכים, בלי לחץ.' };
export function setStyle(name) { if (!(name in STYLES)) return 'הסגנונות הקיימים: ' + Object.keys(STYLES).join(', ') + '.'; const s = load(); s.style = name; save(); return 'סגנון הדיבור נקבע ל' + name + '.'; }
export function styleLine() { return STYLES[load().style || 'רגיל'] || ''; }
// goals with progress over time
export function goals(action, title, target, noteText) {
  const s = load(); if (!Array.isArray(s.goals)) s.goals = [];
  const t = (title || '').toString().trim().slice(0, 80);
  const hit = t ? s.goals.filter(g => g.title.includes(t) || t.includes(g.title)) : [];
  const day = (ms) => new Date(ms).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' });
  const show = () => s.goals.length ? s.goals.map(g => `- ${g.done ? '[הושג] ' : ''}${g.title}${g.target ? ' (יעד: ' + g.target + ')' : ''}${g.log.length ? '. התקדמות: ' + g.log.slice(-3).map(l => day(l.at) + ' ' + l.text).join('; ') : ', עדיין בלי עדכונים'}`).join('\n') : 'אין עדיין יעדים.';
  if (action === 'show') return show();
  if (action === 'add') { if (!t) return 'חסר שם ליעד.'; if (s.goals.length >= 30) return 'יש כבר שלושים יעדים.'; if (hit.length) return 'יעד כזה כבר קיים.'; s.goals.push({ title: t, target: (target || '').toString().slice(0, 120), log: [], done: false, at: Date.now() }); save(); return 'היעד נוסף: ' + t + '.'; }
  if (hit.length !== 1) return (hit.length ? 'נמצאו כמה יעדים מתאימים.' : 'לא נמצא יעד כזה.') + ' היעדים:\n' + show();
  const g = hit[0];
  if (action === 'progress') { const x = (noteText || '').toString().trim().slice(0, 200); if (!x) return 'חסר מה התקדם.'; g.log.push({ at: Date.now(), text: x }); g.log = g.log.slice(-40); save(); return `נרשמה התקדמות ביעד ${g.title}: ${x}.`; }
  if (action === 'done') { g.done = true; save(); return `היעד ${g.title} סומן כהושג.`; }
  if (action === 'remove') { s.goals = s.goals.filter(x => x !== g); save(); return `היעד ${g.title} הוסר.`; }
  return 'פעולה לא מוכרת.';
}
export function goalsCard() { const g = (load().goals || []).slice(0, 8); return g.length ? { kind: 'checklist', count: g.filter(x => !x.done).length, items: g.map(x => ({ text: x.title + (x.log.length ? ' · ' + x.log[x.log.length - 1].text.slice(0, 40) : ''), done: !!x.done })) } : null; }
// topics and pages she keeps an eye on
export function watches(action, what, everyHours) {
  const s = load(); if (!Array.isArray(s.watches)) s.watches = [];
  const w = (what || '').toString().trim().slice(0, 300);
  const list = () => s.watches.length ? s.watches.map(x => `- ${x.what} (כל ${x.every} שעות)`).join('\n') : 'אין כרגע נושאים במעקב.';
  if (action === 'list') return list();
  if (action === 'add') { if (w.length < 3) return 'חסר על מה לעקוב.'; if (s.watches.length >= 8) return 'יש כבר שמונה נושאים במעקב.'; const every = Math.max(3, Math.min(168, Number(everyHours) || 24)); s.watches.push({ id: Date.now().toString(36), what: w, every, last: 0, summary: '' }); save(); return `נוסף למעקב: ${w}. אבדוק כל ${every} שעות ואעדכן רק כשיש שינוי של ממש.`; }
  if (action === 'remove') { const hit = s.watches.filter(x => x.what.includes(w) || w.includes(x.what)); if (hit.length !== 1) return (hit.length ? 'נמצאו כמה מתאימים.' : 'לא נמצא מעקב כזה.') + '\n' + list(); s.watches = s.watches.filter(x => x !== hit[0]); save(); return 'המעקב הוסר: ' + hit[0].what + '.'; }
  return 'פעולה לא מוכרת.';
}
