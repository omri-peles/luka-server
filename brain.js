// The brain: Claude. Persona identical to the tablet's Luka, plus an urgency classifier.
import { load, save } from './store.js';
import { isConnected, agendaText, recentEmailText, createEvent, updateEvent, findEvents } from './google.js';

const KEY = () => process.env.ANTHROPIC_API_KEY || '';
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-4-8'];
let goodModel = '';

export const PERSONA =
  "את לוקה, עוזרת אישית בהשראת ה-JARVIS של טוני סטארק מאיירון מן. " +
  "האישיות שלך: מנומסת באופן יוצא דופן, רהוטה, רגועה וקרת רוח בכל מצב. " +
  "את מתייחסת אל המשתמש כאל המעסיק והבוס שלך, בכבוד מלא, ופונה אליו 'אדוני' (לפעמים, לא בכל משפט). " +
  "את נאמנה לו לחלוטין, יעילה, ומקדימה את צרכיו. יש לך שנינות יבשה ועדינה, אך לעולם אל תהיי חצופה. " +
  "כללי שפה: דברי תמיד עברית תקנית ויפה. דברי על עצמך בלשון נקבה, ופני אל המשתמש (גבר) בלשון זכר. " +
  "תשובות קצרות, טבעיות וברורות, מתאימות להקראה בקול. בלי אימוג'ים, כוכביות או סימני עיצוב.";

// Tools Luka can use (calendar write). Times are local Asia/Jerusalem ISO without a Z suffix.
const TOOLS = [
  {
    name: 'create_calendar_event',
    description: 'יצירת אירוע חדש ביומן Google של אדוני. השתמשי בזה כשאדוני מבקש לקבוע, להוסיף או לתזמן פגישה/אירוע/תזכורת.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'כותרת האירוע' },
        start: { type: 'string', description: 'זמן התחלה בפורמט ISO מקומי ללא אזור זמן, למשל 2026-11-17T15:00:00. לאירוע של יום שלם: תאריך בלבד YYYY-MM-DD.' },
        end: { type: 'string', description: 'זמן סיום באותו פורמט (אופציונלי; ברירת מחדל שעה אחרי ההתחלה).' },
        description: { type: 'string', description: 'תיאור/הערות (אופציונלי).' },
        location: { type: 'string', description: 'מיקום (אופציונלי).' }
      },
      required: ['title', 'start']
    }
  },
  {
    name: 'update_calendar_event',
    description: 'עדכון אירוע קיים ביומן (שינוי שעה, תאריך, כותרת או מיקום). ציini את query = מילים מתוך כותרת האירוע הקיים כדי שאאתר אותו, ואת השדות שיש לשנות.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'מילים מתוך כותרת האירוע הקיים, לאיתורו.' },
        title: { type: 'string', description: 'כותרת חדשה (אופציונלי).' },
        start: { type: 'string', description: 'זמן התחלה חדש בפורמט ISO מקומי (אופציונלי).' },
        end: { type: 'string', description: 'זמן סיום חדש (אופציונלי).' },
        location: { type: 'string', description: 'מיקום חדש (אופציונלי).' }
      },
      required: ['query']
    }
  }
];

// Execute a tool call, return a short Hebrew result string for the model.
async function runTool(name, input) {
  try {
    if (name === 'create_calendar_event') {
      const ev = await createEvent(input);
      return 'האירוע נוצר בהצלחה: "' + (ev.summary || input.title) + '".';
    }
    if (name === 'update_calendar_event') {
      const matches = await findEvents(input.query);
      if (!matches.length) return 'לא נמצא אירוע התואם ל-"' + input.query + '". בקשי מאדוני לדייק.';
      const ev = await updateEvent({ id: matches[0].id, title: input.title, start: input.start, end: input.end, location: input.location });
      return 'האירוע "' + (ev.summary || matches[0].summary) + '" עודכן בהצלחה.';
    }
    return 'כלי לא מוכר.';
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes('not-connected')) return 'אין חיבור ליומן כרגע.';
    return 'אירעה שגיאה בביצוע הפעולה ביומן.';
  }
}

// Low-level call. Returns the full parsed response (with model fallback). Supports tools.
async function callRaw(messages, { system = PERSONA, maxTokens = 500, tools } = {}) {
  const order = goodModel ? [goodModel, ...MODELS.filter(m => m !== goodModel)] : MODELS;
  let lastErr = '';
  for (const model of order) {
    try {
      const body = { model, max_tokens: maxTokens, system, messages };
      if (tools && tools.length) body.tools = tools;
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': KEY(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (r.ok) { goodModel = model; return await r.json(); }
      let detail = '';
      try { const ej = await r.json(); detail = ej.error ? (ej.error.type + ': ' + (ej.error.message || '')) : ''; } catch { }
      lastErr = model + ' → HTTP ' + r.status + (detail ? ' (' + detail + ')' : '');
      if (r.status === 401 || r.status === 403) lastErr = 'invalid key or no credit';
    } catch (e) { lastErr = String(e.message || e); }
  }
  throw new Error('brain failed: ' + lastErr);
}

