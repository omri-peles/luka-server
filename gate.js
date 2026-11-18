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
export const ASK = (what) => `הפעולה עוד לא בוצעה, והיא דורשת אישור של אדוני. אל תקראי שוב לכלי הזה בתשובה הנוכחית. עני עכשיו לאדוני בדיבור בלבד: אמרי בקצרה מה עומד לקרות (${what}) ושאלי "לאשר?". רק בתשובה הבאה, אחרי שאדוני אמר כן, קראי שוב לכלי עם אותם פרטים בדיוק.`;

export function clearPending() { pending.clear(); }
