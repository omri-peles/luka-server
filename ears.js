// Luka's own ears for the TABLET page only (the phone agent does not use this file).
// The tablet records short pieces of speech and posts them here; this turns them into Hebrew
// text with ElevenLabs Scribe. It replaces the browser's built-in speech recognition, which
// is unreliable on Android tablets and missing inside kiosk apps.
import express from 'express';

const KEY = () => process.env.ELEVENLABS_API_KEY || '';
const DAILY_MIN = () => Number(process.env.STT_DAILY_MIN || 240);     // safety cap: minutes of audio per day
let day = '', usedSec = 0, tokens = 0, useKeyterms = true;

async function transcribe(buf, type) {
  const call = async (withTerms) => {
    const fd = new FormData();
    fd.append('model_id', 'scribe_v2');
    fd.append('language_code', 'he');
    fd.append('tag_audio_events', 'false');
    fd.append('timestamps_granularity', 'none');
    if (withTerms) fd.append('keyterms', 'לוקה');
    const pcm = /audio\/pcm/i.test(type || '');                  // raw 16 kHz mono 16-bit: the fastest path
    if (pcm) fd.append('file_format', 'pcm_s16le_16');
    fd.append('file', new Blob([buf], { type: pcm ? 'application/octet-stream' : (type || 'audio/wav') }), pcm ? 'speech.pcm' : 'speech.wav');
    return fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': KEY() }, body: fd });
  };
  let r = await call(useKeyterms);
  if (!r.ok && useKeyterms && (r.status === 400 || r.status === 422)) { useKeyterms = false; r = await call(false); }
  if (!r.ok) throw new Error('stt HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const j = await r.json();
  return (j.text || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

export function mountEars(app, authOk) {
  app.post('/stt', express.raw({ type: () => true, limit: '3mb' }), async (req, res) => {
    if (!authOk(req)) return res.status(401).json({ error: 'bad token' });
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || buf.length < 3000) return res.json({ text: '' });
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) { day = today; usedSec = 0; }
    const sec = Math.max(0.3, Number(req.get('x-audio-seconds')) || buf.length / 32000);
    if (usedSec + sec > DAILY_MIN() * 60) return res.status(429).json({ error: 'daily-cap' });
    usedSec += sec;
    try { res.json({ text: await transcribe(buf, req.get('content-type')) }); }
    catch (e) { console.error(e.message); res.status(502).json({ error: 'stt', detail: e.message }); }
  });
  // Live transcription: the tablet talks to ElevenLabs directly over a WebSocket, using a
  // short-lived single-use token from here (the real key never leaves the server).
  app.post('/stt/token', async (req, res) => {
    if (!authOk(req)) return res.status(401).json({ error: 'bad token' });
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) { day = today; usedSec = 0; tokens = 0; }
    usedSec += Math.max(0, Math.min(3600, Number(req.get('x-used-seconds')) || 0));   // what the tablet streamed since its last token
    if (usedSec > DAILY_MIN() * 60 || tokens >= 3000) return res.status(429).json({ error: 'daily-cap' });
    try {
      const r = await fetch('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', { method: 'POST', headers: { 'xi-api-key': KEY() } });
      if (!r.ok) return res.status(502).json({ error: 'token', detail: 'HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160) });
      tokens++;
      res.json({ token: (await r.json()).token });
    } catch (e) { res.status(502).json({ error: 'token' }); }
  });
  app.get('/stt/usage', (req, res) => {
    if (!authOk(req)) return res.status(401).json({ error: 'bad token' });
    res.json({ day, minutesToday: Math.round(usedSec / 6) / 10, capMinutes: DAILY_MIN(), keyterms: useKeyterms, liveTokens: tokens });
  });
}
