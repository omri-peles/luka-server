// Image generation for the tablet agent, through Google's Gemini API.
// Active only when GEMINI_API_KEY is set in Railway. Runs in the background like site building.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { announce } from './sites.js';
import { openOnComputer, computerOnline } from './computer.js';

const DIR = path.resolve('./data/images');
const BASE = () => (process.env.PUBLIC_URL || 'https://web-production-1b2f757c.up.railway.app').replace(/\/$/, '');
export const imagesOn = () => !!process.env.GEMINI_API_KEY;
let busy = 0;

function findImage(o) {                      // the image block can sit at different depths; look for it by shape
  if (!o || typeof o !== 'object') return null;
  if (o.type === 'image' && typeof o.data === 'string' && o.data.length > 1000) return o.data;
  for (const v of Array.isArray(o) ? o : Object.values(o)) { const hit = findImage(v); if (hit) return hit; }
  return null;
}
export function imagePath(id) { return /^[a-f0-9]{16}$/.test(id || '') ? path.join(DIR, id) : null; }

export function makeImage(description, title) {
  description = (description || '').toString().trim(); title = (title || 'תמונה').toString().trim().slice(0, 60);
  if (description.length < 5) return 'לא התחלתי: חסר תיאור של התמונה.';
  if (busy >= 2) return 'לא התחלתי: שתי תמונות כבר בהכנה כרגע.';
  busy++;
  (async () => {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST', headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json', 'Api-Revision': '2026-05-20' },
      body: JSON.stringify({ model: process.env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1', input: [{ type: 'text', text: description }] }) });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const data = findImage(await r.json());
    if (!data) throw new Error('no image in response');
    const buf = Buffer.from(data, 'base64'); const id = crypto.randomBytes(8).toString('hex');
    fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, id), buf);
    let opened = false;
    if (computerOnline()) opened = /^נפתח/.test(await openOnComputer(BASE() + '/images/' + id, title));
    announce(`אדוני, התמונה ${title} מוכנה` + (opened ? ' ופתוחה במחשב.' : '.'), { title, image: BASE() + '/images/' + id }, BASE() + '/images/' + id);
  })().catch(e => { console.error('image failed', e.message); announce(`אדוני, לא הצלחתי ליצור את התמונה ${title}.`); })
    .finally(() => { busy--; });
  return `התחלתי ליצור את התמונה "${title}". זה לוקח עד חצי דקה, ואודיע כשהיא מוכנה ופתוחה במחשב.`;
}
