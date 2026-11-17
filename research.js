// Deep research in the background (tablet agent only). Luka answers at once that she started;
// the stronger model then searches the web several times, writes a full report page, and when
// it is ready she opens it on the computer and says the short summary on the tablet.
import { publishPage, siteUrl, pageExists } from './sites.js';

const busy = new Set();
const WEB = { type: 'web_search_20250305', name: 'web_search', max_uses: 8 };
const RULES = `את חוקרת יסודית שכותבת בעברית. חפשי באינטרנט כמה פעמים, מזוויות שונות, עד שיש לך תמונה מבוססת.
כתבי את התוצאה בדיוק במבנה הזה:
שורה ראשונה: SUMMARY: ואחריה שניים עד שלושה משפטים קצרים שמסכמים את המסקנה, מתאימים להקראה בקול, בלי כתובות אינטרנט.
שורה שנייה: ---
משם והלאה: הדוח עצמו כקטע HTML פשוט בלבד (תגיות h2, h3, p, ul, li, table, tr, th, td, strong, a). בלי html, head, body, style או script.
כללים לדוח: התחילי במסקנה. הביאי מספרים, תאריכים ושמות מדויקים רק אם הופיעו במקורות. ליד כל טענה מרכזית שימי קישור למקור. אם המקורות סותרים או שהמידע חלקי, כתבי זאת במפורש. סיימי בסעיף "מקורות" עם רשימת קישורים. אל תמציאי דבר.`;

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function clean(fragment) {
  return fragment
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}
function page(title, fragment) {
  const when = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'long', timeStyle: 'short' });
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;800&display=swap" rel="stylesheet">
<style>body{margin:0;background:#0b0f14;color:#e8edf3;font-family:Heebo,system-ui,sans-serif;line-height:1.75}
main{max-width:860px;margin:0 auto;padding:48px 22px 80px}h1{font-size:2rem;margin:0 0 6px;font-weight:800}
.meta{color:#8a97a8;font-size:.9rem;margin-bottom:32px}h2{margin:38px 0 10px;font-size:1.35rem;color:#ffb347}h3{margin:24px 0 6px;font-size:1.1rem}
a{color:#7cc4ff}table{border-collapse:collapse;width:100%;margin:16px 0;font-size:.95rem}th,td{border:1px solid #243041;padding:8px 10px;text-align:right}
th{background:#131b26}ul{padding-inline-start:22px}</style></head><body><main><h1>${esc(title)}</h1><div class="meta">מחקר של לוּקה · ${esc(when)}</div>${fragment}</main></body></html>`;
}

// run(messages, system, tools, maxTokens) -> { content, stop_reason }  (the tablet agent's own model call)
export function startResearch(run, announce, slug, title, question) {
  slug = (slug || '').toString().toLowerCase().trim(); title = (title || '').toString().trim().slice(0, 80); question = (question || '').toString().trim();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) return 'לא התחלתי: slug צריך להיות באנגלית קטנה, ספרות ומקפים בלבד.';
  if (!title || question.length < 8) return 'לא התחלתי: חסר נושא ברור למחקר.';
  if (busy.size >= 2) return 'לא התחלתי: שני מחקרים כבר רצים כרגע. אפשר לבקש שוב כשאחד מהם יסתיים.';
  while (pageExists(slug) || busy.has(slug)) slug = (slug.slice(0, 34) + '-' + Math.random().toString(36).slice(2, 5));
  busy.add(slug);
  (async () => {
    let messages = [{ role: 'user', content: 'נושא המחקר: ' + title + '\nמה אדוני ביקש לברר: ' + question + '\nהתאריך היום: ' + new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' }) }];
    let text = '';
    for (let i = 0; i < 6; i++) {
      const r = await run(messages, RULES, [WEB], 7000, (t) => { text += t; });
      if (r.stop_reason === 'pause_turn') { messages = [...messages, { role: 'assistant', content: r.content }]; continue; }
      break;
    }
    const cut = text.indexOf('---');
    const head = cut >= 0 ? text.slice(0, cut) : '';
    const body = clean((cut >= 0 ? text.slice(cut + 3) : text).replace(/^```html?|```$/gim, '').trim());
    const m = head.match(/SUMMARY:\s*([\s\S]+)/);
    const summary = (m ? m[1] : '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (body.length < 300) throw new Error('report too short');
    await publishPage(slug, title, page(title, body), `אדוני, המחקר על ${title} מוכן` , summary);
  })().catch(e => { console.error('research failed', slug, e.message); announce(`אדוני, לא הצלחתי להשלים את המחקר על ${title}. אפשר לבקש ממני שוב.`); })
    .finally(() => busy.delete(slug));
  return `התחלתי מחקר מעמיק על "${title}". זה לוקח בין דקה לשלוש. כשהדוח יהיה מוכן אפתח אותו במחשב ואומר את עיקרי הממצאים. הכתובת שלו תהיה ${siteUrl(slug)}`;
}
