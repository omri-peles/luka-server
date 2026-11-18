// The phone side of Luka (voice calls and the WhatsApp chat) with the same abilities as the
// tablet agent. brain.js itself is not changed: it stays as the fallback, and setting the
// Railway variable PHONE_AGENT=classic switches the phone back to it at once.
import { chat } from './brain.js';

export async function phoneChat(text, opts = {}) {
  if ((process.env.PHONE_AGENT || '').toLowerCase() === 'classic') return chat(text, opts);
  let agent;
  try {
    agent = await import('./tablet-agent.js');
    (await import('./sites.js')).setAway();                 // background results go to his WhatsApp
  } catch (e) { console.error('phone agent unavailable, using the classic brain:', e.message); return chat(text, opts); }
  try {
    const run = agent.chatStream(text, () => {}, { channel: opts.phone ? 'call' : 'whatsapp' });
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), opts.phone ? 40000 : 75000));
    const reply = await Promise.race([run, timeout]);
    if (reply === null) return 'זה לוקח לי יותר זמן מהרגיל, אדוני. אמשיך לעבוד על זה.';
    return reply || 'אני כאן, אדוני.';
  } catch (e) {
    console.error('phone agent error:', e.message);
    return 'סליחה אדוני, הייתה לי תקלה רגעית. נסה שוב.';
  }
}
