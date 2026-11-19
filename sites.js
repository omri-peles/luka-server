// Luka builds simple one-page websites by voice (tablet agent only).
// A site is one self-contained HTML file kept on the data volume and served at /sites/<slug>.
// Building takes about a minute, so it runs in the background: the tool answers at once, and
// when the page is ready Luka opens it on the computer and announces it on the tablet.
import fs from 'fs';
import path from 'path';
import { load, save } from './store.js';
import { openOnComputer, computerOnline } from './computer.js';

const KEY = () => process.env.ANTHROPIC_API_KEY || '';
const MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5'];
const DIR = path.resolve('./data/sites');
const BASE = () => (process.env.PUBLIC_URL || process.env.BASE_URL || 'https://web-production-1b2f757c.up.railway.app').replace(/\/$/, '');
const MAX_SITES = 30;
const busy = new Set();

const okSlug = s => /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(s || '');
const file = slug => path.join(DIR, slug + '.html');
export const siteUrl = slug => BASE() + '/sites/' + slug;

function index() { const s = load(); if (!Array.isArray(s.sites)) s.sites = []; return s.sites; }
export function sitesText() {
  const list = index();
  if (!list.length) return '';
  return list.slice(-12).map(x => `- ${x.name} (slug: ${x.slug})`).join('\n');
}
export function readSite(slug) {
  if (!okSlug(slug)) return null;
  try { return fs.readFileSync(file(slug), 'utf8'); } catch { return null; }
}

// When the owner last spoke to Luka by phone or WhatsApp (not at the tablet): results of
// background work are then also sent to his WhatsApp.
let awayAt = 0;
export const setAway = () => { awayAt = Date.now(); };
export const clearAway = () => { awayAt = 0; };
// text: what she says on the tablet. card: optional thing to show on the screen.
// link: optional address added to the WhatsApp copy. always: send to WhatsApp even when he is home.
function announce(text, card, link, always) {
  const s = load();
  if (!Array.isArray(s.updates)) s.updates = [];
  s.updates.push({ id: Date.now().toString(36), text, at: Date.now(), ...(card ? { card } : {}) });
  if (always || Date.now() - awayAt < 15 * 60000) import('./phone.js').then(m => m.whatsappOwner(text + (link ? '\n' + link : ''))).catch(() => {});
  if (s.updates.length > 50) s.updates = s.updates.slice(-50);
  save();
}

const RULES = `את בונה דף אינטרנט אחד, שלם ומוכן לשימוש, בקובץ HTML יחיד.
כללים:
- החזירי אך ורק את קובץ ה-HTML המלא, מ-<!DOCTYPE html> עד </html>, בלי שום טקסט לפני או אחרי ובלי סימוני קוד.
- כל ה-CSS וה-JavaScript בתוך הקובץ עצמו. מותר לטעון גופן אחד מ-Google Fonts (למשל Heebo או Assistant).
- עברית כברירת מחדל: <html lang="he" dir="rtl">, אלא אם התבקשה שפה אחרת.
- עיצוב מודרני, נקי ומקצועי, מותאם לנייד ולמחשב, עם היררכיה ברורה, ריווח נדיב וכפתור פעולה בולט.
- אל תשתמשי בתמונות מכתובות חיצוניות, אלא אם ניתנה כתובת מפורשת בבקשה. במקומן: מעברי צבע, צורות CSS, אייקוני SVG מוטמעים.
- אל תמציאי עובדות: מספרי טלפון, כתובות, מחירים, המלצות של לקוחות או נתונים שלא נמסרו. אם חסר פרט, כתבי מציין מקום ברור בסוגריים מרובעים, למשל [מספר טלפון].
- בלי טפסים ששולחים מידע לשרת ובלי קוד מעקב. כפתורי יצירת קשר יכולים להיות קישורי tel:, mailto: או wa.me אם נמסר מספר.
- הקוד קצר ויעיל: עד כ-400 שורות.`;

