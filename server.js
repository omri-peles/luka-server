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
import twilio from 'twilio';
import { takeAll, report, takeMac } from './computer.js';
import fs from 'fs';
import { readSite, deleteSite } from './sites.js';
import { mountEars } from './ears.js';
import { whatsappOwner, smsOwner, callOwner } from './phone.js';
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

// ---------- Twilio signature guard ----------
// The call and WhatsApp webhooks must only accept requests really sent by Twilio. To make sure
// this can never lock Twilio itself out, each route starts in OBSERVE mode and only begins
// rejecting unsigned requests after it has seen one correctly signed request on that same
// route (which proves the check is configured right). TWILIO_SIG_ENFORCE=off disables blocking.
const TW_PATHS = /^\/(convo|incoming-call|whatsapp|voice)(\/|$)/;
const sigStats = { ok: 0, bad: 0, blocked: 0 };
function validTwilio(req) {
  const sig = req.get('x-twilio-signature'), token = process.env.TWILIO_AUTH_TOKEN;
  if (!sig || !token) return false;
  const params = req.method === 'POST' ? (req.body || {}) : {};
  const urls = [(process.env.PUBLIC_URL || '') + req.originalUrl,
    `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}${req.originalUrl}`];
  return urls.some(u => { try { return twilio.validateRequest(token, sig, u, params); } catch { return false; } });
}
app.use((req, res, next) => {
  if (!TW_PATHS.test(req.path)) return next();
  const key = req.method + ' ' + req.path.replace(/^\/voice\/.*/, '/voice/:aid');
  const armed = get('twilioSigArmed') || {};
  if (validTwilio(req)) {
    sigStats.ok++;
    if (!armed[key]) { armed[key] = true; set('twilioSigArmed', armed); console.log('[sig] armed:', key); }
    return next();
  }
  sigStats.bad++;
  if (armed[key] && process.env.TWILIO_SIG_ENFORCE !== 'off') { sigStats.blocked++; return res.status(403).send('forbidden'); }
  next();
});

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
  pendingUpdates: (get('updates') || []).length,
  twilioSignature: { ...sigStats, armedRoutes: Object.keys(get('twilioSigArmed') || {}) }
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

// ---------- TABLET PAGE served from this server (no keys needed in the browser) ----------
app.get('/luka', (_req, res) => res.sendFile(path.resolve('./hud.html')));
// Voice for the tablet page: same voice.js as everywhere, key stays on the server.
app.post('/tts', async (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: 'bad token' });
  const text = (req.body?.text || '').toString().trim().slice(0, 700);
  if (!text) return res.status(400).json({ error: 'empty' });
  try {
    const id = await synthesize(text);
    const p = id && audioPath(id);
    if (!p) return res.status(502).json({ error: 'tts' });
    res.type('audio/mpeg').sendFile(path.resolve(p));
  } catch (e) { res.status(502).json({ error: 'tts' }); }
});

// ---------- TABLET EARS: speech-to-text for the tablet page (see ears.js) ----------
mountEars(app, authOk);

// ---------- LUKA'S HAND on the computer ----------
app.get('/hand', (_req, res) => res.sendFile(path.resolve('./hand.html')));
app.get('/computer/next', (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: 'bad token' });
  res.json({ items: takeAll() });
});
app.post('/computer/result', (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: 'bad token' });
  report((req.body && req.body.id) || '', (req.body && req.body.text) || '');
  res.json({ ok: true });
});

// ---------- SITES that Luka built (public pages) ----------
// Served sandboxed: the page gets its own isolated origin, so nothing inside it can read
// Luka's stored device token or call her endpoints as the owner.
app.get('/sites/:slug', (req, res) => {
  const html = readSite(req.params.slug);
  if (!html) return res.status(404).type('text/plain').send('Not found');
  res.set('Content-Security-Policy', "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation");
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'no-store');
  res.type('text/html').send(html);
});

app.post('/sites/:slug/delete', (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: 'bad token' });
  res.json({ ok: deleteSite(req.params.slug) });
});

// ---------- LUKA'S HAND as a small background program on the Mac ----------
// The scripts are public (no secrets inside); the helper itself pairs with a one-time code.
for (const f of ['install.sh', 'agent.sh', 'uninstall.sh']) {
  app.get('/mac/' + f, (req, res) => {
    try {
      const base = 'https://' + req.get('host');
      res.type('text/plain').send(fs.readFileSync(path.resolve('./mac-' + f), 'utf8').replace(/__SERVER__/g, base));
    } catch (e) { res.status(404).end(); }
  });
}
app.get('/mac/next', async (req, res) => {
  if (!authOk(req)) return res.status(401).end();
  if (req.query.probe) return res.type('text/plain').send('');
  res.type('text/plain').send(await takeMac());
});
app.post('/mac/result', (req, res) => {
  if (!authOk(req)) return res.status(401).end();
  report((req.body && req.body.id) || '', (req.body && req.body.text) || '');
  res.type('text/plain').send('ok');
});

// ---------- TABLET AGENT: streamed chat (sentence by sentence) ----------
// Separate from the phone agent. Loaded lazily so that a fault here can never take the
// server (and with it the phone calls) down.
app.post('/chat/stream', async (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: 'bad token' });
  const text = (req.body?.text || '').toString().trim();
  if (!text) return res.status(400).json({ error: 'empty' });
  res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  if (res.flushHeaders) res.flushHeaders();
  try {
    const { chatStream } = await import('./tablet-agent.js');
    const reply = await chatStream(text, (sentence) => res.write(JSON.stringify({ s: sentence }) + '\n'));
    res.write(JSON.stringify({ done: true, reply }) + '\n');
  } catch (e) {
    res.write(JSON.stringify({ error: String(e.message || e) }) + '\n');
  }
  res.end();
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

// INCOMING call: the owner dials Luka's number whenever he likes and talks to her. Only his own
// phone is answered; anyone else is rejected. After the greeting it joins the same turn loop.
let helloId = null;
app.post('/incoming-call', async (req, res) => {
  const base = process.env.PUBLIC_URL || '';
  const digits = x => (x || '').toString().replace(/\D/g, '');
  const from = digits(req.body?.From), owner = digits(process.env.OWNER_PHONE);
  if (!owner || from.slice(-9) !== owner.slice(-9)) return res.type('text/xml').send('<Response><Reject/></Response>');
  try {
    const t = 'כן אדוני, אני מקשיבה.';
    if (!helloId || !audioPath(helloId)) helloId = await synthesize(t);
    res.type('text/xml').send(`<Response>${speakXml(base, helloId, t, true)}${gatherXml(base)}</Response>`);
  } catch (e) {
    res.type('text/xml').send(`<Response>${gatherXml(base)}</Response>`);
  }
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
  // "Call me": the owner writes to Luka and she rings him right away (no international dialing
  // needed on his side). Works at any hour, since he asked for it himself.
  if (/תתקשרי|התקשרי|תצלצלי|צלצלי אלי/.test(body)) {
    callOwner('כן אדוני, אני מקשיבה.').then(r => { if (!r.ok) console.warn('[call-me] failed:', r.reason); });
    return res.type('text/xml').send('<Response><Message>מתקשרת אליך עכשיו, אדוני.</Message></Response>');
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
