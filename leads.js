// "Site hunting" (tablet agent only): find local businesses that have reviews on Google Maps but no
// website, and build each one a demo site. Finding and building only: contacting a business is a
// separate step with its own rules.
import crypto from 'crypto';
import { load, save } from './store.js';
import { quietSite, siteUrl, announce } from './sites.js';
import { bookingKind, bookingBrief, attachBooking } from './booking.js';

const KEY = () => process.env.GOOGLE_MAPS_KEY || '';
export const leadsOn = () => !!KEY();
const FIELDS = ['id', 'displayName', 'formattedAddress', 'nationalPhoneNumber', 'internationalPhoneNumber', 'websiteUri', 'rating', 'userRatingCount',
  'primaryTypeDisplayName', 'businessStatus', 'googleMapsUri', 'regularOpeningHours.weekdayDescriptions', 'regularOpeningHours.periods', 'editorialSummary'].map(f => 'places.' + f).join(',') + ',nextPageToken';

export function leads() { const s = load(); if (!Array.isArray(s.leads)) s.leads = []; return s.leads; }
const building = new Set();

async function search(query, pageToken, il) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify({ textQuery: query, languageCode: il ? 'he' : 'en', ...(il ? { regionCode: 'IL' } : {}), pageSize: 20, ...(pageToken ? { pageToken } : {}) })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
  return j;
}

// Opening hours as [weekday (0 = Sunday), opens, closes] in minutes, for the booking card on the site.
function periods(p) {
  const list = (p.regularOpeningHours && p.regularOpeningHours.periods) || []; if (!list.length) return null;
  if (list.length === 1 && !list[0].close) return [0, 1, 2, 3, 4, 5, 6].map(d => [d, 0, 1440]);   // always open
  const out = [];
  for (const x of list) {
    if (!x.open || typeof x.open.day !== 'number') continue;
    const o = (x.open.hour || 0) * 60 + (x.open.minute || 0);
    let c = x.close ? (x.close.hour || 0) * 60 + (x.close.minute || 0) : 1440;
    if (x.close && (x.close.day !== x.open.day || c <= o)) c += 1440;
    out.push([x.open.day, o, Math.min(c, 2880)]);
  }
  return out.length ? out.slice(0, 28) : null;
}

export async function searchLeads(place, kind, want, market) {
  const il = market === 'il';
  const list = leads(), found = []; let token = '', seen = 0;
  for (let page = 0; page < 3 && found.length < want; page++) {
    const j = await search(il ? kind + ' ב' + place : kind + ' in ' + place, token, il);
    for (const p of j.places || []) {
      seen++;
      if (p.websiteUri || (p.businessStatus && p.businessStatus !== 'OPERATIONAL') || (p.userRatingCount || 0) < 5) continue;
      if (list.find(x => x.id === p.id)) continue;
      const lead = { id: p.id, key: crypto.randomBytes(3).toString('hex'), name: (p.displayName && p.displayName.text) || '', type: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || kind,
        address: p.formattedAddress || '', phone: p.nationalPhoneNumber || p.internationalPhoneNumber || '', rating: p.rating || 0, reviews: p.userRatingCount || 0,
        hours: (p.regularOpeningHours && p.regularOpeningHours.weekdayDescriptions) || [], about: (p.editorialSummary && p.editorialSummary.text) || '',
        maps: p.googleMapsUri || '', status: 'found', site: '', at: Date.now(), ...(il ? { market: 'il' } : {}) };
      const per = periods(p); if (per) lead.periods = per;
      if (!lead.name) continue;
      list.push(lead); found.push(lead);
      if (found.length >= want) break;
    }
    token = j.nextPageToken || ''; if (!token) break;
  }
  if (list.length > 400) {                                  // drop only old businesses that were never written to
    let extra = list.length - 400;
    for (let i = 0; i < list.length && extra > 0; ) { if (!list[i].thread && !found.includes(list[i])) { list.splice(i, 1); extra--; } else i++; }
  }
  save();
  return { found, seen };
}

export async function findLeads(place, kind, count) {
  place = (place || '').toString().trim().slice(0, 80); kind = (kind || '').toString().trim().slice(0, 60);
  const want = Math.max(1, Math.min(10, Number(count) || 5));
  if (!leadsOn()) return 'החיפוש במפות לא מחובר: חסר המפתח GOOGLE_MAPS_KEY בשרת.';
  if (!place || !kind) return 'לא חיפשתי: צריך סוג עסק (באנגלית, למשל barber shop) ומקום (עיר ומדינה בארצות הברית).';
  let found, seen;
  try { ({ found, seen } = await searchLeads(place, kind, want, /[\u0590-\u05FF]/.test(kind + place) ? 'il' : 'us')); } catch (e) { return 'החיפוש במפות נכשל: ' + String(e.message || e).slice(0, 200); }
  if (!found.length) return `עברתי על ${seen} עסקים מסוג ${kind} ב-${place} ולא מצאתי חדשים שיש להם ביקורות ואין להם אתר. אפשר לנסות סוג עסק אחר או עיר אחרת.`;
  return `מצאתי ${found.length} עסקים עם ביקורות ובלי אתר (מתוך ${seen} שנבדקו):\n` + found.map(l =>
    `- ${l.name} (קוד ${l.key}): ${l.type}, ${l.address}. דירוג ${l.rating} מתוך ${l.reviews} ביקורות. טלפון: ${l.phone || 'לא רשום'}.`).join('\n') +
    '\nלגוגל אין כתובות מייל של עסקים, רק טלפון. לבניית אתר דוגמה לעסק השתמשי ב-build_lead_site עם הקוד שלו. לפנייה במייל במסגרת תוכנית המכירות השתמשי ב-contact_lead.';
}

