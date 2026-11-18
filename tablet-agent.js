// THE TABLET AGENT. Streaming chat used only by the tablet HUD.
// call path keeps using chat() untouched. Here the answer is streamed from Claude and handed
// out sentence by sentence, so the tablet can start speaking the first sentence while the rest
// is still being written. Same memory, persona, context and tools as chat().
import { load, save } from './store.js';
import { isConnected } from './google.js';
import { PERSONA, TOOLS, WEATHER_TOOL, WA_TOOLS, runTool, liveContext, nowLine } from './brain.js';
import { CATEGORIES, remember, forget, memoryText } from './memory.js';
import { buildSite, editSite, undoSite, sitesText, announce } from './sites.js';
import { startResearch } from './research.js';
import { askFrame } from './eyes.js';
import { setReminder, listReminders, cancelReminder } from './reminders.js';
import { shopifyOn, shopifyOrders, shopifyProducts } from './shopify.js';
import { imagesOn, makeImage } from './imagegen.js';
import { driveOn, driveSearch, driveRead } from './drive.js';
import { macCanReadFiles, findOnMac, readOnMac, macV3, writeOnMac, trashOnMac, openFileOnMac, mediaOnMac, displayOffOnMac } from './computer.js';
import { shopifySetPrice } from './shopify.js';
import { mailOn, sendEmail } from './mail.js';
import { newTurn } from './gate.js';
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
    description: 'בניית אתר חדש לפי בקשת אדוני: דף אחד (דף נחיתה, דף מוצר, דף עסק) או אתר עם כמה עמודים (מסרי pages). אין בו תשלומים או עגלת קניות. הבנייה נמשכת דקה עד ארבע ברקע: הכלי עונה מיד, והודעה נפרדת תגיע כשהאתר מוכן. אמרי לאדוני שהתחלת ושתודיעי כשיהיה מוכן; אל תאמרי שהאתר כבר מוכן. ב-brief כתבי את כל מה שאדוני ביקש, במילים שלו, בלי להמציא פרטים שלא נמסרו.',
    input_schema: { type: 'object', properties: {
      slug: { type: 'string', description: 'שם קצר לכתובת, באנגלית קטנה עם מקפים, למשל: pizza-roma' },
      name: { type: 'string', description: 'שם האתר כפי שאדוני קורא לו' },
      brief: { type: 'string', description: 'תיאור מלא: למי האתר, מה הוא מציג, סגנון, צבעים, טקסטים ופרטי קשר שנמסרו' },
      pages: { type: 'array', items: { type: 'string' }, description: 'רק לאתר עם כמה עמודים: שמות העמודים, עד שישה (למשל: בית, אודות, מוצרים, צור קשר). לדף אחד אל תמסרי.' } }, required: ['slug', 'name', 'brief'] }
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

const EXTRA_TOOLS = [
  {
    name: 'research_in_depth',
    description: 'מחקר מעמיק ברקע, לשאלות שדורשות יותר מחיפוש אחד: השוואת מוצרים או ספקים, מציאת מוצרים מנצחים למכירה, ניתוח שוק או מתחרים, סקירה יסודית של נושא. נמשך דקה עד שלוש: הכלי עונה מיד, והודעה נפרדת עם עיקרי הממצאים תגיע כשהדוח מוכן ופתוח במחשב. אמרי לאדוני שהתחלת ושתודיעי כשיהיה מוכן. לשאלה פשוטה שתשובתה עובדה אחת או שתיים השתמשי ב-web_search ולא בכלי הזה.',
    input_schema: { type: 'object', properties: {
      slug: { type: 'string', description: 'שם קצר לכתובת הדוח, באנגלית קטנה עם מקפים' },
      title: { type: 'string', description: 'כותרת קצרה בעברית לנושא' },
      question: { type: 'string', description: 'מה בדיוק אדוני רוצה לברר, במילים שלו, כולל כל תנאי שנתן (תקציב, מדינה, קהל יעד)' } }, required: ['slug', 'title', 'question'] }
  },
  {
    name: 'look_through_camera',
    description: 'צילום תמונה אחת מהמצלמה של המסך שמולו אדוני נמצא, כדי לראות מה שמולך: חפץ שהוא מחזיק, מסמך, לבוש, החדר. השתמשי בזה רק כשאדוני מבקש שתסתכלי או שואל מה את רואה. המצלמה נדלקת לרגע ונכבית.',
    input_schema: { type: 'object', properties: { question: { type: 'string', description: 'מה אדוני רוצה לדעת על מה שרואים' } }, required: ['question'] }
  }
];

