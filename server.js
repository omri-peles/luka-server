// Luka — 24/7 assistant brain.
// Front door for the tablet, Google auth, Twilio webhooks, and the proactive engine.
import express from 'express';
import cron from 'node-cron';
import path from 'path';
import { load, save, set, get } from './store.js';
import { authUrl, handleCallback, isConnected } from './google.js';
import { chat } from './brain.js';
import { audioPath, synthesize, filler, warmFillers } from './voice.js';
import crypto from 'crypto';
import { whatsappOwner, smsOwner } from './phone.js';
import { tick } from './proactive.js';
import { startWhatsApp, waStatus, waQR } from './whatsapp.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded

// The tablet HUD (hosted on Netlify) talks to this server from the browser, so allow its origin.
const TABLET_ORIGIN = process.env.TABLET_ORIGIN || 'https://grand-alfajores-b0e55e.netlify.app';
app.use((req, res, next) => {
  if (req.get('origin') === TABLET_ORIGIN) {
    res.set('Access-Control-Allow-Origin', TABLET_ORIGIN);
    res.set('Access-Control-Allow-Headers', 'content-type, x-luka-token');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

const PORT = process.env.PORT || 3000;
const TOKEN = () => process.env.TABLET_TOKEN || '';

function authOk(req) {
  const t = req.query.token || req.body?.token || req.get('x-luka-token');
  if (!t) return false;
  if (TOKEN() && t === TOKEN()) return true;
  return (get('deviceTokens') || []).includes(t);   // devices paired with a one-time code
}

// ---------- device pairing: a 6-digit code sent to the owner's phone ----------
let pair = { code: '', exp: 0, tries: 0, last: 0 };
app.post('/pair/request', async (_req, res) => {
  if (Date.now() - pair.last < 60000) return res.status(429).json({ error: 'wait' });
  pair = { code: String(crypto.randomInt(100000, 1000000)), exp: Date.now() + 10 * 60000, tries: 0, last: Date.now() };
  const text = 'קוד החיבור של לוקה לטאבלט: ' + pair.code;
  let r = await whatsappOwner(text);
  let channel = 'whatsapp';
  if (!r.ok) { r = await smsOwner(text); channel = 'sms'; }
  if (!r.ok) return res.status(502).json({ error: 'send-failed' });
  res.json({ ok: true, channel });
});
app.post('/pair/confirm', (req, res) => {
  const code = (req.body?.code || '').toString().trim();
  if (!pair.code || Date.now() > pair.exp || pair.tries >= 5) return res.status(401).json({ error: 'expired' });
  if (code !== pair.code) { pair.tries++; return res.status(401).json({ error: 'wrong' }); }
  const token = crypto.randomBytes(24).toString('hex');
  set('deviceTokens', [...(get('deviceTokens') || []), token].slice(-5));
  pair = { code: '', exp: 0, tries: 0, last: 0 };
  res.json({ token });
});

// ---------- health / status ----------
app.get('/', (_req, res) => res.send('Luka is awake.'));
app.get('/health', (_req, res) => res.json({
  ok: true,
  google: isConnected(),
  pendingUpdates: (get('updates') || []).length
}));

// ---------- Google OAuth ----------
app.get('/auth/google', (_req, res) => {
  try { res.redirect(authUrl()); }
  catch (e) { res.status(500).send('Google OAuth not configured: ' + e.message); }
});
app.get('/auth/google/callback', async (req, res) => {
  try {
    await handleCallback(req.query.code);
    res.send('<h2>לוקה חוברה לחשבון Google שלך בהצלחה.</h2><p>אפשר לסגור את החלון.</p>');
  } catch (e) {
    res.status(500).send('שגיאה בחיבור Google: ' + e.message);
  }
});

// ---------- tablet API ----------
// Tablet polls this to (a) mark presence and (b) collect anything Luka wants to say.
app.get('/updates', (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: 'bad token' });
  set('lastTabletSeen', Date.now());
  const s = load();
  const items = s.updates;
  s.updates = [];
  save();
  res.json({ items });
});

// Lightweight presence ping (optional; /updates already marks presence).
app.post('/heartbeat', (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: 'bad token' });
  set('lastTabletSeen', Date.now());
  res.json({ ok: true });
});