async function generate(userContent, maxTokens = 14000) {
  let lastErr = '';
  for (const model of MODELS) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': KEY(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system: RULES, stream: true, messages: [{ role: 'user', content: userContent }] })
      });
      if (!r.ok || !r.body) { lastErr = model + ' HTTP ' + r.status; continue; }
      const dec = new TextDecoder(); let buf = '', out = '', stop = '';
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
          if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') out += ev.delta.text;
          else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
          else if (ev.type === 'error') lastErr = model + ' ' + JSON.stringify(ev.error || {}).slice(0, 120);
        }
      }
      const html = extract(out);
      if (html && stop !== 'max_tokens') return html;
      lastErr = model + (stop === 'max_tokens' ? ' output too long' : ' no html');
    } catch (e) { lastErr = model + ' ' + (e.message || e); }
  }
  throw new Error(lastErr || 'generation failed');
}
function extract(t) {
  const a = t.search(/<!doctype html/i); const b = t.toLowerCase().lastIndexOf('</html>');
  if (a < 0 || b < 0 || b < a) return '';
  const html = t.slice(a, b + 7);
  return html.length > 400 && html.length < 400000 ? html : '';
}

async function finish(slug, name, html, verb, say, tail) {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(file(slug))) fs.copyFileSync(file(slug), file(slug) + '.bak');   // one step of undo
  fs.writeFileSync(file(slug), html);
  const list = index(); const now = Date.now();
  const cur = list.find(x => x.slug === slug);
  if (cur) { cur.name = name || cur.name; cur.at = now; } else list.push({ slug, name, at: now });
  save();
  let opened = false;
  if (computerOnline()) { const res = await openOnComputer(siteUrl(slug) + '?v=' + now.toString(36), name); opened = /^נפתח/.test(res); }
  announce((say || `אדוני, האתר ${name} ${verb}`) + (opened ? ' ופתוח במחשב.' : '. המחשב לא מחובר כרגע, אז לא פתחתי אותו.') + (tail ? ' ' + tail : ''),
    { title: name, note: tail || (say ? '' : 'האתר ' + verb), link: siteUrl(slug) }, siteUrl(slug));
}
// Used by research.js: publish a ready page the same way sites are published.
export const publishPage = (slug, name, html, say, tail) => finish(slug, name, html, '', say, tail);
export const pageExists = (slug) => !!index().find(x => x.slug === slug);
// Used by outreach.js: change an existing page quietly (one step of undo is kept).
export async function quietEdit(slug, instruction) {
  const html = readSite(slug); if (!html) throw new Error('no such page');
  const out = await generate('This is the existing page:\n\n' + html + '\n\nMake the following change and return the complete updated file. Change nothing that was not asked. Keep the language of the page.\nThe change: ' + instruction);
  fs.copyFileSync(file(slug), file(slug) + '.bak'); fs.writeFileSync(file(slug), out);
  return siteUrl(slug);
}
// Used by leads.js: build a page and keep it without opening it on the computer or announcing it.
export async function quietSite(slug, brief) {
  if (!okSlug(slug)) throw new Error('bad slug');
  const html = await generate(brief);
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(file(slug), html);
  return siteUrl(slug);
}
export { announce };

