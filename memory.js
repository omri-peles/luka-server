// Luka's long-term personal memory: durable facts about the owner (preferences, projects,
// open tasks, people and suppliers, decisions, habits). Kept in the same store as everything
// else, so it survives restarts and deploys.
import { load, save } from './store.js';

export const CATEGORIES = ['העדפות', 'פרויקטים', 'משימות פתוחות', 'אנשים וספקים', 'החלטות', 'הרגלים ושגרות'];

export function remember(category, text) {
  const t = (text || '').toString().trim();
  if (!t) return 'לא נשמר: חסר תוכן.';
  const cat = CATEGORIES.includes(category) ? category : 'העדפות';
  const s = load();
  const mem = s.memory || [];
  if (mem.some(m => m.text === t)) return 'כבר שמור.';
  mem.push({ id: Date.now().toString(36), cat, text: t.slice(0, 400), at: Date.now() });
  s.memory = mem.slice(-200);
  save();
  return 'נשמר בזיכרון (' + cat + '): ' + t;
}

export function forget(query) {
  const q = (query || '').toString().trim();
  if (!q) return 'לא נמחק: חסר מה למחוק.';
  const s = load();
  const mem = s.memory || [];
  const keep = mem.filter(m => !m.text.includes(q));
  const n = mem.length - keep.length;
  if (!n) return 'לא מצאתי בזיכרון פריט שמכיל "' + q + '".';
  s.memory = keep; save();
  return 'נמחקו ' + n + ' פריטים מהזיכרון.';
}

export function memoryText() {
  const mem = (load().memory || []);
  if (!mem.length) return '';
  let out = '';
  for (const c of CATEGORIES) {
    const items = mem.filter(m => m.cat === c);
    if (items.length) out += '\n' + c + ':\n' + items.map(m => '- ' + m.text).join('\n');
  }
  return out;
}
