# לוקה — המוח (שרת 24/7)

זהו ה"מוח" של לוקה. הוא רץ בענן כל הזמן, גם כשהטאבלט כבוי. הוא:

- סורק **Gmail** ו**יומן Google** כל כמה דקות.
- מחליט עם **Claude** מה דחוף ומה לא, ומנסח מה לוקה תגיד.
- **מתקשר אליך** (Twilio) בקולה האמיתי של דנית — אבל **רק בין 09:00 ל-00:00**.
- **וואצאפ**: אתה כותב ללוקה והיא עונה, בקולה ובאישיות שלה.
- נותן לטאבלט API: הטאבלט מושך עדכונים (`/updates`) ולוקה מקריאה אותם בקול.

> בנק — לא מחובר בשלב זה (לפי החלטתך).

---

## מה צריך ממך (חשבונות)

לוקה צריכה כמה "מפתחות" לעולם. אני אלווה אותך בכל אחד:

1. **אירוח בענן** — Railway (הכי פשוט) או Render. כאן השרת יחיה.
2. **Google Cloud** — כדי שלוקה תוכל לקרוא מייל ויומן (OAuth).
3. **Twilio** — מספר טלפון ללוקה (לשיחות) + וואצאפ.
4. מפתחות שכבר יש לך: **Anthropic** (המוח) ו-**ElevenLabs** (הקול).

---

## שלב 1 — אירוח ב-Railway (5 דק')

1. היכנס ל-https://railway.app והתחבר (אפשר עם GitHub).
2. New Project → Deploy from GitHub repo (או "Empty Project" ואז העלאת הקוד).
3. אחרי הפריסה, ב-Settings → Networking → **Generate Domain**. זו הכתובת הציבורית שלך
   (למשל `https://luka-server-production.up.railway.app`) — נקרא לה **PUBLIC_URL**.
4. ב-Variables הזן את כל המשתנים מתוך `.env.example` (ראה שלב 5).

> הערה: ב-Railway/Render הדיסק עלול להתאפס בפריסה מחדש. זה אומר שאחרי עדכון קוד
> ייתכן שתצטרך להיכנס שוב ל-`/auth/google` פעם אחת. לא נורא. (אם נרצה קביעות מלאה
> נוסיף Volume — נעשה את זה בהמשך אם יידרש.)

## שלב 2 — Google Cloud (Gmail + יומן)

1. https://console.cloud.google.com → צור פרויקט חדש בשם `luka`.
2. **APIs & Services → Enabled APIs → Enable**: הפעל את *Gmail API* ואת *Google Calendar API*.
3. **OAuth consent screen**: בחר External, מלא שם אפליקציה "Luka", והוסף את המייל שלך
   תחת *Test users* (חשוב — אחרת הגישה תיחסם).
4. **Credentials → Create Credentials → OAuth client ID → Web application**.
   - Authorized redirect URI: `PUBLIC_URL/auth/google/callback`
     (למשל `https://luka-server-production.up.railway.app/auth/google/callback`)
5. העתק את **Client ID** ו-**Client Secret** → ייכנסו למשתנים.

## שלב 3 — Twilio (שיחות + וואצאפ)

1. https://www.twilio.com → הרשמה. מ-Console העתק **Account SID** ו-**Auth Token**.
2. **Phone Numbers → Buy a number** עם יכולת Voice (זה המספר שממנו לוקה מתקשרת).
   שים אותו ב-`TWILIO_FROM_NUMBER` בפורמט בינלאומי `+972...`.
3. **וואצאפ**: Messaging → Try it out → WhatsApp sandbox (להתחלה מהירה, בחינם).
   - חבר את הוואצאפ שלך לפי ההוראות שם.
   - ב-"When a message comes in" הזן: `PUBLIC_URL/whatsapp` (method POST).
   - `TWILIO_WHATSAPP_FROM` = המספר של ה-sandbox (למשל `whatsapp:+14155238886`).
   - `OWNER_WHATSAPP` = הוואצאפ שלך (`whatsapp:+972...`).

## שלב 4 — המפתחות שכבר יש לך

- `ANTHROPIC_API_KEY` — מ-https://console.anthropic.com (ודא שיש קרדיט/חיוב פעיל).
- `ELEVENLABS_API_KEY` — מהחשבון שלך ב-ElevenLabs. הקול כבר מוגדר (דנית).

## שלב 5 — הזן את המשתנים

העתק את כל השורות מ-`.env.example` אל Variables ב-Railway, עם הערכים שלך.
חשוב במיוחד: `PUBLIC_URL`, `GOOGLE_REDIRECT_URI` (זהה למה שהגדרת ב-Google),
`OWNER_PHONE`, ו-`TABLET_TOKEN` (המצא מחרוזת אקראית ארוכה).

## שלב 6 — חבר את Google

היכנס פעם אחת בדפדפן ל-`PUBLIC_URL/auth/google`, אשר את ההרשאות.
אמור להופיע "לוקה חוברה בהצלחה". מעכשיו היא סורקת לבד.

## שלב 7 — חבר את הטאבלט

בעמוד לוקה שבטאבלט נגדיר שתי כתובות (אני אעשה את זה בקוד כשנגיע):
- `SERVER_URL = PUBLIC_URL`
- `TABLET_TOKEN = <אותו טוקן>`
הטאבלט ימשוך `/updates` כל כמה שניות ולוקה תקריא בקול כל מה שהיא רוצה לומר.

---

## בדיקות מהירות

- `PUBLIC_URL/health` → אמור להחזיר `{ ok: true, google: true/false }`.
- שלח לעצמך וואצאפ ללוקה → היא עונה.
- בדיקת שיחה יזומה: `curl -X POST "PUBLIC_URL/test/whatsapp?token=TABLET_TOKEN" -H "content-type: application/json" -d '{"text":"בדיקה"}'`

## חלון שיחות
לוקה מתקשרת רק בתוך `CALL_START_HOUR`–`CALL_END_HOUR` (ברירת מחדל 9 עד 24, שעון ישראל).
מחוץ לחלון היא לא מתקשרת — רק מצרפת לעדכון שהטאבלט יקריא כשתהיה לידו.

## וואצאפ — שתי רמות
- **לכתוב עם לוקה** (אתה ↔ לוקה): עובד דרך Twilio, בטוח ורשמי. זה מה שמוגדר כאן.
- **שלוקה תקרא הודעות מחברים** ותתריע עליהן: דורש מודול נפרד (לא רשמי, עם סיכון חסימת
  מספר). לא כלול כאן בכוונה — נדבר על זה לפני שנוסיף.