// Shared chat: tablet (and WhatsApp) talk to the same Luka with shared memory.
app.post('/chat', async (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: 'bad token' });
  const text = (req.body?.text || '').toString().trim();
  if (!text) return res.status(400).json({ error: 'empty' });
  try {
    const reply = await chat(text, { phone: !!req.body?.voice });   // voice clients get short, fast answers
    res.json({ reply });
  } catch (e) {
    res.status(502).json({ error: 'brain', detail: e.message });
  }
});

// ---------- audio for Twilio <Play> ----------
app.get('/audio/:id.mp3', (req, res) => {
  const p = audioPath(req.params.id);
  if (!p) return res.status(404).send('not found');
  res.type('audio/mpeg');
  res.sendFile(path.resolve(p));
});

// TwiML webhook Twilio fetches when the call connects (canonical pattern; more reliable
// than inline TwiML for playing external audio). Plays Luka's clip twice.
app.all('/voice/:aid', (req, res) => {
  const base = process.env.PUBLIC_URL || '';
  const aid = path.basename(req.params.aid);
  const url = `${base}/audio/${aid}.mp3`;
  res.type('text/xml').send(
    `<Response><Pause length="1"/><Play>${url}</Play><Pause length="1"/><Play>${url}</Play></Response>`
  );
});

// ---------- Conversational call (two-way: Luka speaks, owner replies, she answers, repeat) ----------
// A real back-and-forth on the phone: Twilio <Gather> captures the owner's speech (Hebrew),
// we run it through her brain (shared memory + persona), speak the reply in her real voice,
// then listen again — until he says goodbye.
function gatherXml(base) {
  // speechTimeout=1: answer one second after he stops talking (auto waited noticeably longer).
  return `<Gather input="speech" language="he-IL" speechTimeout="1" action="${base}/convo/turn" method="POST"></Gather>`
       + `<Redirect method="POST">${base}/convo/turn</Redirect>`;
}
function speakXml(base, aid, text, lead = false) {
  // The leading <Pause> is needed only right after the call is answered (Twilio drops the start
  // of the first <Play> otherwise). Mid-call it would just be a second of dead air.
  const p = lead ? '<Pause length="1"/>' : '';
  if (aid) return `${p}<Play>${base}/audio/${aid}.mp3</Play>`;
  const safe = (text || '').replace(/[<&]/g, ' ');
  return `${p}<Say language="he-IL">${safe}</Say>`;
}

// First turn: play Luka's opening line (pre-synthesized, passed as ?aid=), then listen.
// NB: on /convo (not /voice/convo) so it doesn't collide with the /voice/:aid audio route above.
app.all('/convo', (req, res) => {
  const base = process.env.PUBLIC_URL || '';
  const aid = (req.query.aid || req.body?.aid || '').toString().replace(/[^a-z0-9]/gi, '');
  res.type('text/xml').send(`<Response>${speakXml(base, aid || null, '', true)}${gatherXml(base)}</Response>`);
});

// Each turn is split in two so the line never goes silent:
//   /convo/turn   -> start thinking in the background, instantly play a short "one sec" clip
//   /convo/answer -> wait for the answer that is already in flight, play it, listen again
const convoJobs = new Map();
app.post('/convo/turn', async (req, res) => {
  const base = process.env.PUBLIC_URL || '';
  const speech = (req.body?.SpeechResult || '').toString().trim();
  try {
    if (!speech) {
      const t = 'אדוני, אני עדיין כאן.';
      const aid = await synthesize(t);
      return res.type('text/xml').send(`<Response>${speakXml(base, aid, t)}${gatherXml(base)}</Response>`);
    }
    if (/להתראות|תודה לוקה|ביי לוקה|נתראה|סיימתי|זה הכל|זהו לעכשיו/.test(speech)) {
      const t = 'בשמחה אדוני. להתראות.';
      const aid = await synthesize(t);
      return res.type('text/xml').send(`<Response>${speakXml(base, aid, t)}<Hangup/></Response>`);
    }
    const job = crypto.randomBytes(8).toString('hex');
    convoJobs.set(job, (async () => {
      let reply;
      try { reply = await chat(speech, { phone: true }); } catch { reply = 'סליחה אדוני, נסה שוב.'; }
      return { reply, aid: await synthesize(reply) };
    })());
    setTimeout(() => convoJobs.delete(job), 120000);
    const f = await filler();
    res.type('text/xml').send(`<Response>${f ? `<Play>${base}/audio/${f}.mp3</Play>` : ''}<Redirect method="POST">${base}/convo/answer?job=${job}</Redirect></Response>`);
  } catch (e) {
    res.type('text/xml').send(`<Response><Say language="he-IL">סליחה אדוני, הייתה תקלה.</Say><Hangup/></Response>`);
  }
});
app.post('/convo/answer', async (req, res) => {
  const base = process.env.PUBLIC_URL || '';
  try {
    const p = convoJobs.get((req.query.job || '').toString());
    if (!p) return res.type('text/xml').send(`<Response>${gatherXml(base)}</Response>`);
    const { reply, aid } = await p;
    res.type('text/xml').send(`<Response>${speakXml(base, aid, reply)}${gatherXml(base)}</Response>`);
  } catch (e) {
    res.type('text/xml').send(`<Response>${gatherXml(base)}</Response>`);
  }
});

