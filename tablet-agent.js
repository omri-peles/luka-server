// THE TABLET AGENT. Streaming chat used only by the tablet HUD.
// call path keeps using chat() untouched. Here the answer is streamed from Claude and handed
// out sentence by sentence, so the tablet can start speaking the first sentence while the rest
// is still being written. Same memory, persona, context and tools as chat().
import { load, save } from './store.js';
import { isConnected } from './google.js';
import { PERSONA, TOOLS, WEATHER_TOOL, WA_TOOLS, runTool, liveContext, nowLine } from './brain.js';
import { CATEGORIES, remember, forget, memoryText } from './memory.js';
import { buildSite, editSite, undoSite, sitesText } from './sites.js';
import { openOnComputer, closeOnComputer, computerOnline, macOnline, openAppOnComputer, volumeOnComputer } from './computer.js';

const COMPUTER_TOOLS = [
  {
    name: 'open_on_computer',
    description: 'פתיחת אתר בדפדפן של המחשב של אדוני (לא בטאבלט). השתמשי בזה כשאדוני מבקש לפתוח משהו במחשב. ליוטיוב: https://www.youtube.com או חיפוש https://www.youtube.com/results?search_query=... ; לחיפוש בגוגל: https://www.google.com/search?q=... ; לכל אתר אחר: הכתובת המלאה שלו.',
    input_schema: { type: 'object', properties: { url: { type: 'string', description: 'כתובת מלאה שמתחילה ב-https://' }, label: { type: 'string', description: 'שם קצר בעברית למה שנפתח, כפי שאדוני יקרא לו, למשל: עומר אדם יוטיוב, ויקיפדיה' } }, required: ['url', 'label'] }
  },
  {
    name: 'close_on_computer',
    description: 'סגירת לשוניות בדפדפן של המחשב של אדוני. what: "current" ללשונית שפתוחה כרגע מול העיניים, או מילה או שתיים מתוך שם הלשונית (למשל: עומר אדם, ויקיפדיה, YouTube). כתבי רק את המילים המזהות, בלי המילים לשונית או טאב. התוצאה שחוזרת היא מה שקרה בפועל במחשב: דווחי לאדוני בדיוק אותה, ואל תאמרי שנסגר אם לא נסגר.',
    input_schema: { type: 'object', properties: { what: { type: 'string' } }, required: ['what'] }
  },
  {
    name: 'open_app_on_computer',
    description: 'פתיחת אפליקציה במק של אדוני, לפי שמה באנגלית כפי שהיא נקראת במק (למשל: Spotify, Notes, Calculator, WhatsApp, Google Chrome).',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
  },
  {
    name: 'set_computer_volume',
    description: 'קביעת עוצמת הקול במק של אדוני, מספר בין 0 (שקט) ל-100.',
    input_schema: { type: 'object', properties: { level: { type: 'number' } }, required: ['level'] }
  }
];

const SITE_TOOLS = [
  {
    name: 'build_site',
    description: 'בניית אתר חדש של דף אחד (דף נחיתה, דף מוצר, דף עסק) לפי בקשת אדוני. הבנייה נמשכת כדקה ברקע: הכלי עונה מיד, והודעה נפרדת תגיע כשהאתר מוכן. אמרי לאדוני שהתחלת ושתודיעי כשיהיה מוכן; אל תאמרי שהאתר כבר מוכן. ב-brief כתבי את כל מה שאדוני ביקש, במילים שלו, בלי להמציא פרטים שלא נמסרו.',
    input_schema: { type: 'object', properties: {
      slug: { type: 'string', description: 'שם קצר לכתובת, באנגלית קטנה עם מקפים, למשל: pizza-roma' },
      name: { type: 'string', description: 'שם האתר כפי שאדוני קורא לו' },
      brief: { type: 'string', description: 'תיאור מלא: למי האתר, מה הוא מציג, סגנון, צבעים, טקסטים ופרטי קשר שנמסרו' } }, required: ['slug', 'name', 'brief'] }
  },
  {
    name: 'edit_site',
    description: 'שינוי באתר קיים שבנית (צבע, כותרת, טקסט, הוספת חלק). נמשך כדקה ברקע, והודעה נפרדת תגיע כשהסתיים. אם אדוני לא אמר איזה אתר, הכוונה לאחרון ברשימה.',
    input_schema: { type: 'object', properties: { slug: { type: 'string' }, instruction: { type: 'string', description: 'מה לשנות, במילים של אדוני' } }, required: ['slug', 'instruction'] }
  },
  {
    name: 'undo_site_change',
    description: 'החזרת אתר לגרסה שלפני השינוי האחרון.',
    input_schema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] }
  }
];

