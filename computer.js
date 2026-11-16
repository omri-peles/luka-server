// "Luka's hand" on the owner's computer. A page (/hand) kept open in the computer's browser
// polls for commands; the tablet agent queues them here. In-memory only: commands are
// short-lived, and anything not picked up within a minute is dropped.
const queue = [];
let lastSeen = 0;

export function computerOnline() { return Date.now() - lastSeen < 12000; }
export function takeAll() {
  lastSeen = Date.now();
  const fresh = queue.filter(c => Date.now() - c.at < 60000);
  queue.length = 0;
  return fresh;
}
// The hand reports back what actually happened, so Luka tells the truth about it.
const waiters = new Map();
export function report(id, text) {
  const w = waiters.get(id); if (w) { waiters.delete(id); w((text || '').toString().slice(0, 300)); }
}
function waitFor(id, ms) {
  return new Promise(resolve => {
    const t = setTimeout(() => { waiters.delete(id); resolve(null); }, ms);
    waiters.set(id, (x) => { clearTimeout(t); resolve(x); });
  });
}
function send(cmd) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  queue.push({ ...cmd, id, at: Date.now() });
  return id;
}

// Tool handlers used by the tablet agent.
export async function openOnComputer(url, label) {
  const u = (url || '').toString().trim();
  if (!/^https?:\/\/[^\s]+$/i.test(u)) return 'לא נשלח: כתובת לא תקינה.';
  if (!computerOnline()) return 'לא בוצע: המחשב לא מחובר כרגע. הדף "היד של לוקה" צריך להיות פתוח בדפדפן של המחשב.';
  const id = send({ type: 'open', url: u, label: (label || '').toString().slice(0, 120) });
  const res = await waitFor(id, 6000);
  return res || 'נשלח למחשב, אך לא התקבל אישור שהאתר נפתח.';
}

// Close tabs that Luka's hand opened. what: 'last' | 'all' | free text matched against the
// address and the label given when it was opened. Tabs the owner opened himself cannot be
// closed by a web page.
export async function closeOnComputer(what) {
  const w = (what || 'last').toString().trim() || 'last';
  if (!computerOnline()) return 'לא בוצע: המחשב לא מחובר כרגע.';
  const id = send({ type: 'close', what: w });
  const res = await waitFor(id, 6000);
  return res || 'לא התקבל אישור מהמחשב שהלשונית נסגרה.';
}
