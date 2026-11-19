// Online booking for the sites Luka builds for businesses that work by reservation
// (restaurants: a table; salons, barbers and the like: an appointment).
// The page carries one empty box (<div id="luka-booking">) and one script tag. The script draws
// the booking card, and a request is posted back here. While the site is still a demo nothing is
// sent anywhere; once the site was paid for, each request is mailed to the business.
// A booking is a REQUEST: the business confirms it with the customer by phone or WhatsApp.
import fs from 'fs';
import path from 'path';
import { load, save } from './store.js';
import { leads } from './leads.js';
import { salesGmail, salesBoxAddress } from './salesbox.js';

const DIR = path.resolve('./data/sites');
const BASE = () => (process.env.PUBLIC_URL || process.env.BASE_URL || 'https://web-production-1b2f757c.up.railway.app').replace(/\/$/, '');
const file = slug => path.join(DIR, slug + '.html');
const okSlug = s => /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(s || '');
const slugOf = l => l.slug || String(l.site || '').split('/sites/')[1] || '';
const byslug = slug => leads().find(l => slugOf(l) === slug);

// ---------- which businesses get it ----------
const TABLE = /restaurant|bistro|steak|sushi|pizz|diner|grill|eatery|trattoria|taqueria|brasserie|tavern|gastropub|\bpub\b|\bbar\b|מסעד|ביסטרו|סושי|פיצרי|גריל|שיפודי|חומוסי|פאב|בר יין|טברנה/i;
const APPT = /barber|salon|hair|nail|\bspa\b|beauty|lash|brow|massage|tattoo|groom|wax|skin ?care|make ?up|stylist|facial|מספר|ברבר|שיער|ציפורנ|מניקור|פדיקור|קוסמטיק|ספא|עיסוי|יופי|קעקוע|גבות|ריסים|טיפוח|איפור/i;
export function bookingKind(l) {
  const t = (l.type || '') + ' ' + (l.name || '');
  return TABLE.test(t) ? 'table' : APPT.test(t) ? 'appointment' : '';
}
// The lines added to the site brief, so the page is designed with a place for the booking card.
export function bookingBrief(l) {
  const k = bookingKind(l); if (!k) return '';
  return l.market === 'il'
    ? `\nהזמנה מקוונת: הוסיפי חלק בולט עם id="book" וכותרת "${k === 'table' ? 'הזמנת שולחן' : 'קביעת תור'}", ובתוכו תיבה ריקה אחת בדיוק: <div id="luka-booking"></div>. טופס ההזמנה עצמו נכנס לתיבה הזו אוטומטית, אז אל תבני טופס ואל תכתבי בה כלום. התיבה מביאה איתה כרטיס לבן משלה, אז אל תעטפי אותה בכרטיס, מסגרת או רקע משלך. בפתיח הוסיפי, לצד כפתור החיוג, כפתור "${k === 'table' ? 'הזמנת שולחן' : 'קביעת תור'}" שמוביל אל #book.`
    : `\nOnline booking: add a prominent section with id="book" and the heading "${k === 'table' ? 'Book a table' : 'Book an appointment'}", containing exactly one empty box: <div id="luka-booking"></div>. The booking form itself is inserted into that box automatically, so do not build a form and leave the box empty. The box brings its own white card, so do not wrap it in a card, border or background of your own. In the hero, next to the call button, add a "${k === 'table' ? 'Book a table' : 'Book an appointment'}" button that links to #book.`;
}