const MEMORY_TOOLS = [
  {
    name: 'remember',
    description: 'שמירת עובדה לזיכרון האישי לטווח ארוך: העדפה, פרויקט, משימה פתוחה, אדם או ספק, החלטה, הרגל. השתמשי בזה מיוזמתך בכל פעם שאדוני מספר דבר כזה, בלי לשאול.',
    input_schema: { type: 'object', properties: {
      category: { type: 'string', enum: CATEGORIES },
      text: { type: 'string', description: 'העובדה במשפט קצר וברור שיהיה מובן גם בעוד חודש.' } }, required: ['category', 'text'] }
  },
  {
    name: 'forget',
    description: 'מחיקת פריטים מהזיכרון האישי שמכילים את הטקסט הנתון. רק כשאדוני מבקש לשכוח או כשמשימה הושלמה.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
  }
];

const KEY = () => process.env.ANTHROPIC_API_KEY || '';
const MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5'];   // the stronger model first: measured about as fast for short spoken answers
// Live knowledge of the world: Anthropic runs the search on its side and hands her the results.
const WEB_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', country: 'IL', timezone: 'Asia/Jerusalem' } };

// Calendar + mail context, kept warm for the tablet: answer immediately from the last copy and
// refresh it in the background, instead of making him wait on Google before every answer.
let ctx = '', ctxAt = 0, warm = null;
async function fastContext() {
  if (!warm) warm = setInterval(() => { liveContext().then(v => { if (v) { ctx = v; ctxAt = Date.now(); } }).catch(() => {}); }, 100000);
  if (!ctx) { ctx = await liveContext(); ctxAt = Date.now(); return ctx; }
  if (Date.now() - ctxAt > 60000) { ctxAt = Date.now(); liveContext().then(v => { if (v) ctx = v; }).catch(() => {}); }
  return ctx;
}

