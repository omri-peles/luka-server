// Luka — 24/7 assistant brain.
// Front door for the tablet, Google auth, Twilio webhooks, and the proactive engine.
import express from 'express';
import cron from 'node-cron';
import path from 'path';
import { load, save, set, get } from './store.js';
import { authUrl, handleCallback, isConnected } from './google.js';
import { chat } from './brain.js';
import { audioPath } from './voice.js';
import { whatsappOwner } from './phone.js';
import { tick } from './proactive.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded

const PORT = process.env.PORT || 3000;
const TOKEN = () => process.env.TABLET_TOKEN || '';

function authOk(req) {
  const t = req.query.token || req.body?.token || req.get('x-luka-token');
  return TOKEN() && t === TOKEN();
}

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
    const reply = await chat(text);
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

// ---------- proactive loop ----------
const minutes = Math.max(1, parseInt(process.env.POLL_MINUTES || '3', 10));
cron.schedule(`*/${minutes} * * * *`, () => { tick().catch(e => console.error('tick', e)); });

app.listen(PORT, () => {
  console.log(`Luka awake on :${PORT} — polling every ${minutes}m, Google ${isConnected() ? 'linked' : 'NOT linked'}`);
});
