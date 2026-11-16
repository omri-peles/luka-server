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

// Calls the owner and opens a TWO-WAY conversation: Luka says `text` in her real voice, then
// listens for his reply and answers, turn by turn (handled by /voice/convo on the server).
// Returns { ok, reason }.
export async function callOwner(text) {
  const c = client();
  const to = process.env.OWNER_PHONE;
  const from = process.env.TWILIO_FROM_NUMBER;
  const base = process.env.PUBLIC_URL;
  if (!c || !to || !from || !base) return { ok: false, reason: 'twilio not configured' };

  const audioId = await synthesize(text);
  try {
    if (audioId) {
      // Start the conversation: play her opening line, then gather his speech and loop.
      await c.calls.create({ to, from, url: `${base}/convo?aid=${audioId}`, method: 'GET' });
    } else {
      // ElevenLabs failed — still make it conversational using Twilio's Hebrew TTS for the opener.
      const safe = text.replace(/[<&]/g, ' ');
      const twiml =
        `<Response><Say language="he-IL">${safe}</Say>` +
        `<Gather input="speech" language="he-IL" speechTimeout="auto" action="${base}/convo/turn" method="POST"></Gather>` +
        `<Redirect method="POST">${base}/convo/turn</Redirect></Response>`;
      await c.calls.create({ to, from, twiml });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }
}

// Sends a plain SMS from Luka to the owner (via the Twilio phone number).
// Reliable anytime (no 24h window like WhatsApp). Returns { ok, reason }.
export async function smsOwner(text) {
  const c = client();
  const from = process.env.TWILIO_FROM_NUMBER;
  const to = process.env.OWNER_PHONE;
  if (!c || !from || !to) return { ok: false, reason: 'sms not configured' };
  try {
    await c.messages.create({ from, to, body: text });
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
