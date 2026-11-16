// WhatsApp (owner's PERSONAL account) via Baileys — lets Luka read INCOMING messages from
// the owner's contacts and flag urgent ones through the same proactive pipeline.
// Unofficial: this automates a personal WhatsApp account and MAY get the number banned.
// No browser/Puppeteer needed — Baileys speaks the WhatsApp Web protocol directly.
//
// Baileys (and qrcode) are loaded with a DYNAMIC import inside startWhatsApp() on purpose:
// if that package ever fails to load on the host, only this reader is disabled — the rest
// of Luka (calendar, calls, WhatsApp chat) keeps running.
import path from 'path';
import { webcrypto } from 'node:crypto';
import { handleItem } from './proactive.js';

// Baileys relies on the global Web Crypto API (globalThis.crypto). On Node 18 it is NOT exposed
// as a global by default (it only became global in Node 20), so Baileys throws
// "crypto is not defined" and closes before showing a QR. Polyfill it before Baileys loads.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const AUTH_DIR = path.resolve('./data/wa-auth');

// Words that mark an incoming message as "answer me / this is urgent". When present, we force
// high urgency so Luka calls, regardless of how the classifier read the tone.
const URGENT_RE = /דחוף|חירום|בהול|תענה|תתקשר|תחזור אלי|תחזור אליי|אסאפ|asap|urgent|emergency/i;

// Numbers whose incoming messages we must IGNORE, to avoid a feedback loop: Luka reaches the
// owner through the Twilio WhatsApp number, and those alerts arrive in the owner's own WhatsApp
// as "incoming" from that number — reading them back would make Luka alert on her own alerts.
function selfDigits() {
  const raw = [process.env.TWILIO_WHATSAPP_FROM, process.env.OWNER_WHATSAPP, process.env.OWNER_PHONE]
    .filter(Boolean).map(s => s.replace(/\D/g, '')).filter(Boolean);
  return new Set(raw);
}

let sock = null;
let lastQR = null;        // data-URL image of the current linking QR
let connState = 'init';   // init | qr | connected | logged_out | error
let reconnecting = false; // guards against overlapping reconnect loops

// Baileys wants a pino-like logger; a silent no-op keeps logs clean and adds no dependency.
const silent = { level: 'silent', child: () => silent, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

export function waStatus() { return { state: connState, hasQR: !!lastQR }; }
export function waQR() { return lastQR; }

export async function startWhatsApp() {
  try {
    const baileys = await import('@whiskeysockets/baileys');
    const QRCodeMod = await import('qrcode');
    const QRCode = QRCodeMod.default || QRCodeMod;
    const useMultiFileAuthState = baileys.useMultiFileAuthState || baileys.default?.useMultiFileAuthState;
    const DisconnectReason = baileys.DisconnectReason || baileys.default?.DisconnectReason;
    const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion || baileys.default?.fetchLatestBaileysVersion;
    const makeWASocket = (typeof baileys.default === 'function' && baileys.default)
      || baileys.makeWASocket || baileys.default?.default || baileys.default?.makeWASocket;

    // Use WhatsApp Web's CURRENT protocol version — the version baked into the library can be
    // stale, and WhatsApp then rejects the handshake (405) and closes before a QR is shown.
    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); console.log('[wa] WA version', version?.join('.')); }
    catch (e) { console.warn('[wa] version fetch failed, using library default:', e.message); }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      logger: silent,
      browser: ['Luka', 'Chrome', '1.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;
      if (qr) { connState = 'qr'; console.log('[wa] QR ready'); try { lastQR = await QRCode.toDataURL(qr); } catch (e) { console.warn('[wa] QR render failed:', e.message); } }
      if (connection === 'open') { connState = 'connected'; lastQR = null; console.log('[wa] connected'); }
      if (connection === 'close') {
        const err = lastDisconnect?.error;
        console.warn('[wa] close detail:', err?.name, '|', err?.message, '| boom:', err?.output?.statusCode);
        const code = err?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          connState = 'logged_out';
          console.warn('[wa] logged out — needs re-linking at /wa/link');
        } else if (!reconnecting) {
          reconnecting = true;                 // avoid stacking reconnect loops from stale sockets
          console.warn(`[wa] connection closed (code ${code ?? '?'}), reconnecting in 10s`);
          setTimeout(() => { reconnecting = false; startWhatsApp(); }, 10000);
        }
      }
    });

    const skip = selfDigits();
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) {
        try {
          if (!m.message || m.key.fromMe) continue;            // skip our own outgoing
          const jid = m.key.remoteJid || '';
          if (jid.endsWith('@g.us') || jid === 'status@broadcast') continue; // skip groups + status
          const senderDigits = jid.split('@')[0].replace(/\D/g, '');
          if (skip.has(senderDigits)) continue;                // skip Luka's own Twilio/owner numbers
          const body = m.message.conversation || m.message.extendedTextMessage?.text || '';
          if (!body.trim()) continue;                          // text messages only
          const from = m.pushName || jid.split('@')[0] || 'איש קשר';
          const summary = `הודעת וואטסאפ חדשה מ-${from}: ${body}`;
          // Reuse the proactive pipeline: classify urgency, update the tablet, and only reach
          // his phone when it's urgent. Urgent keywords ("דחוף", "תענה"…) force a call.
          await handleItem('whatsapp', 'seenWhatsappIds', m.key.id, summary, { forceHigh: URGENT_RE.test(body) });
        } catch (e) { console.warn('[wa] message error:', e.message); }
      }
    });
  } catch (e) {
    console.error('[wa] start failed:', e.message);
    connState = 'error';
  }
}
