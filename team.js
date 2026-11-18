// A small team of agents working at the same time (tablet agent only). Each member gets one part of the
// job and its own web searches; a lead then merges their work into one report page. Runs in the background.
import { publishPage, siteUrl, pageExists } from './sites.js';

let busy = 0;
const WEB = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 };
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clean = (f) => f.replace(/<\s*(script|style|iframe|object|embed|form|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, '').replace(/<\s*(script|style|iframe|object|embed|form|link|meta)[^>]*>/gi, '')
  .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
function page(title, fragment, roles) {
  const when = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'long', timeStyle: 'short' });
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;800&display=swap" rel="stylesheet">
<style>body{margin:0;background:#0b0f14;color:#e8edf3;font-family:Heebo,system-ui,sans-serif;line-height:1.75}
main{max-width:860px;margin:0 auto;padding:48px 22px 80px}h1{font-size:2rem;margin:0 0 6px;font-weight:800}
.meta{color:#8a97a8;font-size:.9rem;margin-bottom:32px}h2{margin:38px 0 10px;font-size:1.35rem;color:#4fe3f2}h3{margin:24px 0 6px;font-size:1.1rem}
a{color:#7cc4ff}table{border-collapse:collapse;width:100%;margin:16px 0;font-size:.95rem}th,td{border:1px solid #243041;padding:8px 10px;text-align:right}
th{background:#131b26}ul{padding-inline-start:22px}</style></head><body><main><h1>${esc(title)}</h1><div class="meta">צוות של לוּקה: ${esc(roles)} · ${esc(when)}</div>${fragment}</main></body></html>`;
}
async function member(run, sys, content, tools, max) {
  let messages = [{ role: 'user', content }], text = '';
  for (let i = 0; i < 5; i++) {
    const r = await run(messages, sys, tools, max, (t) => { text += t; });
    if (r.stop_reason === 'pause_turn') { messages = [...messages, { role: 'assistant', content: r.content }]; continue; }
    break;
  }
  return text;
}

export function startTeam(run, announce, slug, title, goal, tasks) {
  slug = (slug || '').toString().toLowerCase().trim(); title = (title || '').toString().trim().slice(0, 80); goal = (goal || '').toString().trim();
  const jobs = (Array.isArray(tasks) ? tasks : []).map(t => ({ role: String(t.role || '').trim().slice(0, 40), task: String(t.task || '').trim().slice(0, 1200) })).filter(t => t.role && t.task.length > 8).slice(0, 4);
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) return 'לא התחלתי: slug צריך להיות באנגלית קטנה, ספרות ומקפים בלבד.';
  if (!title || jobs.length < 2) return 'לא התחלתי: צריך כותרת ולפחות שני חברי צוות עם משימה ברורה לכל אחד.';
  if (busy >= 1) return 'לא התחלתי: צוות אחד כבר עובד כרגע. אפשר לבקש שוב כשהוא יסיים.';
  while (pageExists(slug)) slug = slug.slice(0, 34) + '-' + Math.random().toString(36).slice(2, 5);
  busy++;
  const today = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
  (async () => {
    const outs = await Promise.all(jobs.map(j => member(run,
      `את ${j.role} בצוות מומחים. בצעי רק את החלק שלך, ביסודיות, עם חיפושים באינטרנט כשצריך עובדות עדכניות. כתבי בעברית ממצאים ממוקדים: עובדות, מספרים ושמות רק אם הופיעו במקורות, עם קישור למקור ליד כל טענה מרכזית. אם משהו לא ידוע, כתבי זאת. בלי הקדמות.`,
      `המטרה הכוללת: ${goal || title}\nהחלק שלך: ${j.task}\nהתאריך היום: ${today}`, [WEB], 3500).catch(e => 'החלק הזה לא הושלם: ' + e.message)));
    const merged = await member(run,
      `את ראש הצוות. קיבלת את העבודה של חברי הצוות. אחדי אותה לדוח אחד בעברית, בלי לחזור על דברים ובלי להוסיף עובדות שלא הופיעו אצלם.
כתבי בדיוק במבנה הזה:
שורה ראשונה: SUMMARY: ואחריה שניים עד שלושה משפטים קצרים עם המסקנה, מתאימים להקראה בקול, בלי כתובות אינטרנט.
שורה שנייה: ---
משם והלאה: הדוח כקטע HTML פשוט בלבד (תגיות h2, h3, p, ul, li, table, tr, th, td, strong, a). בלי html, head, body, style או script. התחילי במסקנה ובהמלצה, אחר כך פרק לכל תחום, סתירות בין חברי הצוות אם יש, וצעדים הבאים. שמרי על הקישורים למקורות.`,
      `המטרה: ${goal || title}\n\n` + jobs.map((j, i) => `===== ${j.role} =====\n${String(outs[i]).slice(0, 14000)}`).join('\n\n'), [], 7000);
    const cut = merged.indexOf('---');
    const head = cut >= 0 ? merged.slice(0, cut) : '';
    const body = clean((cut >= 0 ? merged.slice(cut + 3) : merged).replace(/^```html?|```$/gim, '').trim());
    const m = head.match(/SUMMARY:\s*([\s\S]+)/);
    if (body.length < 300) throw new Error('report too short');
    await publishPage(slug, title, page(title, body, jobs.map(j => j.role).join(', ')), `אדוני, הצוות סיים את העבודה על ${title}`, (m ? m[1] : '').replace(/\s+/g, ' ').trim().slice(0, 500));
  })().catch(e => { console.error('team failed', slug, e.message); announce(`אדוני, הצוות לא הצליח להשלים את העבודה על ${title}. אפשר לבקש ממני שוב.`); })
    .finally(() => { busy--; });
  return `הצוות התחיל לעבוד על "${title}": ${jobs.map(j => j.role).join(', ')}, כולם במקביל. זה לוקח בין שתיים לארבע דקות. כשהדוח המאוחד יהיה מוכן אפתח אותו במחשב ואומר את המסקנה. הכתובת תהיה ${siteUrl(slug)}`;
}