// ---------- WhatsApp (Twilio inbound) ----------
// Owner texts Luka on WhatsApp -> she replies in her voice/persona.
app.post('/whatsapp', async (req, res) => {
  const body = (req.body?.Body || '').toString().trim();
  const from = (req.body?.From || '').toString();
  const owner = process.env.OWNER_WHATSAPP || '';
  // Only respond to the owner's number.
  if (owner && from && from !== owner) {
    res.type('text/xml').send('<Response/>');
    return;
  }
  let reply = 'רגע אדוני, אני כאן.';
  try { if (body) reply = await chat(body); } catch { reply = 'סליחה אדוני, יש לי קושי רגעי. נסה שוב.'; }
  const safe = reply.replace(/[<&]/g, ' ');
  res.type('text/xml').send(`<Response><Message>${safe}</Message></Response>`);
});

// Manual trigger to test a proactive WhatsApp ping (optional).
app.post('/test/whatsapp', async (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: 'bad token' });
  const r = await whatsappOwner((req.body?.text || 'בדיקה: לוקה מחוברת.').toString());
  res.json(r);
});

// ---------- WhatsApp personal-account reader (Baileys) ----------
// Owner scans this QR once from his phone to let Luka read his INCOMING WhatsApp
// messages and flag urgent ones. Unofficial — may risk the number being banned.
app.get('/wa/link', (_req, res) => {
  res.type('html').send(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>חיבור וואטסאפ של לוקה</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;background:#0f172a;color:#e2e8f0;padding:24px">
<h2>חיבור וואטסאפ של לוקה</h2>
<p id="s">טוען…</p>
<img id="q" alt="QR" style="width:280px;height:280px;background:#fff;padding:10px;border-radius:12px;display:none"/>
<p style="opacity:.8;font-size:15px;max-width:360px;margin:16px auto">בוואטסאפ בטלפון: הגדרות ← מכשירים מקושרים ← קישור מכשיר ← וסרוק את הקוד.</p>
<script>
async function t(){try{const j=await(await fetch('/wa/qr')).json();
const s=document.getElementById('s'),q=document.getElementById('q');
if(j.state==='connected'){s.textContent='מחובר! לוקה קוראת עכשיו הודעות נכנסות. אפשר לסגור את החלון.';q.style.display='none';}
else if(j.qr){s.textContent='סרוק את הקוד מהוואטסאפ בטלפון';q.src=j.qr;q.style.display='inline-block';}
else{s.textContent='מתחבר… (מצב: '+j.state+')';q.style.display='none';}}catch(e){}}
setInterval(t,2500);t();
</script></body></html>`);
});
app.get('/wa/qr', (_req, res) => { const st = waStatus(); res.json({ state: st.state, qr: waQR() }); });

// ---------- proactive loop ----------
const minutes = Math.max(1, parseInt(process.env.POLL_MINUTES || '3', 10));
cron.schedule(`*/${minutes} * * * *`, () => { tick().catch(e => console.error('tick', e)); });

app.listen(PORT, () => {
  console.log(`Luka awake on :${PORT} — polling every ${minutes}m, Google ${isConnected() ? 'linked' : 'NOT linked'}`);
  // Start the personal-WhatsApp reader (non-blocking; shows a QR at /wa/link until linked).
  startWhatsApp().catch(e => console.error('[wa] boot error:', e.message));
  warmFillers().catch(() => {});   // pre-make the short call acknowledgements
});
