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