// Makes sure the page of this business carries the box and the script (also after the page was edited).
export function attachBooking(l) {
  const k = l.booking || bookingKind(l), slug = slugOf(l);
  if (!k || !okSlug(slug)) return false;
  let html; try { html = fs.readFileSync(file(slug), 'utf8'); } catch { return false; }
  const before = html, he = l.market === 'il';
  const put = (block, marks) => {
    for (const m of marks) { const i = html.toLowerCase().lastIndexOf(m); if (i >= 0) { html = html.slice(0, i) + block + '\n' + html.slice(i); return; } }
    html += '\n' + block;
  };
  if (!/id=["']luka-booking["']/.test(html)) put(`<section id="book" style="padding:56px 20px"><div style="max-width:720px;margin:0 auto"><h2 style="text-align:center;margin:0 0 20px">${k === 'table' ? (he ? 'הזמנת שולחן' : 'Book a table') : (he ? 'קביעת תור' : 'Book an appointment')}</h2><div id="luka-booking"></div></div></section>`, ['<footer', '</main>', '</body>']);
  if (!html.includes('/booking-widget.js')) put(`<script src="${BASE()}/booking-widget.js" data-slug="${slug}" defer></script>`, ['</body>', '</html>']);
  if (html !== before) fs.writeFileSync(file(slug), html);
  if (l.booking !== k) { l.booking = k; save(); }
  return true;
}

// ---------- opening hours -> minutes per weekday (0 = Sunday) ----------
const DAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, 'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6 };
function range(s) {
  const t = [...s.matchAll(/(\d{1,2})(?::(\d{2}))?\s*([AP]M)?/gi)]; if (t.length < 2) return null;
  const conv = (x, ap) => { let h = +x[1]; const mi = +(x[2] || 0); ap = (x[3] || ap || '').toUpperCase(); if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0; return h * 60 + mi; };
  let c = conv(t[1], ''), o = conv(t[0], t[1][3] || '');
  if (!t[0][3] && o >= c && o >= 720) o -= 720;              // "9:00 – 5:00 PM"
  if (c <= o) c += 1440;                                      // closes after midnight
  return o < 1440 ? [o, c] : null;
}
export function hoursOf(l) {
  const out = {}; let any = false;
  if (Array.isArray(l.periods) && l.periods.length) {
    for (let d = 0; d < 7; d++) out[d] = [];
    for (const [d, o, c] of l.periods) if (out[d]) out[d].push([o, c]);
    return out;
  }
  for (const raw of l.hours || []) {
    const m = String(raw).replace(/[‎‏]/g, '').replace(/[   ]/g, ' ').match(/^\s*(?:יום\s+)?([^:]+?)\s*:\s*(.+)$/); if (!m) continue;
    const d = DAYS[m[1].trim().toLowerCase()]; if (d === undefined) continue;
    any = true;
    out[d] = /closed|סגור/i.test(m[2]) ? [] : /24 hours|24 שעות/i.test(m[2]) ? [[0, 1440]] : m[2].split(',').map(range).filter(Boolean);
  }
  return any ? out : null;
}

// ---------- the mail to the business (only for a site that was paid for) ----------
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
async function notify(l, b) {
  const g = salesGmail(); if (!g || !l.email) return false;
  const he = l.market === 'il', table = b.kind === 'table', from = salesBoxAddress();
  const digits = b.phone.replace(/\D/g, ''), wa = he ? digits.replace(/^0/, '972') : (digits.length === 10 ? '1' + digits : digits);
  const confirm = he ? `שלום ${b.name}, מאשרים את ${table ? 'ההזמנה' : 'התור'} אצל ${l.name} ב-${b.date} בשעה ${b.time}.` : `Hi ${b.name}, your ${table ? 'table' : 'appointment'} at ${l.name} on ${b.date} at ${b.time} is confirmed.`;
  const rows = he
    ? [['שם', b.name], ['טלפון', b.phone], ['תאריך', b.date], ['שעה', b.time], table ? ['מספר סועדים', b.party] : ['שירות', b.service || 'לא צוין'], ['הערה', b.note || 'אין']]
    : [['Name', b.name], ['Phone', b.phone], ['Date', b.date], ['Time', b.time], table ? ['Party size', b.party] : ['Service', b.service || 'not given'], ['Note', b.note || 'none']];
  const subject = he ? `${table ? 'בקשה להזמנת שולחן' : 'בקשה לקביעת תור'}: ${b.name}, ${b.date} ${b.time}` : `New ${table ? 'table' : 'appointment'} request: ${b.name}, ${b.date} ${b.time}`;
  const intro = he ? `התקבלה בקשה חדשה דרך האתר של ${l.name}. הלקוח ממתין לאישור שלכם.` : `A new request came in through the ${l.name} website. The customer is waiting for your confirmation.`;
  const outro = he ? 'זו הודעה אוטומטית מהאתר. את האישור נותנים ישירות ללקוח, בטלפון או בוואטסאפ.' : 'This is an automatic message from the website. Please confirm directly with the customer, by phone or WhatsApp.';
  const text = [intro, '', ...rows.map(r => r[0] + ': ' + r[1]), '', (he ? 'אישור בוואטסאפ: ' : 'Confirm on WhatsApp: ') + `https://wa.me/${wa}?text=${encodeURIComponent(confirm)}`, '', outro].join('\n');
  const html = `<div dir="${he ? 'rtl' : 'ltr'}" style="direction:${he ? 'rtl' : 'ltr'};text-align:${he ? 'right' : 'left'};font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#111">
<p>${esc(intro)}</p><table cellpadding="6" style="border-collapse:collapse">${rows.map(r => `<tr><td style="color:#666">${esc(r[0])}</td><td><b><span dir="auto">${esc(r[1])}</span></b></td></tr>`).join('')}</table>
<p><a href="https://wa.me/${wa}?text=${encodeURIComponent(confirm)}" style="display:inline-block;background:#1a7f4b;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${he ? 'אישור ללקוח בוואטסאפ' : 'Confirm on WhatsApp'}</a>
&nbsp; <a href="tel:${esc(b.phone)}" dir="ltr">${esc(b.phone)}</a></p><p style="color:#777;font-size:13px">${esc(outro)}</p></div>`;
  const wrap = x => b64(x).replace(/(.{76})/g, '$1\r\n'), ab = 'lukabk' + Date.now().toString(36);
  const raw = [`From: =?UTF-8?B?${b64(l.name)}?= <${from}>`, `To: ${l.email}`, `Subject: =?UTF-8?B?${b64(subject)}?=`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${ab}"`, '',
    `--${ab}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(text),
    `--${ab}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(html), `--${ab}--`].join('\r\n');
  await g.users.messages.send({ userId: 'me', requestBody: { raw: Buffer.from(raw).toString('base64url') } });
  return true;
}

// ---------- routes ----------
const hits = new Map();                                       // address -> times of recent requests
function limited(key, max, ms) {
  const now = Date.now(), a = (hits.get(key) || []).filter(t => now - t < ms);
  if (a.length >= max) { hits.set(key, a); return true; }
  a.push(now); hits.set(key, a);
  if (hits.size > 5000) hits.clear();
  return false;
}
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export function mountBooking(app) {
  const open = (_req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'content-type'); res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); next(); };

  app.get('/booking-widget.js', open, (_req, res) => { res.set('Cache-Control', 'public, max-age=300'); res.type('application/javascript').send(WIDGET); });

  app.get('/sites/:slug/booking.json', open, (req, res) => {
    const l = byslug(req.params.slug), k = l && (l.booking || bookingKind(l));
    if (!k) return res.status(404).json({ ok: false });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, name: l.name, kind: k, he: l.market === 'il', hours: hoursOf(l), live: !!l.live });
  });

  app.options('/sites/:slug/book', open, (_req, res) => res.sendStatus(204));
  app.post('/sites/:slug/book', open, async (req, res) => {
    try {
      const l = byslug(req.params.slug), k = l && (l.booking || bookingKind(l));
      if (!k) return res.status(404).json({ ok: false, error: 'none' });
      const q = req.body || {};
      if (q.website) return res.json({ ok: true, live: !!l.live });               // a hidden field only robots fill in
      const ip = String(req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
      if (limited('ip ' + ip, 6, 3600000) || limited('site ' + req.params.slug, 60, 86400000)) return res.status(429).json({ ok: false, error: 'busy' });
      const b = { slug: req.params.slug, kind: k, name: clean(q.name, 60), phone: clean(q.phone, 24), date: clean(q.date, 10), time: clean(q.time, 5),
        party: Math.max(1, Math.min(30, parseInt(q.party, 10) || 2)), service: clean(q.service, 80), note: clean(q.note, 300), at: Date.now() };
      const day = Date.parse(b.date + 'T00:00:00Z'), ahead = (day - Date.now()) / 86400000;
      if (b.name.length < 2 || b.phone.replace(/\D/g, '').length < 7 || !/^[\d+\-() ]+$/.test(b.phone) || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time) || !(ahead > -2 && ahead < 62))
        return res.status(400).json({ ok: false, error: 'fields' });
      if (!l.live) return res.json({ ok: true, live: false });                     // demo: shown to the visitor, kept nowhere, sent nowhere
      const s = load(); if (!Array.isArray(s.bookings)) s.bookings = [];
      s.bookings.push(b); if (s.bookings.length > 500) s.bookings = s.bookings.slice(-500);
      save();
      let sent = false; try { sent = await notify(l, b); } catch (e) { console.error('booking mail', l.key, e.message); }
      b.sent = sent; save();
      res.json({ ok: true, live: true });
    } catch (e) { console.error('booking', e.message); res.status(500).json({ ok: false, error: 'server' }); }
  });

  // Demo sites built before this feature existed get the booking card too (pages already sold are left as they are).
  setTimeout(() => { try { for (const l of leads()) if (l.site && !l.live && !l.booking && bookingKind(l)) attachBooking(l); } catch (e) { console.error('booking retrofit', e.message); } }, 15000);
}

