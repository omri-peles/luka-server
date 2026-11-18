// Managed lists for the agent: tasks, shopping and any other list the owner names.
// Kept in the same store as everything else, so they survive restarts.
import { load, save } from './store.js';

const norm = (n) => (n || '').toString().trim().slice(0, 30) || 'משימות';
function all() { const s = load(); if (!s.lists || typeof s.lists !== 'object') s.lists = {}; return s.lists; }
const find = (l, q) => l.filter(i => i.text.includes(q) || q.includes(i.text));

export function manageList(action, name, items) {
  const lists = all(); name = norm(name);
  const want = (Array.isArray(items) ? items : items ? [items] : []).map(x => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 30);
  const l = lists[name] || [];
  if (action === 'show') {
    if (!lists[name]) { const names = Object.keys(lists); return names.length ? 'אין רשימה בשם הזה. הרשימות הקיימות: ' + names.map(n => `${n} (${lists[n].filter(i => !i.done).length} פתוחים)`).join(', ') : 'אין עדיין רשימות.'; }
    return l.length ? `רשימת ${name}:\n` + l.map(i => `- ${i.done ? '[בוצע] ' : ''}${i.text}`).join('\n') : `רשימת ${name} ריקה.`;
  }
  if (action === 'add') {
    if (!want.length) return 'לא נוסף: חסר מה להוסיף.';
    if (!lists[name] && Object.keys(lists).length >= 20) return 'לא נוסף: יש כבר עשרים רשימות.';
    const added = [];
    for (const t of want) if (!l.some(i => i.text === t) && l.length < 100) { l.push({ text: t, done: false, at: Date.now() }); added.push(t); }
    lists[name] = l; save();
    return added.length ? `נוסף לרשימת ${name}: ${added.join(', ')}. יש בה עכשיו ${l.filter(i => !i.done).length} פריטים פתוחים.` : 'הפריטים כבר ברשימה.';
  }
  if (!lists[name]) return 'אין רשימה בשם הזה.';
  if (action === 'clear') { delete lists[name]; save(); return `רשימת ${name} נמחקה.`; }
  if (action === 'clear_done') { lists[name] = l.filter(i => !i.done); save(); return `הפריטים שבוצעו הוסרו מרשימת ${name}.`; }
  if (action === 'done' || action === 'remove') {
    if (!want.length) return 'לא בוצע: חסר איזה פריט.';
    const hit = []; for (const q of want) for (const i of find(l, q)) if (!hit.includes(i)) hit.push(i);
    if (!hit.length) return 'לא נמצא פריט מתאים ברשימה. הפריטים: ' + l.map(i => i.text).join(', ');
    if (action === 'done') hit.forEach(i => { i.done = true; }); else lists[name] = l.filter(i => !hit.includes(i));
    save();
    return (action === 'done' ? 'סומן כבוצע: ' : 'הוסר: ') + hit.map(i => i.text).join(', ') + '.';
  }
  return 'פעולה לא מוכרת.';
}
export function listCard(name) {
  const lists = all(); name = norm(name);
  const l = lists[name]; if (!l) return null;
  return { kind: 'checklist', count: l.filter(i => !i.done).length, shopping: /קני/.test(name), items: l.slice(0, 12).map(i => ({ text: i.text, done: !!i.done })) };
}
