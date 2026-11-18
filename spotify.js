// Spotify for the agent: find a song, album, playlist or artist by name, and play it in the Spotify app on the Mac.
// Needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in the server's variables (search only; no access to his account).
import { macOnline, openOnComputer, computerOnline, spotifyOnMac } from './computer.js';
export const spotifyOn = () => !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
let tok = '', until = 0;
async function token() {
  if (tok && Date.now() < until) return tok;
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { authorization: 'Basic ' + Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.access_token) throw new Error('Spotify HTTP ' + r.status + ' ' + String(j.error_description || j.error || '').slice(0, 120));
  tok = j.access_token; until = Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60000; return tok;
}
export async function playOnSpotify(query, kind) {
  const q = (query || '').toString().trim(); if (q.length < 2) return 'חסר מה לנגן.';
  const type = ['track', 'album', 'playlist', 'artist'].includes(kind) ? kind : 'track';
  try {
    const r = await fetch(`https://api.spotify.com/v1/search?limit=5&market=IL&type=${type}&q=${encodeURIComponent(q)}`, { headers: { authorization: 'Bearer ' + await token() }, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({})); if (!r.ok) return 'החיפוש בספוטיפיי נכשל: HTTP ' + r.status + ' ' + String((j.error && j.error.message) || '').slice(0, 120);
    const items = (((j[type + 's'] || {}).items) || []).filter(Boolean); if (!items.length) return 'לא מצאתי בספוטיפיי משהו מתאים.';
    const it = items[0]; const who = it.artists ? ' של ' + it.artists.map(a => a.name).join(', ') : (it.owner ? ' מאת ' + it.owner.display_name : '');
    const label = `${it.name}${who}`;
    if (macOnline()) { const out = await spotifyOnMac(it.uri); if (/^מתנגן/.test(out)) return `מתנגן בספוטיפיי: ${label}.`; if (!/גרסה 7/.test(out)) return out + ` (מצאתי: ${label})`; }
    if (computerOnline() && it.external_urls && it.external_urls.spotify) { const o = await openOnComputer(it.external_urls.spotify, label); return `מצאתי: ${label}. ${/^נפתח/.test(o) ? 'פתחתי אותו בספוטיפיי בדפדפן, וייתכן שצריך ללחוץ שם על נגן.' : o}`; }
    return `מצאתי: ${label}, אבל המחשב לא מחובר כרגע ואין לי איפה לנגן.`;
  } catch (e) { return 'ספוטיפיי לא זמין: ' + e.message; }
}
