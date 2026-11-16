// Luka's voice (ElevenLabs "Danit"). Generates an MP3 file on disk and returns its id, so
// Twilio can <Play> it over a phone call in her real voice. MP3 is self-describing (its sample
// rate is embedded), so Twilio decodes it correctly — unlike a hand-built WAV header.
import fs from 'fs';
import path from 'path';

const AUDIO_DIR = path.resolve('./data/audio');
const KEY = () => process.env.ELEVENLABS_API_KEY || '';
const VOICE = () => process.env.ELEVENLABS_VOICE_ID || 's0T0DT6EAPeX57MQpn3I';
// eleven_v3 pronounces Hebrew correctly (owner's pick); the rest are fallbacks.
const MODELS = ['eleven_v3', 'eleven_multilingual_v2', 'eleven_turbo_v2_5'];
let goodModel = '';

function ensure() { if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true }); }

// Returns the audio id (filename stem) or null on failure. Writes an MP3.
export async function synthesize(text) {
  if (!KEY()) return null;
  ensure();
  const order = goodModel ? [goodModel, ...MODELS.filter(m => m !== goodModel)] : MODELS;
  for (const model of order) {
    try {
      const r = await fetch(
        'https://api.elevenlabs.io/v1/text-to-speech/' + VOICE() + '?output_format=mp3_44100_128',
        {
          method: 'POST',
          headers: { 'xi-api-key': KEY(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            model_id: model,
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
          })
        }
      );
      if (r.ok) {
        goodModel = model;
        const buf = Buffer.from(await r.arrayBuffer());
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        fs.writeFileSync(path.join(AUDIO_DIR, id + '.mp3'), buf);
        return id;
      }
    } catch { /* try next model */ }
  }
  return null;
}

// Tiny pre-made acknowledgements ("one sec") played the instant the owner stops talking on a
// call, while the real answer is being prepared — so the line never goes dead.
const FILLERS = ['כן.', 'שנייה.', 'מיד.', 'בודקת.'];
const fillerIds = {};
export async function filler() {
  const t = FILLERS[Math.floor(Math.random() * FILLERS.length)];
  if (fillerIds[t] && audioPath(fillerIds[t])) return fillerIds[t];
  // Not cached: make it in the background and skip the filler this time (never wait for it).
  synthesize(t).then(id => { if (id) fillerIds[t] = id; }).catch(() => {});
  return null;
}
export async function warmFillers() {
  for (const t of FILLERS) { try { const id = await synthesize(t); if (id) fillerIds[t] = id; } catch { } }
}

export function audioPath(id) {
  const p = path.join(AUDIO_DIR, path.basename(id) + '.mp3');
  return fs.existsSync(p) ? p : null;
}

// Housekeeping: delete audio older than ~1h so disk doesn't fill.
export function cleanup() {
  try {
    ensure();
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const f of fs.readdirSync(AUDIO_DIR)) {
      const p = path.join(AUDIO_DIR, f);
      if (Object.values(fillerIds).some(id => f === id + '.mp3')) continue;   // keep the fillers
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch { /* ignore */ }
}
