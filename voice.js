// Luka's voice (ElevenLabs "Danit"). Generates an 8kHz μ-law WAV file on disk and returns
// its id, so Twilio can <Play> it over a phone call in her real voice. μ-law 8kHz is Twilio's
// native telephony codec, so it plays with no transcoding (unlike a 44.1kHz MP3).
import fs from 'fs';
import path from 'path';

const AUDIO_DIR = path.resolve('./data/audio');
const KEY = () => process.env.ELEVENLABS_API_KEY || '';
const VOICE = () => process.env.ELEVENLABS_VOICE_ID || 's0T0DT6EAPeX57MQpn3I';
// Telephony-friendly models that support Hebrew and 8kHz μ-law output.
const MODELS = ['eleven_turbo_v2_5', 'eleven_multilingual_v2', 'eleven_flash_v2_5'];
let goodModel = '';

function ensure() { if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true }); }

// Wrap raw 8kHz μ-law audio in a WAV container (format 7). Twilio <Play> plays this natively.
function wavMulaw(mulaw) {
  const dataSize = mulaw.length;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);      // fmt chunk size
  buf.writeUInt16LE(7, 20);       // audio format 7 = μ-law
  buf.writeUInt16LE(1, 22);       // channels (mono)
  buf.writeUInt32LE(8000, 24);    // sample rate
  buf.writeUInt32LE(8000, 28);    // byte rate (8000 * 1 * 1)
  buf.writeUInt16LE(1, 32);       // block align
  buf.writeUInt16LE(8, 34);       // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  mulaw.copy(buf, 44);
  return buf;
}

// Returns the audio id (filename stem) or null on failure. Writes an 8kHz μ-law WAV.
export async function synthesize(text) {
  if (!KEY()) return null;
  ensure();
  const order = goodModel ? [goodModel, ...MODELS.filter(m => m !== goodModel)] : MODELS;
  for (const model of order) {
    try {
      const r = await fetch(
        'https://api.elevenlabs.io/v1/text-to-speech/' + VOICE() + '?output_format=ulaw_8000',
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
        const mulaw = Buffer.from(await r.arrayBuffer());
        const wav = wavMulaw(mulaw);
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        fs.writeFileSync(path.join(AUDIO_DIR, id + '.wav'), wav);
        return id;
      }
    } catch { /* try next model */ }
  }
  return null;
}

export function audioPath(id) {
  const p = path.join(AUDIO_DIR, path.basename(id) + '.wav');
  return fs.existsSync(p) ? p : null;
}

// Housekeeping: delete audio older than ~1h so disk doesn't fill.
export function cleanup() {
  try {
    ensure();
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const f of fs.readdirSync(AUDIO_DIR)) {
      const p = path.join(AUDIO_DIR, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch { /* ignore */ }
}