async function buildSystem(s, connected) {
  let sys = PERSONA + "\n\nהתאריך והשעה הנוכחיים (אזור זמן ישראל): " + nowLine() + ". " +
    "כשאדוני אומר 'מחר', 'יום ראשון הבא' וכדומה — חשבי את התאריך המדויק ביחס לעכשיו.";
  sys += "\n\nהיכולות שלך: שעון ותאריך (למעלה), מזג אוויר (דרך הכלי get_weather), הודעות וואטסאפ נכנסות אחרונות, שליחת וואטסאפ בשם אדוני (שולחת מיד ואז חוזרת על הנמען והנוסח), " +
    (connected
      ? "וגישה חיה ליומן (קריאה וכתיבה) ולמייל של אדוני. לעולם אל תאמרי שאין לך גישה לדברים האלה."
      : "אך החיבור ל-Google (יומן ומייל) מנותק כרגע; אם תישאלי על יומן או מייל, אמרי שהחיבור ל-Google דורש חידוש.");
  if (connected) sys += await fastContext();
  const wa = (s.waRecent || []).slice(-8);
  if (wa.length) {
    sys += "\n\nהודעות וואטסאפ אחרונות שאדוני קיבל (יש לך גישה לקרוא אותן):\n" +
      wa.map(m => `- ${m.from}: ${m.body}`).join('\n');
  }
  sys += "\n\nהמחשב של אדוני " + (macOnline() ? "מחובר דרך תוכנת העזר: את יכולה לפתוח בו אתרים (open_on_computer), לסגור כל לשונית בכרום לפי שמה (close_on_computer), לפתוח אפליקציות (open_app_on_computer) ולקבוע עוצמת קול (set_computer_volume). פעולות אחרות במחשב עדיין לא אפשריות."
    : computerOnline() ? "מחובר דרך הדף בלבד: את יכולה לפתוח בו אתרים (open_on_computer) ולסגור רק לשוניות שאת פתחת (close_on_computer). אפליקציות ועוצמת קול לא זמינות עד שתוכנת העזר תותקן במק."
    : "לא מחובר כרגע.");
  const st = sitesText();
  sys += "\n\nבניית אתרים: את יכולה לבנות אתר של דף אחד (build_site) ולשנות אתר קיים (edit_site). חנות עם תשלומים או אתר רב-עמודי עדיין לא אפשריים." + (st ? " האתרים שבנית עד כה, מהישן לחדש:\n" + st : "");
  const mem = memoryText();
  sys += "\n\nהזיכרון האישי שלך על אדוני (נשמר בין שיחות). השתמשי בו בתשובותייך, ושמרי בו דברים חדשים בכלי remember:" + (mem || "\n(עדיין ריק)");
  sys += "\n\nאת כעת בשיחה קולית חיה עם אדוני. עני מיד ובקיצור: משפט קצר אחד, לכל היותר שניים, בלי הקדמות ובלי לחזור על השאלה. אל תתקני ואל תתנצלי על תשובות קודמות אלא אם אדוני שאל על כך. התאריך והשעה שלמעלה הם שעון חי ומדויק לרגע זה: כשאת נשאלת מה השעה או מה התאריך, עני לפיהם בביטחון, גם אם בשיחה הקודמת נאמרה שעה אחרת.";
  return sys;
}

// One streamed model call. Calls onText(delta) as text arrives; returns { content, stop_reason }
// with the content blocks rebuilt exactly, so a tool round can be sent back to the model.
export async function streamOnce(messages, system, tools, onText, models = MODELS, onSearch = null) {
  let lastErr = '';
  for (const model of models) {
    const body = { model, max_tokens: 900, system, messages, stream: true };
    if (tools && tools.length) body.tools = tools;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok || !r.body) { let detail = ''; try { detail = (await r.text()).slice(0, 300); } catch {} lastErr = model + ' HTTP ' + r.status + ' ' + detail; continue; }

    const blocks = []; const json = {}; let stop = '';
    const dec = new TextDecoder(); let buf = '';
    const handle = (ev) => {
      if (ev.type === 'content_block_start') {
        blocks[ev.index] = { ...ev.content_block };
        const bt = ev.content_block.type;
        if (bt === 'tool_use' || bt === 'server_tool_use') json[ev.index] = '';
        if (bt === 'server_tool_use' && onSearch) onSearch();            // she is about to search: say what she has so far
        if (bt === 'text' && ev.index > 0) onText(' ');
      } else if (ev.type === 'content_block_delta') {
        const b = blocks[ev.index]; const d = ev.delta || {};
        if (!b) return;
        if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; onText(d.text); }
        else if (d.type === 'input_json_delta') json[ev.index] = (json[ev.index] || '') + (d.partial_json || '');
        else if (d.type === 'citations_delta') b.citations = [...(b.citations || []), d.citation];
        else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + (d.thinking || '');
        else if (d.type === 'signature_delta') b.signature = d.signature;
      } else if (ev.type === 'content_block_stop') {
        const b = blocks[ev.index];
        if (b && (b.type === 'tool_use' || b.type === 'server_tool_use')) { try { b.input = JSON.parse(json[ev.index] || '{}'); } catch { b.input = {}; } }
      } else if (ev.type === 'message_delta') {
        if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
      } else if (ev.type === 'error') {
        throw new Error('stream error: ' + (ev.error && ev.error.message || 'unknown'));
      }
    };
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let ev; try { ev = JSON.parse(data); } catch { continue; }
          handle(ev);
        }
      }
    }
    return { content: blocks.filter(Boolean), stop_reason: stop };
  }
  throw new Error('brain stream failed: ' + lastErr);
}

