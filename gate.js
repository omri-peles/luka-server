// A spoken "are you sure" for actions that cannot be taken back (sending mail, changing the
// shop, moving a file to the Trash). The first request only registers the action and tells
// Luka to read it back and ask. It is carried out only when she asks again in a LATER turn,
// i.e. after the owner has actually answered.
let turnNo = 0;
const pending = new Map();
export function newTurn() { turnNo++; for (const [k, v] of pending) if (Date.now() - v.at > 180000) pending.delete(k); }
export function confirmed(key) {
  const p = pending.get(key);
  if (p && p.turn < turnNo && Date.now() - p.at < 180000) { pending.delete(key); return true; }
  pending.set(key, { turn: turnNo, at: Date.now() });
  return false;
}
export const ASK = (what) => `עוד לא בוצע. אמרי לאדוני בדיוק מה עומד לקרות: ${what}. שאלי אותו "לאשר?" ועצרי. רק אחרי שהוא עונה כן, קראי שוב לאותו כלי עם אותם פרטים בדיוק.`;
