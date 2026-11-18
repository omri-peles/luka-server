// Three more ways for Luka to think (tablet agent side): a debate between two agents with a verdict,
// a map of how people, projects and decisions connect, and a review of her own failures with suggestions.
// The review only reports: she never changes her own code.
import fs from 'fs';
import path from 'path';
import { memoryText } from './memory.js';

const KEY = () => process.env.ANTHROPIC_API_KEY;
const WEB = { type: 'web_search_20250305', name: 'web_search', max_uses: 3 };
const read = (f) => { try { return fs.readFileSync(path.resolve('./data/' + f), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch (e) { return []; } };
async function quick(system, content, max = 900, model = 'claude-haiku-5-5') {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: max, system, messages: [{ role: 'user', content }] }) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return ((await r.json()).content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}
async function side(run, sys, content) {
  let messages = [{ role: 'user', content }], text = '';
  for (let i = 0; i < 4; i++) { const r = await run(messages, sys, [WEB], 1300, (t) => { text += t; }); if (r.stop_reason === 'pause_turn') { messages = [...messages, { role: 'assistant', content: r.content }]; continue; } break; }
  return text.trim();
}

export async function debate(run, question, context) {
  question = (question || '').toString().trim(); if (question.length < 8) return 'חסרה שאלה ברורה לדיון.';
  const base = `ההחלטה שעל הפרק: ${question}${context ? '\nרקע ונתונים: ' + String(context).slice(0, 3000) : ''}\nהתאריך: ${new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })}`;
  const rules = 'כתבי בעברית עד חמש נקודות קצרות וחדות, מהחזקה לחלשה. עובדות ומספרים רק אם הם ידועים או הופיעו בחיפוש; אל תמציאי. בלי הקדמות.';
  try {
    const work = Promise.all([
      side(run, 'את הסוכנת שבעד. תפקידך לבנות את הטיעון החזק ביותר בעד ההחלטה. ' + rules, base),
      side(run, 'את הסוכנת שנגד. תפקידך לבנות את הטיעון החזק ביותר נגד ההחלטה: סיכונים, עלויות נסתרות, חלופות טובות יותר. ' + rules, base)]);
    const got = await Promise.race([work, new Promise(res => setTimeout(() => res(null), 80000))]);
    if (!got) return 'הדיון לוקח יותר מדי זמן לתשובה מיידית. למשימה כזו השתמשי ב-delegate_to_agents.';
    const [pro, con] = got;
    const verdict = await quick('את השופטת בדיון. קיבלת טיעוני בעד ונגד. כתבי בעברית הכרעה של שלושה עד ארבעה משפטים: איזה צד חזק יותר ולמה, מה התנאי שבו ההכרעה מתהפכת, ומה הצעד הבא. אל תוסיפי עובדות חדשות.', `${base}\n\n=== בעד ===\n${pro}\n\n=== נגד ===\n${con}`, 600, 'claude-sonnet-5-5');
    return `בעד:\n${pro.slice(0, 2500)}\n\nנגד:\n${con.slice(0, 2500)}\n\nההכרעה:\n${verdict}`;
  } catch (e) { return 'הדיון לא הושלם: ' + e.message; }
}

export async function knowledgeMap(topic) {
  topic = (topic || '').toString().trim(); if (topic.length < 2) return { text: 'חסר על מי או על מה לבנות מפה.' };
  const hist = read('history.jsonl'); let log = '';
  for (let i = hist.length - 1; i >= 0 && log.length < 150000; i--) log += `אדוני: ${hist[i].u}\nלוקה: ${hist[i].a}\n`;
  try {
    const out = await quick('לפניך מה שעוזרת אישית זוכרת על בעליה ויומן שיחות איתו. בנה מפת קשרים סביב הנושא שהתבקש: אנשים, פרויקטים, החלטות, מקומות ומועדים שקשורים אליו, ורק כאלה שמופיעים במפורש בחומר. החזר אך ורק JSON: {"center":"שם הנושא","nodes":[{"name":"שם קצר","type":"person|project|decision|place|date|other","rel":"הקשר לנושא בכמה מילים"}]} עם עד תשעה צמתים. אם אין בחומר דבר על הנושא, החזר {"center":"...","nodes":[]}.',
      `הנושא: ${topic}\n\n=== זיכרון ===\n${memoryText() || '(ריק)'}\n\n=== יומן שיחות ===\n${log || '(ריק)'}`, 900);
    const j = JSON.parse((out.match(/\{[\s\S]*\}/) || ['{}'])[0]);
    const nodes = (Array.isArray(j.nodes) ? j.nodes : []).slice(0, 9).map(n => ({ name: String(n.name || '').slice(0, 26), type: String(n.type || 'other'), rel: String(n.rel || '').slice(0, 60) })).filter(n => n.name);
    if (!nodes.length) return { text: `לא מצאתי בזיכרון או ביומן השיחות קשרים סביב "${topic}".` };
    return { text: `מפת הקשרים סביב ${j.center || topic}:\n` + nodes.map(n => `- ${n.name} (${n.rel})`).join('\n'), card: { kind: 'graph', center: String(j.center || topic).slice(0, 26), nodes } };
  } catch (e) { return { text: 'לא הצלחתי לבנות את המפה: ' + e.message }; }
}

export async function selfReview(days) {
  const d = Math.max(1, Math.min(30, Number(days) || 7)), since = Date.now() - d * 86400000;
  const hist = read('history.jsonl').filter(r => r.at >= since), acts = read('actions.jsonl').filter(r => r.at >= since);
  if (!hist.length && !acts.length) return 'אין עדיין מספיק נתונים לסקירה. היומנים נרשמים מהיום והלאה.';
  const BAD = /לא הצלחתי|לא בוצע|תקלה|סליחה אדוני|לא נמצא|נכשל|HTTP \d|לא התקבלה|לא נפתח|לא נשלח/;
  const failsA = acts.filter(r => BAD.test(r.out)), failsH = hist.filter(r => BAD.test(r.a));
  const count = {}; for (const r of acts) count[r.tool] = (count[r.tool] || 0) + 1;
  const pack = `תקופה: ${d} ימים. שיחות: ${hist.length}. פעולות: ${acts.length}. פעולות שנכשלו: ${failsA.length}. תשובות עם כישלון או התנצלות: ${failsH.length}.
שימוש בכלים: ${Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => k + ' ' + v).join(', ')}

=== פעולות שנכשלו ===
${failsA.slice(-60).map(r => `${r.tool} ${r.in} => ${r.out}`).join('\n').slice(0, 14000)}

=== תשובות עם כישלון ===
${failsH.slice(-40).map(r => `אדוני: ${r.u.slice(0, 200)}\nלוקה: ${r.a.slice(0, 300)}`).join('\n').slice(0, 14000)}

=== בקשות אחרונות של אדוני (לזיהוי דברים שחוזרים על עצמם) ===
${hist.slice(-150).map(r => new Date(r.at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit' }) + ' ' + r.u.slice(0, 120)).join('\n').slice(0, 14000)}`;
  try {
    return await quick('את סוקרת את הביצועים של עוזרת אישית בשם לוקה לפי היומנים שלה. כתבי בעברית סקירה קצרה וכנה בשלושה חלקים: 1. מה נכשל ולמה (דפוסים, לא כל מקרה). 2. הצעות שיפור קונקרטיות למי שבונה אותה. 3. בקשות שחוזרות על עצמן וכדאי להפוך לאוטומטיות (עם הצעה למשימה מתוזמנת). התבססי רק על מה שמופיע בנתונים. אם אין מספיק נתונים לחלק כלשהו, כתבי זאת.', pack, 1300, 'claude-sonnet-5-5')
      + '\n\n(לוקה אינה משנה את הקוד של עצמה. את הצעות השיפור אדוני מעביר למי שבונה אותה.)';
  } catch (e) { return 'הסקירה לא הושלמה: ' + e.message; }
}