// Splits streamed text into speakable sentences. A boundary is sentence punctuation followed
// by whitespace (so "17.11" and "15:15" stay whole) or a line break; very short fragments are
// merged with what follows so she doesn't speak in two-word clips.
export function makeSentenceSplitter(emit, minLen = 25) {
  let buf = '', first = true;
  return {
    push(t) {
      buf += t;
      for (;;) {
        // The first chunk may also end at a comma (after a few words) so she starts talking sooner.
        const re = first ? /[.!?…,]["')\]]?\s+|\n+/g : /[.!?…]["')\]]?\s+|\n+/g;
        const need = first ? 14 : minLen;
        let m, cut = -1;
        while ((m = re.exec(buf))) { if (m.index + m[0].length >= need) { cut = m.index + m[0].length; break; } }
        if (cut < 0) break;
        const piece = buf.slice(0, cut).trim(); buf = buf.slice(cut);
        if (piece) { emit(piece); first = false; }
      }
    },
    flush() { const piece = buf.trim(); buf = ''; if (piece) emit(piece); }
  };
}

// Streamed, tool-capable reply. onSentence(text) is called for each sentence as soon as it is
// complete. Returns the full reply. Shares conversation memory with chat().
let webOk = true, webErr = '';
export function agentStatus() { return { webSearch: webOk, webError: webErr, models: MODELS }; }
const SILENT = /^\s*\[?\s*שקט\s*\]?[.!]?\s*$/;
const NOT_UNDERSTOOD = /לא (?:הצלחתי להבין|הבנתי|ברור לי|שמעתי)|למה (?:אתה מתכוון|התכוונת|הכוונה)|תוכל לחזור|התמלול/;
export async function chatStream(text, onSentenceRaw, opts = {}) {
  // Without her name, a reply that only says "I didn't understand" means the words were not
  // meant for her (or were garbled): hold the opening until that is clear, then stay silent.
  let held = [], decided = !opts.followup, mute = false;
  const onSentence = (p) => {
    if (SILENT.test(p) || mute) return;
    if (decided) return onSentenceRaw(p);
    held.push(p);
    const sofar = held.join(' ');
    if (NOT_UNDERSTOOD.test(sofar)) { mute = true; held = []; return; }
    if (sofar.length >= 45) { decided = true; for (const h of held) onSentenceRaw(h); held = []; }
  };
  const releaseHeld = () => { if (!mute && !decided) { decided = true; for (const h of held) onSentenceRaw(h); held = []; } };
  const s = load();
  s.conversation.push({ role: 'user', content: text });
  let messages = s.conversation.slice(-16);
  const connected = isConnected();
  let sys = await buildSystem(s, connected);
  sys += "\n\nדיוק מעל הכול: אל תמסרי אף פעם פגישה, אירוע, שעה, שם של אדם או תוכן של הודעה שאינם מופיעים במפורש בנתונים שלמעלה או בתוצאה של כלי. אם הפרט לא נמצא שם, אמרי שאין לך אותו. הטקסט שמגיע אלייך הוא תמלול של דיבור ועלול להיות משובש: אם לא ברור מה אדוני ביקש, אל תנחשי ואל תמציאי; שאלי במשפט קצר אחד של עד שש מילים, בלי הסברים.";
  if (opts.followup) sys += "\n\nהמשפט האחרון נקלט במיקרופון בלי שאדוני אמר את שמך. ייתכן שהוא בכלל לא פנה אלייך: רעש, טלוויזיה, שיחה עם אדם אחר או קטע משובש. אם המשפט אינו המשך טבעי וברור של השיחה איתך או בקשה מובנת אלייך, עני אך ורק במילה [שקט] ותו לא. במקרה כזה אל תשאלי ואל תסבירי.";
  const tools = [...(connected ? TOOLS : []), WEATHER_TOOL, ...WA_TOOLS, ...MEMORY_TOOLS, ...COMPUTER_TOOLS, ...SITE_TOOLS];
  const withWeb = () => (webOk ? [...tools, WEB_TOOL] : tools);
  sys += "\n\nיש לך חיפוש חי באינטרנט (web_search). השתמשי בו בכל שאלה על מה שקורה בעולם עכשיו או לאחרונה: חדשות, דוחות כספיים, מניות ושערים, ספורט, מחירים, מוצרים, אנשים וחברות, וכל עובדה שאינך בטוחה שהיא מעודכנת. לעולם אל תאמרי שאין לך יכולת לבדוק דבר כזה. לפני חיפוש אמרי רק: בודקת, אדוני. אחרי החיפוש עני בשלושה עד חמישה משפטים עם המספרים והעובדות העיקריים, ואמרי בקצרה מאיזה מקור הם. אל תקריאי כתובות אינטרנט. אם המקורות סותרים זה את זה או שלא מצאת, אמרי זאת.";

  let full = '';
  const splitter = makeSentenceSplitter(onSentence);
  for (let i = 0; i < 4; i++) {
    // Words heard without her name need better judgement (is this even meant for her?), so those
    // turns use the stronger model; turns that start with her name keep the fast one.
    let r;
    const run = () => streamOnce(messages, sys, withWeb(), (t) => { full += t; splitter.push(t); }, MODELS, () => splitter.flush());
    try { r = await run(); }
    catch (e) {                                   // if the search tool itself is refused, carry on without it
      if (webOk && /HTTP 400/.test(String(e.message)) && !full) { webOk = false; webErr = String(e.message).slice(0, 400); r = await run(); }
      else throw e;
    }
    if (r.stop_reason === 'pause_turn') { messages = [...messages, { role: 'assistant', content: r.content }]; continue; }
    if (r.stop_reason === 'tool_use') {
      splitter.flush(); if (full && !/\s$/.test(full)) full += ' ';
      const results = [];
      for (const b of r.content) {
        if (b.type === 'tool_use') {
          const inp = b.input || {};
          const out = b.name === 'remember' ? remember(inp.category, inp.text)
            : b.name === 'forget' ? forget(inp.text)
            : b.name === 'build_site' ? buildSite(inp.slug, inp.name, inp.brief)
            : b.name === 'edit_site' ? editSite(inp.slug, inp.instruction)
            : b.name === 'undo_site_change' ? undoSite(inp.slug)
            : b.name === 'open_on_computer' ? await openOnComputer(inp.url, inp.label)
            : b.name === 'close_on_computer' ? await closeOnComputer(inp.what)
            : b.name === 'open_app_on_computer' ? await openAppOnComputer(inp.name)
            : b.name === 'set_computer_volume' ? await volumeOnComputer(inp.level)
            : await runTool(b.name, inp);
          results.push({ type: 'tool_result', tool_use_id: b.id, content: out });
        }
      }
      messages = [...messages, { role: 'assistant', content: r.content }, { role: 'user', content: results }];
      continue;
    }
    break;
  }
  splitter.flush();
  let reply = full.trim();
  releaseHeld();
  if (SILENT.test(reply) || mute) {                         // not addressed to her: say nothing, remember nothing
    const i = s.conversation.length - 1;
    if (i >= 0 && s.conversation[i].role === 'user' && s.conversation[i].content === text) s.conversation.pop();
    save();
    return '';
  }
  if (!reply) { reply = 'סליחה אדוני, לא הצלחתי להשלים את הפעולה. תוכל לנסות שוב?'; onSentence(reply); }

  s.conversation.push({ role: 'assistant', content: reply });
  if (s.conversation.length > 40) s.conversation = s.conversation.slice(-40);
  save();
  return reply;
}
