// "Luka's hand" on the owner's computer. A page (/hand) kept open in the computer's browser
// polls for commands; the tablet agent queues them here. In-memory only: commands are
// short-lived, and anything not picked up within a minute is dropped.
const queue = [];
let lastSeen = 0;

export function computerOnline() { return Date.now() - lastSeen < 12000; }
export function enqueue(cmd) {
  queue.push({ ...cmd, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now() });
}
export function takeAll() {
  lastSeen = Date.now();
  const fresh = queue.filter(c => Date.now() - c.at < 60000);
  queue.length = 0;
  return fresh;
}
// Tool handler used by the tablet agent.
export function openOnComputer(url) {
  const u = (url || '').toString().trim();
  if (!/^https?:\/\/[^\s]+$/i.test(u)) return 'לא נשלח: כתובת לא תקינה.';
  if (!computerOnline()) return 'לא נשלח: המחשב לא מחובר כרגע. הדף "היד של לוקה" צריך להיות פתוח בדפדפן של המחשב.';
  enqueue({ type: 'open', url: u });
  return 'נשלח למחשב: נפתח ' + u;
}

// Close tabs that Luka's hand opened. what: 'last' | 'all' | free text matched against the address
// (e.g. the search words). Tabs the owner opened himself cannot be closed by a web page.
export function closeOnComputer(what) {
  const w = (what || 'last').toString().trim() || 'last';
  if (!computerOnline()) return 'לא נשלח: המחשב לא מחובר כרגע.';
  enqueue({ type: 'close', what: w });
  return 'נשלחה למחשב בקשת סגירה (' + w + '). אפשר לסגור רק לשוניות שלוקה פתחה בעצמה מאז שהדף "היד של לוקה" נפתח.';
}