export function pick(q) { q = (q || '').toString().trim().toLowerCase(); return leads().find(l => l.key === q) || leads().find(l => l.name.toLowerCase() === q) || leads().find(l => q.length > 2 && l.name.toLowerCase().includes(q)); }

function brief(l) {
  if (l.market === 'il') return `בני אתר של עמוד אחד בעברית (<html lang="he" dir="rtl">, גופן Heebo או Assistant מ-Google Fonts) לעסק מקומי אמיתי בישראל.
השתמשי אך ורק בעובדות שלמטה. אל תמציאי מחירים, רשימת שירותים, שמות עובדים, המלצות, שנות ותק או כל פרט שלא מופיע כאן; כשחסר פרט, כתבי באופן כללי או השמיטי (בלי סוגריים מרובעים).
שם העסק: ${l.name}
סוג העסק: ${l.type}
כתובת: ${l.address}
טלפון: ${l.phone || 'לא רשום (בלי כפתורי טלפון)'}
דירוג בגוגל: ${l.rating} מתוך ${l.reviews} ביקורות (להציג כעובדה; לא לצטט ולא להמציא טקסט של ביקורות)
שעות פתיחה: ${l.hours.length ? l.hours.join('; ') : 'לא רשומות (להשמיט)'}
${l.about ? 'תיאור קצר: ' + l.about : ''}
${l.maps ? 'קישור Google Maps לכפתור "הוראות הגעה": ' + l.maps : ''}
חלקים: פתיח עם שם העסק וכפתור חיוג ברור (קישור tel:), מה העסק מציע במונחים כלליים לסוגו, תג דירוג, שעות, מיקום עם כפתור הוראות הגעה, תחתית עם פרטי קשר.${bookingBrief(l)}
חובה: להוסיף <meta name="robots" content="noindex,nofollow"> ופס דק ובולט בראש העמוד עם הטקסט: "אתר הדגמה שהוכן עבור ${l.name}. זה אינו האתר הרשמי של העסק."`;
  return `Build a one-page website in ENGLISH (<html lang="en" dir="ltr">, an English Google Font) for this real local business in the United States.
Use ONLY the facts below. Do not invent prices, services lists, staff names, testimonials, years in business or anything else that is not listed; where a detail is missing, write generally or leave it out (no bracket placeholders).
Business name: ${l.name}
Type of business: ${l.type}
Address: ${l.address}
Phone: ${l.phone || 'not listed (leave out phone buttons)'}
Google rating: ${l.rating} from ${l.reviews} reviews (show it as a fact; do not quote or invent any review text)
Opening hours: ${l.hours.length ? l.hours.join('; ') : 'not listed (leave out)'}
${l.about ? 'Short description: ' + l.about : ''}
${l.maps ? 'Google Maps link for a "Get directions" button: ' + l.maps : ''}
Sections: hero with the name and a clear call button (tel: link), what the business offers in general terms for its type, rating badge, hours, location with the directions button, contact footer.${bookingBrief(l)}
Required: add <meta name="robots" content="noindex,nofollow"> and a slim, clearly visible bar at the very top that says: "Demo concept prepared for ${l.name}. This is not the business's official website."`;
}
// Builds the demo site if there is none yet and returns its address.
export async function ensureSite(l) {
  if (l.site) return l.site;
  const slug = 'demo-' + (l.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 22).replace(/-+$/, '') || 'site') + '-' + crypto.randomBytes(4).toString('hex');
  const url = await quietSite(slug, brief(l));
  l.site = url; l.slug = slug; if (l.status === 'found') l.status = 'site'; save();
  if (bookingKind(l)) { try { attachBooking(l); } catch (e) { console.error('booking attach', l.key, e.message); } }
  return url;
}

export function buildLeadSite(q) {
  const l = pick(q);
  if (!l) return 'לא נמצא עסק כזה ברשימה. ' + (leadsText() || 'הרשימה ריקה.');
  if (l.site) return `לעסק ${l.name} כבר יש אתר דוגמה: ${l.site}`;
  if (building.has(l.key)) return `אתר הדוגמה של ${l.name} כבר בבנייה.`;
  if (building.size >= 2) return 'שני אתרי דוגמה כבר בבנייה כרגע. אפשר לבקש את הבא כשאודיע שאחד הסתיים.';
  building.add(l.key);
  ensureSite(l).then(url => announce(`אדוני, אתר הדוגמה של ${l.name} מוכן.`, { title: l.name, note: 'אתר דוגמה', link: url }, url))
    .catch(e => { console.error('lead site failed', l.key, e.message); announce(`אדוני, לא הצלחתי לבנות את אתר הדוגמה של ${l.name}.`); })
    .finally(() => building.delete(l.key));
  return `התחלתי לבנות אתר דוגמה באנגלית לעסק ${l.name}. זה לוקח בערך דקה, ואודיע כשיהיה מוכן.`;
}

export function leadsText() {
  const list = leads().slice(-15);
  if (!list.length) return '';
  return 'העסקים ברשימה:\n' + list.map(l => `- ${l.name} (קוד ${l.key}): ${l.type}, ${l.address}. טלפון: ${l.phone || 'לא רשום'}. ${l.site ? 'אתר דוגמה: ' + l.site : 'עוד אין אתר דוגמה'}.`).join('\n');
}