// ---- tool handlers (answer at once; the work continues in the background) ----
export function buildSite(slug, name, brief, pages) {
  slug = (slug || '').toString().toLowerCase().trim(); name = (name || '').toString().trim().slice(0, 60); brief = (brief || '').toString().trim();
  if (!okSlug(slug)) return 'לא התחלתי: slug צריך להיות באנגלית קטנה, ספרות ומקפים בלבד, 3 עד 40 תווים.';
  if (!name || brief.length < 10) return 'לא התחלתי: חסר שם לאתר או תיאור של מה שהוא צריך להכיל.';
  if (busy.has(slug)) return 'האתר הזה כבר בבנייה כרגע.';
  if (busy.size >= 2) return 'לא התחלתי: שני אתרים כבר בבנייה כרגע. אפשר לנסות שוב בעוד דקה.';
  const list = index();
  if (list.find(x => x.slug === slug)) return `לא התחלתי: כבר קיים אתר עם ה-slug ${slug}. לשינוי בו השתמשי ב-edit_site, או בחרי slug אחר לאתר חדש.`;
  if (list.length >= MAX_SITES) return 'לא התחלתי: הגענו למספר האתרים המרבי (30). צריך למחוק אתר ישן קודם.';
  busy.add(slug);
  const many = Array.isArray(pages) ? pages.map(x => String(x).trim()).filter(Boolean).slice(0, 6) : [];
  const multi = many.length > 1 ? '\nזה אתר עם כמה עמודים, כולם בקובץ אחד: ' + many.join(', ') + '. בני תפריט ניווט עליון קבוע, וכל עמוד הוא חלק נפרד שמוצג לבדו לפי הכתובת (hash, למשל #about); בטעינה מוצג העמוד הראשון. הקוד יכול להגיע עד כ-900 שורות.' : '';
  generate('בני דף אינטרנט לפי הבקשה הבאה.\nשם האתר: ' + name + '\nהבקשה: ' + brief + multi, multi ? 26000 : 14000)
    .then(html => finish(slug, name, html, 'מוכן'))
    .catch(e => { console.error('site build failed', slug, e.message); announce(`אדוני, לא הצלחתי לבנות את האתר ${name}. אפשר לבקש ממני שוב.`); })
    .finally(() => busy.delete(slug));
  return `התחלתי לבנות את האתר "${name}". זה לוקח ${many.length > 1 ? 'שתיים עד ארבע דקות' : 'בערך דקה'}. כשהוא יהיה מוכן אפתח אותו במחשב ואודיע. הכתובת שלו תהיה ${siteUrl(slug)}`;
}

export function editSite(slug, instruction) {
  slug = (slug || '').toString().toLowerCase().trim(); instruction = (instruction || '').toString().trim();
  const cur = index().find(x => x.slug === slug); const html = readSite(slug);
  if (!cur || !html) return 'לא התחלתי: לא נמצא אתר כזה. האתרים הקיימים:\n' + (sitesText() || 'אין עדיין אתרים.');
  if (instruction.length < 3) return 'לא התחלתי: חסר מה לשנות.';
  if (busy.has(slug)) return 'האתר הזה כבר בעבודה כרגע. אפשר לבקש את השינוי כשאודיע שסיימתי.';
  if (busy.size >= 2) return 'לא התחלתי: שני אתרים כבר בעבודה כרגע.';
  busy.add(slug);
  generate('זה הדף הקיים:\n\n' + html + '\n\nבצעי בו את השינוי הבא, והחזירי את הקובץ המלא המעודכן. אל תשני דבר שלא התבקש.\nהשינוי: ' + instruction)
    .then(out => finish(slug, cur.name, out, 'עודכן'))
    .catch(e => { console.error('site edit failed', slug, e.message); announce(`אדוני, לא הצלחתי לעדכן את האתר ${cur.name}. הוא נשאר כפי שהיה.`); })
    .finally(() => busy.delete(slug));
  return `התחלתי לעדכן את האתר "${cur.name}". זה לוקח בערך דקה, ואודיע כשיסתיים.`;
}

export function undoSite(slug) {
  slug = (slug || '').toString().toLowerCase().trim();
  const cur = index().find(x => x.slug === slug);
  if (!cur || !okSlug(slug)) return 'לא נמצא אתר כזה.';
  if (busy.has(slug)) return 'האתר בעבודה כרגע.';
  if (!fs.existsSync(file(slug) + '.bak')) return 'אין גרסה קודמת לחזור אליה.';
  const prev = fs.readFileSync(file(slug) + '.bak', 'utf8');
  fs.copyFileSync(file(slug), file(slug) + '.bak'); fs.writeFileSync(file(slug), prev);
  return `האתר "${cur.name}" הוחזר לגרסה הקודמת.`;
}

// Not a voice tool on purpose (a misheard word must not delete a site). Owner-only endpoint.
export function deleteSite(slug) {
  slug = (slug || '').toString().toLowerCase().trim();
  const list = index(); const i = list.findIndex(x => x.slug === slug);
  if (i < 0 || !okSlug(slug) || busy.has(slug)) return false;
  try { fs.unlinkSync(file(slug)); } catch {}
  try { fs.unlinkSync(file(slug) + '.bak'); } catch {}
  list.splice(i, 1); save();
  return true;
}
