// The proactive engine: the thing that lets Luka start the conversation herself.
// On a schedule it checks email + calendar, decides what matters, and either queues a
// gentle update for the tablet or calls the owner's phone (only within the allowed window).
import { load, save, remember, get } from './store.js';
import { newImportantEmails, upcomingEvents, isConnected } from './google.js';
import { classify } from './brain.js';
import { callOwner, whatsappOwner } from './phone.js';
import { cleanup } from './voice.js';

const TZ = () => process.env.TIMEZONE || 'Asia/Jerusalem';
const START = () => parseInt(process.env.CALL_START_HOUR || '9', 10);
const END = () => parseInt(process.env.CALL_END_HOUR || '24', 10);
const PRESENCE_MS = 4 * 60 * 1000; // tablet counts as "present" if seen in last 4 min

// Current hour in the owner's timezone (0-23).
function localHour() {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ(), hour: '2-digit', hour12: false
  }).format(new Date());
  return parseInt(h, 10) % 24;
}

export function withinCallWindow() {
  const h = localHour();
  const start = START();
  const end = END() >= 24 ? 24 : END();
  // END_HOUR=24 means "until midnight". Window is [start, end).
  return h >= start && h < end;
}

function presentAtTablet() {
  return (Date.now() - (get('lastTabletSeen') || 0)) < PRESENCE_MS;
}

// Add a message to the tablet's queue (she'll speak it next time the tablet polls).
function queueForTablet(say) {
  const s = load();
  s.updates.push({ id: Date.now().toString(36), text: say, at: Date.now() });
  if (s.updates.length > 50) s.updates = s.updates.slice(-50);
  save();
}

// Handle one item: classify, then notify and/or call.
async function handleItem(kind, idKey, id, summary) {
  if (!remember(idKey, id)) return; // already handled
  let verdict;
  try { verdict = await classify(kind, summary); }
  catch { verdict = { urgency: 'low', say: 'אדוני, יש עדכון חדש: ' + summary }; }

  // Always let the tablet know (she'll say it aloud when he's near / when polled).
  queueForTablet(verdict.say);

  // If he's AT the tablet, that's enough — don't also ping his phone.
  if (presentAtTablet()) return;

  // He's away from the tablet, so reach his phone. Within the allowed hours a
  // high-urgency item earns a real call; everything else (and any call failure)
  // goes out as a WhatsApp message so the update is never lost.
  if (verdict.urgency === 'high' && withinCallWindow()) {
    const res = await callOwner(verdict.say);
    if (res.ok) { console.log('[proactive] called owner'); return; }
    console.warn('[proactive] call unavailable, falling back to whatsapp:', res.reason);
  }
  const wr = await whatsappOwner(verdict.say);
  if (!wr.ok) console.warn('[proactive] whatsapp failed:', wr.reason);
  else console.log('[proactive] whatsapp sent to owner');
}

let running = false;

export async function tick() {
  if (running) return;          // never overlap runs
  running = true;
  try {
    cleanup();
    if (!isConnected()) return;  // Google not linked yet

    // 1) Important new emails
    try {
      const emails = await newImportantEmails();
      for (const e of emails) {
        const summary = `מייל חדש מ-${e.from}. נושא: ${e.subject}. ${e.snippet}`;
        await handleItem('email', 'seenEmailIds', e.id, summary);
      }
    } catch (err) { console.warn('[proactive] gmail error:', err.message); }

    // 2) Imminent calendar events
    try {
      const events = await upcomingEvents(15);
      for (const ev of events) {
        const summary = `אירוע מתקרב ביומן: ${ev.summary}, מתחיל ב-${ev.start}.`;
        await handleItem('calendar', 'alertedEventIds', ev.id, summary);
      }
    } catch (err) { console.warn('[proactive] calendar error:', err.message); }

  } finally {
    running = false;
  }
}