// Text-only helper (for the classifier).
async function call(messages, opts = {}) {
  const j = await callRaw(messages, opts);
  return (j.content || []).filter(b => b && b.type === 'text').map(b => b.text || '').join('').trim();
}

function nowLine() {
  const tz = process.env.TIMEZONE || 'Asia/Jerusalem';
  const f = new Intl.DateTimeFormat('he-IL', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return f.format(new Date());
}

// Live Google context (agenda + unread mail), cached ~2 min so chat replies stay snappy
// instead of hitting Gmail + Calendar on every single message.
let ctxCache = { text: '', ts: 0 };
async function liveContext() {
  if (ctxCache.text && Date.now() - ctxCache.ts < 120000) return ctxCache.text;
  try {
    const [agenda, mail] = await Promise.all([agendaText(336), recentEmailText(5)]);
    ctxCache = {
      text: "\n\n--- מידע חי מחשבון Google של אדוני (יש לך גישה מלאה: קריאה וכתיבה ליומן) ---\n" +
        "היומן (14 הימים הקרובים):\n" + agenda + "\n\nמיילים אחרונים שלא נקראו:\n" + mail +
        "\n--- סוף המידע החי ---\n" +
        "כשאדוני מבקש לקבוע/להוסיף/לתזמן או לעדכן פגישה — השתמשי בכלים שברשותך כדי לבצע זאת בפועל ביומן, ואז אשרי לו קצרות.",
      ts: Date.now()
    };
  } catch { /* keep previous cache on error */ }
  return ctxCache.text;
}

// Conversational reply, with shared memory across tablet + whatsapp, and calendar tool-use.
export async function chat(text) {
  const s = load();
  s.conversation.push({ role: 'user', content: text });
  let messages = s.conversation.slice(-16);

  let sys = PERSONA + "\n\nהתאריך והשעה הנוכחיים (אזור זמן ישראל): " + nowLine() + ". " +
    "כשאדוני אומר 'מחר', 'יום ראשון הבא' וכדומה — חשבי את התאריך המדויק ביחס לעכשיו.";

  const connected = isConnected();
  if (connected) sys += await liveContext();

  // Tool-use loop (cap iterations to stay snappy).
  let reply = '';
  const tools = connected ? TOOLS : undefined;
  for (let i = 0; i < 4; i++) {
    const j = await callRaw(messages, { system: sys, tools });
    const content = j.content || [];
    if (j.stop_reason === 'tool_use') {
      const results = [];
      for (const b of content) {
        if (b.type === 'tool_use') {
          const r = await runTool(b.name, b.input || {});
          results.push({ type: 'tool_result', tool_use_id: b.id, content: r });
        }
      }
      messages = [...messages, { role: 'assistant', content }, { role: 'user', content: results }];
      continue;
    }
    reply = content.filter(b => b && b.type === 'text').map(b => b.text || '').join('').trim();
    break;
  }
  if (!reply) reply = 'סליחה אדוני, לא הצלחתי להשלים את הפעולה. תוכל לנסות שוב?';

  s.conversation.push({ role: 'assistant', content: reply });
  if (s.conversation.length > 40) s.conversation = s.conversation.slice(-40);
  save();
  return reply;
}

// Decide whether an incoming item deserves to interrupt the user, and craft what Luka would say.
// Returns { urgency: 'high'|'low', say: '<hebrew one-liner in Luka's voice>' }.
export async function classify(kind, summary) {
  const sys =
    PERSONA + "\n\n" +
    "משימה: קיבלת פריט חדש (" + kind + "). החליטי כמה הוא דחוף עבור אדוני, ונסחי משפט קצר אחד " +
    "שבו תעדכני אותו, בקולך. 'high' = משהו שמצדיק להפריע/להתקשר עכשיו (דחוף, אישי, רגיש לזמן). " +
    "'low' = אפשר לעדכן בשקט בלי להפריע. החזירי אך ורק JSON תקין בפורמט: " +
    '{"urgency":"high"|"low","say":"..."} ללא טקסט נוסף.';
  const messages = [{ role: 'user', content: summary }];
  try {
    const raw = await call(messages, { system: sys, maxTokens: 220 });
    const m = raw.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m ? m[0] : raw);
    return {
      urgency: j.urgency === 'high' ? 'high' : 'low',
      say: (j.say || '').toString().trim() || ('אדוני, יש עדכון חדש: ' + summary)
    };
  } catch {
    return { urgency: 'low', say: 'אדוני, יש עדכון חדש: ' + summary };
  }
}