// ---------- the script that runs inside the site ----------
const WIDGET = `(function(){
var sc=document.currentScript;if(!sc)return;var slug=sc.getAttribute('data-slug'),base=new URL(sc.src).origin;
var root=document.getElementById('luka-booking');if(!root||!slug)return;
fetch(base+'/sites/'+slug+'/booking.json').then(function(r){return r.json()}).then(function(c){if(c&&c.ok)start(c)}).catch(function(){});
function el(t,cls,txt){var e=document.createElement(t);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
function pad(n){return(n<10?'0':'')+n}
function hm(m){m=m%1440;return pad(Math.floor(m/60))+':'+pad(m%60)}
function start(c){
var he=c.he,table=c.kind==='table';
var T=he?{date:'תאריך',time:'שעה',party:'מספר סועדים',service:'איזה שירות? (לא חובה)',name:'שם מלא',phone:'טלפון',note:'הערה (לא חובה)',send:table?'שליחת בקשה להזמנת שולחן':'שליחת בקשה לתור',sending:'שולח…',closed:'סגור',none:'אין שעות פנויות ביום הזה. אפשר לבחור יום אחר.',pick:'נא לבחור תאריך ושעה.',who:'נא למלא שם ומספר טלפון תקין.',fail:'השליחה לא הצליחה. אפשר לנסות שוב או להתקשר.',busy:'נשלחו יותר מדי בקשות. נסו שוב מאוחר יותר או התקשרו.',done:'הבקשה נשלחה',doneSub:'העסק יחזור אליך לאישור סופי.',demo:'זו הדגמה: שום דבר לא נשלח. באתר הפעיל הבקשה מגיעה מיד למייל של העסק, עם כפתור לאישור ללקוח בוואטסאפ.',cal:'הוספה ליומן Google',again:'בקשה נוספת',privacy:'הפרטים נמסרים לעסק לצורך ההזמנה בלבד.',today:'היום',tomorrow:'מחר',people:'סועדים',at:'בשעה',days:['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳']}
:{date:'Date',time:'Time',party:'Party size',service:'Which service? (optional)',name:'Full name',phone:'Phone',note:'Note (optional)',send:table?'Request this table':'Request this appointment',sending:'Sending…',closed:'Closed',none:'No times left on this day. Please pick another day.',pick:'Please choose a date and a time.',who:'Please enter your name and a valid phone number.',fail:'That did not go through. Please try again or call us.',busy:'Too many requests. Please try again later or call us.',done:'Request sent',doneSub:'The business will contact you to confirm.',demo:'This is a demo: nothing was sent. On the live site the request reaches the business by email at once, with a button to confirm with the customer on WhatsApp.',cal:'Add to Google Calendar',again:'New request',privacy:'Your details go to the business for this booking only.',today:'Today',tomorrow:'Tomorrow',people:'guests',at:'at',days:['Sun','Mon','Tue','Wed','Thu','Fri','Sat']};
var accent='#1f2937';try{var b=document.querySelector('a[href^="tel:"]');if(b){var bg=getComputedStyle(b).backgroundColor;var m=bg&&bg.match(/[\\d.]+/g);if(m&&m.length>=3&&(m.length<4||+m[3]>0.5)&&(+m[0]+ +m[1]+ +m[2])<640)accent=bg}}catch(e){}
var css='.lkb{--a:'+accent+';position:relative;background:#fff;color:#1b1b1f;border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:22px;box-shadow:0 10px 34px rgba(0,0,0,.08);max-width:560px;margin:0 auto;text-align:start;font:inherit;font-size:16px;line-height:1.4;direction:'+(he?'rtl':'ltr')+'}'
+'.lkb *{box-sizing:border-box;font-family:inherit}.lkb-l{display:block;font-size:13px;font-weight:600;color:#5b5b66;margin:16px 0 8px}.lkb-l:first-child{margin-top:0}'
+'.lkb-days{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;scrollbar-width:thin}.lkb-times{display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:8px}'
+'.lkb-c{border:1px solid #d9d9e0;background:#fff;color:#1b1b1f;border-radius:12px;padding:9px 10px;font-size:15px;cursor:pointer;transition:.15s;white-space:nowrap}.lkb-c:hover{border-color:var(--a)}'
+'.lkb-c[aria-pressed=true]{background:var(--a);border-color:var(--a);color:#fff}.lkb-c:disabled{opacity:.38;cursor:not-allowed;border-color:#e5e5ea}'
+'.lkb-d{flex:0 0 auto;min-width:66px;text-align:center;line-height:1.25}.lkb-d small{display:block;font-size:12px;opacity:.75}'
+'.lkb-step{display:inline-flex;align-items:center;gap:14px}.lkb-step button{width:40px;height:40px;border-radius:50%;border:1px solid #d9d9e0;background:#fff;color:#1b1b1f;font-size:20px;cursor:pointer;line-height:1}.lkb-step b{min-width:26px;text-align:center;font-size:18px}'
+'.lkb input,.lkb textarea{width:100%;border:1px solid #d9d9e0;border-radius:12px;padding:11px 12px;font-size:16px;background:#fff;color:#1b1b1f;margin:0}.lkb input:focus,.lkb textarea:focus{outline:2px solid var(--a);outline-offset:1px;border-color:transparent}'
+'.lkb-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:480px){.lkb-row{grid-template-columns:1fr}.lkb{padding:16px}}'
+'.lkb-go{width:100%;margin-top:18px;border:0;border-radius:14px;padding:14px;font-size:17px;font-weight:700;color:#fff;background:var(--a);cursor:pointer}.lkb-go:disabled{opacity:.6;cursor:wait}'
+'.lkb-err{color:#b3261e;font-size:14px;margin-top:10px;min-height:1em}.lkb-p{font-size:12px;color:#8a8a94;margin-top:10px;text-align:center}.lkb-n{color:#8a8a94;font-size:14px}'
+'.lkb-ok{text-align:center;padding:10px 0}.lkb-tick{width:64px;height:64px;border-radius:50%;background:var(--a);color:#fff;font-size:34px;line-height:64px;margin:0 auto 12px;animation:lkbpop .45s ease}.lkb-ok h3{margin:0 0 6px;font-size:22px;color:#1b1b1f}.lkb-sum{font-weight:600;margin:10px 0}'
+'.lkb-demo{background:#fff7e0;border:1px solid #f1d98a;color:#6b5200;border-radius:12px;padding:10px 12px;font-size:14px;margin:14px 0;text-align:start}.lkb-links{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px}.lkb-links a,.lkb-links button{border:1px solid #d9d9e0;background:#fff;color:#1b1b1f;border-radius:12px;padding:10px 14px;font-size:15px;text-decoration:none;cursor:pointer}'
+'.lkb-hp{position:absolute!important;width:1px!important;height:1px;padding:0!important;border:0!important;opacity:0;pointer-events:none;clip:rect(0 0 0 0);overflow:hidden}@keyframes lkbpop{0%{transform:scale(.3);opacity:0}70%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}';
var st=el('style');st.textContent=css;document.head.appendChild(st);
var S={date:'',time:'',party:2};
function slots(d,isToday){
var dow=d.getDay(),per=c.hours?(c.hours[dow]||[]):[[table?720:540,table?1320:1200]],out=[],gap=table?60:30,now=new Date(),min=now.getHours()*60+now.getMinutes()+60;
per.forEach(function(p){for(var t=Math.ceil(p[0]/30)*30;t<=p[1]-gap&&t<1440;t+=30){if(isToday&&t<min)continue;if(out.indexOf(t)<0)out.push(t)}});
return out.sort(function(a,b){return a-b})}
function key(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
function nice(k){var p=k.split('-');return he?(+p[2])+'.'+(+p[1])+'.'+p[0]:new Date(+p[0],p[1]-1,+p[2]).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}
function form(){
root.innerHTML='';var box=el('div','lkb');root.appendChild(box);
box.appendChild(el('span','lkb-l',T.date));var days=el('div','lkb-days');box.appendChild(days);
box.appendChild(el('span','lkb-l',T.time));var times=el('div','lkb-times');box.appendChild(times);
var first=null;
for(var i=0;i<21;i++){(function(i){var d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+i);var k=key(d),free=slots(d,i===0);
var btn=el('button','lkb-c lkb-d');btn.type='button';btn.setAttribute('aria-pressed','false');
btn.appendChild(document.createTextNode(i===0?T.today:i===1?T.tomorrow:T.days[d.getDay()]));btn.appendChild(el('small','',free.length?(he?d.getDate()+'.'+(d.getMonth()+1):d.toLocaleDateString('en-US',{month:'short',day:'numeric'})):T.closed));
if(!free.length)btn.disabled=true;else if(!first)first=btn;
btn.onclick=function(){S.date=k;S.time='';[].forEach.call(days.children,function(x){x.setAttribute('aria-pressed','false')});btn.setAttribute('aria-pressed','true');
times.innerHTML='';free.forEach(function(t){var tb=el('button','lkb-c',hm(t));tb.type='button';tb.setAttribute('aria-pressed','false');tb.onclick=function(){S.time=hm(t);[].forEach.call(times.children,function(x){x.setAttribute('aria-pressed','false')});tb.setAttribute('aria-pressed','true');err.textContent=''};times.appendChild(tb)})};
days.appendChild(btn)})(i)}
if(first)first.click();else times.appendChild(el('span','lkb-n',T.none));
var svc=null;
if(table){box.appendChild(el('span','lkb-l',T.party));var sp=el('div','lkb-step'),mi=el('button','','−'),n=el('b','',String(S.party)),pl=el('button','','+');mi.type=pl.type='button';
mi.onclick=function(){S.party=Math.max(1,S.party-1);n.textContent=S.party};pl.onclick=function(){S.party=Math.min(20,S.party+1);n.textContent=S.party};sp.appendChild(mi);sp.appendChild(n);sp.appendChild(pl);box.appendChild(sp)}
else{box.appendChild(el('span','lkb-l',T.service));svc=el('input');svc.maxLength=80;box.appendChild(svc)}
var row=el('div','lkb-row'),a=el('div'),b2=el('div');a.appendChild(el('span','lkb-l',T.name));var nm=el('input');nm.maxLength=60;nm.autocomplete='name';a.appendChild(nm);
b2.appendChild(el('span','lkb-l',T.phone));var ph=el('input');ph.type='tel';ph.maxLength=24;ph.autocomplete='tel';ph.dir='ltr';ph.style.textAlign=he?'right':'left';b2.appendChild(ph);row.appendChild(a);row.appendChild(b2);box.appendChild(row);
box.appendChild(el('span','lkb-l',T.note));var nt=el('textarea');nt.rows=2;nt.maxLength=300;box.appendChild(nt);
var hp=el('input','lkb-hp');hp.tabIndex=-1;hp.autocomplete='off';hp.setAttribute('aria-hidden','true');box.appendChild(hp);
var go=el('button','lkb-go',T.send);go.type='button';box.appendChild(go);var err=el('div','lkb-err');err.setAttribute('role','alert');box.appendChild(err);box.appendChild(el('div','lkb-p',T.privacy));
go.onclick=function(){
if(!S.date||!S.time){err.textContent=T.pick;return}
var name=nm.value.trim(),phone=ph.value.trim();
if(name.length<2||phone.replace(/\\D/g,'').length<7||!/^[\\d+\\-() ]+$/.test(phone)){err.textContent=T.who;return}
err.textContent='';go.disabled=true;go.textContent=T.sending;
var body={name:name,phone:phone,date:S.date,time:S.time,party:S.party,service:svc?svc.value.trim():'',note:nt.value.trim(),website:hp.value};
fetch(base+'/sites/'+slug+'/book',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})}).then(function(x){
if(x.j&&x.j.ok)done(body,x.j.live);else{go.disabled=false;go.textContent=T.send;err.textContent=x.s===429?T.busy:x.s===400?T.who:T.fail}
}).catch(function(){go.disabled=false;go.textContent=T.send;err.textContent=T.fail})}}
function done(b,live){
root.innerHTML='';var box=el('div','lkb'),ok=el('div','lkb-ok');box.appendChild(ok);root.appendChild(box);
ok.appendChild(el('div','lkb-tick','✓'));ok.appendChild(el('h3','',T.done));
ok.appendChild(el('div','lkb-sum',nice(b.date)+' '+T.at+' '+b.time+(table?' · '+b.party+' '+T.people:(b.service?' · '+b.service:''))));
ok.appendChild(el('div','lkb-n',T.doneSub));
if(!live)ok.appendChild(el('div','lkb-demo',T.demo));
var links=el('div','lkb-links'),p=b.date.split('-'),t=b.time.split(':'),s=new Date(+p[0],p[1]-1,+p[2],+t[0],+t[1]),e=new Date(s.getTime()+(table?90:45)*60000);
function f(d){return d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'T'+pad(d.getHours())+pad(d.getMinutes())+'00'}
var cal=el('a','',T.cal);cal.target='_blank';cal.rel='noopener';cal.href='https://calendar.google.com/calendar/render?action=TEMPLATE&text='+encodeURIComponent(c.name)+'&dates='+f(s)+'/'+f(e);links.appendChild(cal);
var ag=el('button','',T.again);ag.type='button';ag.onclick=function(){S.time='';form()};links.appendChild(ag);ok.appendChild(links);
try{box.scrollIntoView({behavior:'smooth',block:'center'})}catch(x){}}
form()}
})();`;
