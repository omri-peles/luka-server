// THE TABLET AGENT. Streaming chat used only by the tablet HUD.
// call path keeps using chat() untouched. Here the answer is streamed from Claude and handed
// out sentence by sentence, so the tablet can start speaking the first sentence while the rest
// is still being written. Same memory, persona, context and tools as chat().
import { load, save } from './store.js';
import { isConnected } from './google.js';
import { PERSONA, TOOLS, WEATHER_TOOL, WA_TOOLS, runTool, liveContext, nowLine } from './brain.js';
import { CATEGORIES, remember, forget, memoryText } from './memory.js';

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
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'];

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
  const mem = memoryText();
  sys += "\n\nהזיכרון האישי שלך על אדוני (נשמר בין שיחות). השתמשי בו בתשובותייך, ושמרי בו דברים חדשים בכלי remember:" + (mem || "\n(עדיין ריק)");
  sys += "\n\nאת כעת בשיחה קולית חיה עם אדוני. עני מיד ובקיצור: משפט קצר אחד, לכל היותר שניים, בלי הקדמות ובלי לחזור על השאלה. אל תתקני ואל תתנצלי על תשובות קודמות אלא אם אדוני שאל על כך. התאריך והשעה שלמעלה הם שעון חי ומדויק לרגע זה: כשאת נשאלת מה השעה או מה התאריך, עני לפיהם בביטחון, גם אם בשיחה הקודמת נאמרה שעה אחרת.";
  return sys;
}

// One streamed model call. Calls onText(delta) as text arrives; returns { content, stop_reason }
// with the content blocks rebuilt exactly, so a tool round can be sent back to the model.
export async function streamOnce(messages, system, tools, onText) {
  let lastErr = '';
  for (const model of MODELS) {
    const body = { model, max_tokens: 600, system, messages, stream: true };
    if (tools && tools.length) body.tools = tools;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok || !r.body) { lastErr = model + ' HTTP ' + r.status; continue; }

    const blocks = []; const json = {}; let stop = '';
    const dec = new TextDecoder(); let buf = '';
    const handle = (ev) => {
      if (ev.type === 'content_block_start') {
        blocks[ev.index] = { ...ev.content_block };
        if (ev.content_block.type === 'tool_use') json[ev.index] = '';
      } else if (ev.type === 'content_block_delta') {
        const b = blocks[ev.index]; const d = ev.delta || {};
        if (!b) return;
        if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; onText(d.text); }
        else if (d.type === 'input_json_delta') json[ev.index] += d.partial_json || '';
        else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + (d.thinking || '');
        else if (d.type === 'signature_delta') b.signature = d.signature;
      } else if (ev.type === 'content_block_stop') {
        const b = blocks[ev.index];
        if (b && b.type === 'tool_use') { try { b.input = JSON.parse(json[ev.index] || '{}'); } catch { b.input = {}; } }
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
export async function chatStream(text, onSentence) {
  const s = load();
  s.conversation.push({ role: 'user', content: text });
  let messages = s.conversation.slice(-16);
  const connected = isConnected();
  const sys = await buildSystem(s, connected);
  const tools = [...(connected ? TOOLS : []), WEATHER_TOOL, ...WA_TOOLS, ...MEMORY_TOOLS];

  let full = '';
  const splitter = makeSentenceSplitter(onSentence);
  for (let i = 0; i < 4; i++) {
    const r = await streamOnce(messages, sys, tools, (t) => { full += t; splitter.push(t); });
    if (r.stop_reason === 'tool_use') {
      splitter.flush(); if (full && !/\s$/.test(full)) full += ' ';
      const results = [];
      for (const b of r.content) {
        if (b.type === 'tool_use') {
          const inp = b.input || {};
          const out = b.name === 'remember' ? remember(inp.category, inp.text)
            : b.name === 'forget' ? forget(inp.text)
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
  if (!reply) { reply = 'סליחה אדוני, לא הצלחתי להשלים את הפעולה. תוכל לנסות שוב?'; onSentence(reply); }

  s.conversation.push({ role: 'assistant', content: reply });
  if (s.conversation.length > 40) s.conversation = s.conversation.slice(-40);
  save();
  return reply;
}
