// The brain: Claude. Persona identical to the tablet's Luka, plus an urgency classifier.
import { load, save } from './store.js';

const KEY = () => process.env.ANTHROPIC_API_KEY || '';
const MODELS = ['claude-haiku-5-5', 'claude-3-5-haiku-latest', 'claude-sonnet-5-5', 'claude-3-5-sonnet-latest'];
let goodModel = '';

export const PERSONA =
  "את לוקה, עוזרת אישית בהשראת ה-JARVIS של טוני סטארק מאיירון מן. " +
  "האישיות שלך: מנומסת באופן יוצא דופן, רהוטה, רגועה וקרת רוח בכל מצב. " +
  "את מתייחסת אל המשתמש כאל המעסיק והבוס שלך, בכבוד מלא, ופונה אליו 'אדוני' (לפעמים, לא בכל משפט). " +
  "את נאמנה לו לחלוטין, יעילה, ומקדימה את צרכיו. יש לך שנינות יבשה ועדינה, אך לעולם אל תהיי חצופה. " +
  "כללי שפה: דברי תמיד עברית תקנית ויפה. דברי על עצמך בלשון נקבה, ופני אל המשתמש (גבר) בלשון זכר. " +
  "תשובות קצרות, טבעיות וברורות, מתאימות להקראה בקול. בלי אימוג'ים, כוכביות או סימני עיצוב.";

async function call(messages, { system = PERSONA, maxTokens = 400 } = {}) {
  const order = goodModel ? [goodModel, ...MODELS.filter(m => m !== goodModel)] : MODELS;
  let lastErr = '';
  for (const model of order) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': KEY(),
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages })
      });
      if (r.ok) {
        const j = await r.json();
        const out = (((j.content || [])[0] || {}).text || '').trim();
        if (out) { goodModel = model; return out; }
      } else {
        lastErr = 'HTTP ' + r.status;
        if (r.status === 401 || r.status === 403) lastErr = 'invalid key or no credit';
      }
    } catch (e) { lastErr = String(e.message || e); }
  }
  throw new Error('brain failed: ' + lastErr);
}

// Conversational reply, with shared memory across tablet + whatsapp.
export async function chat(text) {
  const s = load();
  s.conversation.push({ role: 'user', content: text });
  const messages = s.conversation.slice(-16);
  const reply = await call(messages);
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
    // On any failure, be safe: low urgency, plain summary.
    return { urgency: 'low', say: 'אדוני, יש עדכון חדש: ' + summary };
  }
}
