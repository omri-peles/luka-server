// "Luka's hand" on the owner's computer. A page (/hand) kept open in the computer's browser
// polls for commands; the tablet agent queues them here. In-memory only: commands are
// short-lived, and anything not picked up within a minute is dropped.
const queue = [];
let lastSeen = 0;
let macSeen = 0, macWake = null;

export function computerOnline() { return Date.now() - lastSeen < 12000 || Date.now() - macSeen < 45000; }
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
// ---- the Mac helper (a small background program on the Mac). When it is connected it gets
// the commands instead of the page, because it can also close tabs the page cannot. ----
const macQueue = [];
export function macOnline() { return Date.now() - macSeen < 45000; }
const clean = v => (v == null ? '' : String(v)).replace(/[\t\r\n]+/g, ' ').trim();
function macLines() {
  const fresh = macQueue.filter(c => Date.now() - c.at < 60000);
  macQueue.length = 0;
  return fresh.map(c => [c.id, c.type, clean(c.type === 'open' ? c.url : c.what), clean(c.label)].join('\t')).join('\n');
}
// Long poll: answers at once when a command is waiting, otherwise holds up to waitMs.
export function takeMac(waitMs = 25000) {
  macSeen = Date.now();
  if (macQueue.length) return Promise.resolve(macLines());
  return new Promise(resolve => {
    if (macWake) macWake();                       // an older waiting request gives way
    const done = () => { clearTimeout(t); macWake = null; macSeen = Date.now(); resolve(macLines()); };
    const t = setTimeout(done, waitMs);
    macWake = done;
  });
}
function send(cmd) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  if (macOnline()) { macQueue.push({ ...cmd, id, at: Date.now() }); if (macWake) macWake(); }
  else queue.push({ ...cmd, id, at: Date.now() });
  return id;
}
export function openAppOnComputer(name) {
  const n = clean(name);
  if (!/^[A-Za-z0-9 ._-]{1,40}$/.test(n)) return 'לא בוצע: שם האפליקציה צריך להיות באנגלית, כפי שהיא נקראת במק.';
  if (!macOnline()) return 'לא בוצע: תוכנת העזר של לוקה לא מחוברת כרגע במחשב.';
  const id = send({ type: 'app', what: n });
  return waitFor(id, 8000).then(r => r || 'נשלח למחשב, אך לא התקבל אישור.');
}
export function volumeOnComputer(level) {
  const n = Math.round(Number(level));
  if (!(n >= 0 && n <= 100)) return 'לא בוצע: עוצמה צריכה להיות בין 0 ל-100.';
  if (!macOnline()) return 'לא בוצע: תוכנת העזר של לוקה לא מחוברת כרגע במחשב.';
  const id = send({ type: 'volume', what: String(n) });
  return waitFor(id, 8000).then(r => r || 'נשלח למחשב, אך לא התקבל אישור.');
}

// Tool handlers used by the tablet agent.
export async function openOnComputer(url, label) {
  const u = (url || '').toString().trim();
  if (!/^https?:\/\/[^\s]+$/i.test(u)) return 'לא נשלח: כתובת לא תקינה.';
  if (!computerOnline()) return 'לא בוצע: המחשב לא מחובר כרגע. הדף "היד של לוקה" צריך להיות פתוח בדפדפן של המחשב.';
  const id = send({ type: 'open', url: u, label: (label || '').toString().slice(0, 120) });
  const res = await waitFor(id, 8000);
  return res || 'נשלח למחשב, אך לא התקבל אישור שהאתר נפתח.';
}

// Close tabs that Luka's hand opened. what: 'last' | 'all' | free text matched against the
// address and the label given when it was opened. Tabs the owner opened himself cannot be
// closed by a web page.
export async function closeOnComputer(what) {
  const w = (what || 'last').toString().trim() || 'last';
  if (!computerOnline()) return 'לא בוצע: המחשב לא מחובר כרגע.';
  let q = w;
  if (macOnline()) {
    if (q === 'all') return 'לא בוצע: סגירת כל הלשוניות בבת אחת לא נתמכת. אפשר לסגור לפי שם.';
    if (q === 'last') q = 'current';
  } else if (q === 'current') q = 'last';
  const id = send({ type: 'close', what: q });
  const res = await waitFor(id, 8000);
  return res || 'לא התקבל אישור מהמחשב שהלשונית נסגרה.';
}
