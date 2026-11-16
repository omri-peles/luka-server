// Outbound phone calls via Twilio. Luka speaks in her real (ElevenLabs) voice by playing
// a generated MP3 hosted on this server.
import twilio from 'twilio';
import { synthesize } from './voice.js';

function client() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

// Places a call to the owner and plays `text` in Luka's voice.
// Returns { ok, reason }.
export async function callOwner(text) {
  const c = client();
  const to = process.env.OWNER_PHONE;
  const from = process.env.TWILIO_FROM_NUMBER;
  const base = process.env.PUBLIC_URL;
  if (!c || !to || !from || !base) return { ok: false, reason: 'twilio not configured' };

  const audioId = await synthesize(text);
  let twiml;
  if (audioId) {
    // Play her real voice, twice, so a half-asleep owner catches it.
    twiml = `<Response><Pause length="1"/><Play>${base}/audio/${audioId}.mp3</Play><Pause length="1"/><Play>${base}/audio/${audioId}.mp3</Play></Response>`;
  } else {
    // Fallback to Twilio's built-in Hebrew TTS if ElevenLabs failed.
    const safe = text.replace(/[<&]/g, ' ');
    twiml = `<Response><Say language="he-IL">${safe}</Say></Response>`;
  }
  try {
    await c.calls.create({ to, from, twiml });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }
}

// Sends a WhatsApp message from Luka to the owner (via Twilio WhatsApp).
export async function whatsappOwner(text) {
  const c = client();
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const to = process.env.OWNER_WHATSAPP;
  if (!c || !from || !to) return { ok: false, reason: 'whatsapp not configured' };
  try {
    await c.messages.create({ from, to, body: text });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }
}