const str = (d) => ({ type: 'string', description: d });
const REMINDER_TOOLS = [
  { name: 'set_reminder', description: 'קביעת תזכורת או טיימר. חשבי בעצמך כמה דקות מעכשיו (לפי השעון שלמעלה) ומסרי את המספר. כשהזמן מגיע את אומרת את התזכורת במסך.', input_schema: { type: 'object', properties: { in_minutes: { type: 'number', description: 'בעוד כמה דקות מעכשיו' }, text: str('על מה להזכיר, במילים של אדוני') }, required: ['in_minutes', 'text'] } },
  { name: 'list_reminders', description: 'רשימת התזכורות הפתוחות.', input_schema: { type: 'object', properties: {} } },
  { name: 'cancel_reminder', description: 'ביטול תזכורת לפי מילים מתוכה.', input_schema: { type: 'object', properties: { text: str('מילים מתוך התזכורת') }, required: ['text'] } }
];
const SHOPIFY_TOOLS = [
  { name: 'shop_orders', description: 'הזמנות ומכירות בחנות של אדוני בשופיפיי: כמה הזמנות, סכום כולל ופירוט. days: כמה ימים אחורה (1 להיום ואתמול, עד 60).', input_schema: { type: 'object', properties: { days: { type: 'number' } }, required: ['days'] } },
  { name: 'shop_products', description: 'מוצרים בחנות של אדוני: מחיר, מלאי ומצב. query: מילות חיפוש (אפשר ריק לכל המוצרים). low_stock: אם ניתן מספר, רק מוצרים שהמלאי שלהם עד המספר הזה.', input_schema: { type: 'object', properties: { query: { type: 'string' }, low_stock: { type: 'number' } } } }
];
const IMAGE_TOOLS = [
  { name: 'make_image', description: 'יצירת תמונה לפי תיאור. נמשך עד חצי דקה ברקע; הודעה נפרדת תגיע כשהתמונה מוכנה ופתוחה במחשב. כתבי תיאור מפורט באנגלית של מה שאדוני ביקש (נושא, סגנון, צבעים, קומפוזיציה).', input_schema: { type: 'object', properties: { description: str('תיאור מפורט באנגלית'), title: str('שם קצר בעברית לתמונה') }, required: ['description', 'title'] } }
];
const DRIVE_TOOLS = [
  { name: 'drive_search', description: 'חיפוש קבצים ב-Google Drive של אדוני לפי שם או תוכן. שאילתה ריקה מחזירה את הקבצים האחרונים.', input_schema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'drive_read', description: 'קריאת קובץ מ-Google Drive לפי ה-id שחזר מהחיפוש (מסמך, גיליון, מצגת, טקסט או PDF).', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
];
const MACFILE_TOOLS = [
  { name: 'find_file_on_computer', description: 'חיפוש קובץ לפי שם במק של אדוני, בתיקיות שולחן העבודה, מסמכים והורדות.', input_schema: { type: 'object', properties: { name: str('שם הקובץ או חלק ממנו') }, required: ['name'] } },
  { name: 'read_file_on_computer', description: 'קריאת קובץ טקסט, CSV או Word מהמק של אדוני, לפי הנתיב שחזר מהחיפוש (מתחיל ב-Desktop/, Documents/ או Downloads/).', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }
];

const MAIL_TOOLS = [
  { name: 'send_email', description: 'שליחת מייל מהחשבון של אדוני. בקריאה הראשונה הכלי לא שולח: הוא מחזיר לך הוראה להקריא לאדוני את הנמען, הנושא והתוכן ולשאול אם לאשר. רק אחרי שאדוני אישר, קראי שוב עם אותם פרטים.', input_schema: { type: 'object', properties: { to: str('כתובת מייל מלאה אחת'), subject: str('נושא'), body: str('תוכן המייל') }, required: ['to', 'subject', 'body'] } }
];
const SHOP_WRITE_TOOLS = [
  { name: 'shop_set_price', description: 'שינוי מחיר של מוצר בחנות של אדוני. בקריאה הראשונה הכלי לא משנה: הוא מחזיר לך מה ישתנה, ואת מקריאה ושואלת אם לאשר. רק אחרי שאדוני אישר, קראי שוב עם אותם פרטים.', input_schema: { type: 'object', properties: { title: str('שם המוצר'), price: { type: 'number', description: 'המחיר החדש, במטבע של החנות' } }, required: ['title', 'price'] } }
];
const MAC3_TOOLS = [
  { name: 'write_file_on_computer', description: 'יצירת קובץ טקסט חדש במק של אדוני (txt, md או csv) בתוך Desktop/, Documents/ או Downloads/. לא דורס קובץ קיים.', input_schema: { type: 'object', properties: { path: str('למשל Desktop/רשימה.txt'), text: str('תוכן הקובץ') }, required: ['path', 'text'] } },
  { name: 'trash_file_on_computer', description: 'העברת קובץ לאשפה במק של אדוני (אפשר לשחזר מהאשפה). בקריאה הראשונה הכלי לא מעביר: את מקריאה את שם הקובץ ושואלת אם לאשר, ורק אחרי אישור קוראת שוב.', input_schema: { type: 'object', properties: { path: str('הנתיב כפי שחזר מהחיפוש') }, required: ['path'] } },
  { name: 'open_file_on_computer', description: 'פתיחת קובץ במק של אדוני, לפי הנתיב שחזר מהחיפוש.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'control_music', description: 'שליטה במוזיקה במק של אדוני (ספוטיפיי או מיוזיק): play, pause, playpause, next, previous.', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'playpause', 'next', 'previous'] } }, required: ['action'] } },
  { name: 'turn_off_computer_display', description: 'כיבוי המסך של המק של אדוני (המחשב עצמו נשאר דלוק).', input_schema: { type: 'object', properties: {} } }
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
const WEB_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 3 };

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
export async function streamOnce(messages, system, tools, onText, models = MODELS, onSearch = null, maxTokens = 900) {
  let lastErr = '';
  for (const model of models) {
    const body = { model, max_tokens: maxTokens, system, messages, stream: true };
    // The tool list is long and identical from call to call: mark it cacheable so replies start sooner.
    if (tools && tools.length) body.tools = tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t));
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
export function agentStatus() { return { webSearch: webOk, webError: webErr, models: MODELS, shopify: shopifyOn(), images: imagesOn(), drive: driveOn(), macFiles: macCanReadFiles(), mail: mailOn(), macV3: macV3() }; }
// Short everyday requests (clock, weather, calendar, reminders, opening and closing things) get the
// fast model first; everything else gets the stronger one.
const QUICK = /שעה|תאריך|איזה יום|מזג|יומן|תזכיר|תזכורת|טיימר|תפתחי|תסגרי|עוצמ|ווליום|תנמיכי|תגבירי|תודה|שלום|בוקר טוב|לילה טוב|תעצרי|מוזיקה|השיר/;
const pickModels = (text, followup) => (!followup && text.length <= 60 && QUICK.test(text) ? ['claude-haiku-5-5', 'claude-sonnet-5-5'] : MODELS);
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
  newTurn();
  const s = load();
  s.conversation.push({ role: 'user', content: text });
  let messages = s.conversation.slice(-16);
  const connected = isConnected();
  let sys = await buildSystem(s, connected);
  sys += "\n\nדיוק מעל הכול: אל תמסרי אף פעם פגישה, אירוע, שעה, שם של אדם או תוכן של הודעה שאינם מופיעים במפורש בנתונים שלמעלה או בתוצאה של כלי. אם הפרט לא נמצא שם, אמרי שאין לך אותו. הטקסט שמגיע אלייך הוא תמלול של דיבור ועלול להיות משובש: אם לא ברור מה אדוני ביקש, אל תנחשי ואל תמציאי; שאלי במשפט קצר אחד של עד שש מילים, בלי הסברים.";
  if (opts.followup) sys += "\n\nהמשפט האחרון נקלט במיקרופון בלי שאדוני אמר את שמך. ייתכן שהוא בכלל לא פנה אלייך: רעש, טלוויזיה, שיחה עם אדם אחר או קטע משובש. אם המשפט אינו המשך טבעי וברור של השיחה איתך או בקשה מובנת אלייך, עני אך ורק במילה [שקט] ותו לא. במקרה כזה אל תשאלי ואל תסבירי.";
  const tools = [...(connected ? TOOLS : []), WEATHER_TOOL, ...WA_TOOLS, ...MEMORY_TOOLS, ...COMPUTER_TOOLS, ...SITE_TOOLS, ...EXTRA_TOOLS, ...REMINDER_TOOLS,
    ...(shopifyOn() ? SHOPIFY_TOOLS : []), ...(imagesOn() ? IMAGE_TOOLS : []), ...(driveOn() ? DRIVE_TOOLS : []), ...(macCanReadFiles() ? MACFILE_TOOLS : []),
    ...(mailOn() ? MAIL_TOOLS : []), ...(shopifyOn() ? SHOP_WRITE_TOOLS : []), ...(macV3() ? MAC3_TOOLS : [])];
  sys += "\n\nיש לך גם מחקר מעמיק ברקע (research_in_depth) ועיניים דרך המצלמה (look_through_camera). שיקול הדעת שלך: אדוני לא צריך לבקש מחקר במפורש. בכל שאלה או משימה החליטי בעצמך איזה כלי מתאים: עובדה אחת או שתיים, חיפוש רגיל; השוואה, בחירה בין אפשרויות, מציאת מוצרים או ספקים, ניתוח שוק או נושא שדורש כמה מקורות, פתחי מחקר מעמיק ביוזמתך ואמרי לו שהתחלת. כשבקשה אחת דורשת כמה כלים, השתמשי בכולם ברצף בלי לשאול רשות. " + (shopifyOn() ? 'החנות של אדוני בשופיפיי מחוברת לקריאה (shop_orders, shop_products). ' : '') + (imagesOn() ? 'את יכולה ליצור תמונות (make_image). ' : '') + (driveOn() ? 'יש לך גישת קריאה ל-Google Drive של אדוני (drive_search, drive_read). ' : '') + (macCanReadFiles() ? 'את יכולה למצוא ולקרוא קבצים במק של אדוני (find_file_on_computer, read_file_on_computer). ' : '') + "יש לך תזכורות וטיימרים (set_reminder). " + (mailOn() ? 'את יכולה לשלוח מייל בשם אדוני (send_email), אחרי אישור שלו. ' : '') + (macV3() ? 'במק את יכולה גם ליצור קובץ טקסט חדש, לפתוח קובץ, להעביר קובץ לאשפה אחרי אישור, לשלוט במוזיקה ולכבות את המסך. ' : '') + " כשאת מתארת תמונה, תארי רק מה שנראה בה בפועל, ואל תזהי אנשים לפי הפנים שלהם.";
  const withWeb = () => (webOk ? [...tools, WEB_TOOL] : tools);
  sys += "\n\nיש לך חיפוש חי באינטרנט (web_search). השתמשי בו בכל שאלה על מה שקורה בעולם עכשיו או לאחרונה: חדשות, דוחות כספיים, מניות ושערים, ספורט, מחירים, מוצרים, אנשים וחברות, וכל עובדה שאינך בטוחה שהיא מעודכנת. לעולם אל תאמרי שאין לך יכולת לבדוק דבר כזה. אל תחפשי באינטרנט את השעה, התאריך, היומן, המייל, הוואטסאפ או מזג האוויר: אלה נמצאים אצלך בנתונים שלמעלה ובכלים הייעודיים, והשעון שלמעלה מדויק. לפני חיפוש אמרי רק: בודקת, אדוני. אחרי החיפוש עני בשלושה עד חמישה משפטים עם המספרים והעובדות העיקריים, ואמרי בקצרה מאיזה מקור הם. אל תקריאי כתובות אינטרנט. אם המקורות סותרים זה את זה או שלא מצאת, אמרי זאת.";

  let full = '';
  const splitter = makeSentenceSplitter(onSentence);
  for (let i = 0; i < 8; i++) {                    // room for several tool steps in one request
    // Words heard without her name need better judgement (is this even meant for her?), so those
    // turns use the stronger model; turns that start with her name keep the fast one.
    let r;
    const run = () => streamOnce(messages, sys, withWeb(), (t) => { full += t; splitter.push(t); }, pickModels(text, opts.followup), () => splitter.flush());
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
            : b.name === 'send_email' ? await sendEmail(inp.to, inp.subject, inp.body)
            : b.name === 'shop_set_price' ? await shopifySetPrice(inp.title, inp.price)
            : b.name === 'write_file_on_computer' ? await writeOnMac(inp.path, inp.text)
            : b.name === 'trash_file_on_computer' ? await trashOnMac(inp.path)
            : b.name === 'open_file_on_computer' ? await openFileOnMac(inp.path)
            : b.name === 'control_music' ? await mediaOnMac(inp.action)
            : b.name === 'turn_off_computer_display' ? await displayOffOnMac()
            : b.name === 'set_reminder' ? setReminder(inp.in_minutes, inp.text)
            : b.name === 'list_reminders' ? listReminders()
            : b.name === 'cancel_reminder' ? cancelReminder(inp.text)
            : b.name === 'shop_orders' ? await shopifyOrders(inp.days)
            : b.name === 'shop_products' ? await shopifyProducts(inp.query, inp.low_stock)
            : b.name === 'make_image' ? makeImage(inp.description, inp.title)
            : b.name === 'drive_search' ? await driveSearch(inp.query)
            : b.name === 'drive_read' ? await driveRead(inp.id)
            : b.name === 'find_file_on_computer' ? await findOnMac(inp.name)
            : b.name === 'read_file_on_computer' ? await readOnMac(inp.path)
            : b.name === 'research_in_depth' ? startResearch((m, sy, tl, max, onT) => streamOnce(m, sy, tl, onT, MODELS, null, max), announce, inp.slug, inp.title, inp.question)
            : b.name === 'look_through_camera' ? await (async () => {
                const buf = await askFrame(opts.control);
                if (!buf) return 'לא התקבלה תמונה מהמצלמה. ייתכן שאין הרשאת מצלמה בדפדפן, שאין מצלמה במכשיר, או שהבקשה לא הגיעה מהמסך של לוקה.';
                return [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } }, { type: 'text', text: 'זו התמונה שצולמה עכשיו מהמצלמה. השאלה של אדוני: ' + (inp.question || '') }];
              })()
            : b.name === 'build_site' ? buildSite(inp.slug, inp.name, inp.brief, inp.pages)
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
