# אירועי תרבות — סריקה יומית והודעות WhatsApp — Design

Date: 2026-09-26
Status: approved (pending spec review)

## מטרה

1. כל משתמש בוחר מקטלוג מנוהל אילו אתרי תרבות לעקוב אחריהם (זאפה, צוותא, סינמה סיטי, תיאטראות וכו'), עם סינון לפי **אזור גאוגרפי** ו**סוג אתר**.
2. המערכת סורקת את האתרים הנבחרים **פעם ביום** ומציגה באפליקציה את האירועים הרלוונטיים לאזורים שבחר המשתמש.
3. בתדירות שהמשתמש קובע, נשלחת הודעת WhatsApp עם אירועים **מומלצים** לתקופה הקרובה — קולנוע ותיאטרון מדורגים לפי ביקורות.

## לא-מטרות

- **אין שום כתיבה ליומן** ואין קשר לקוד היומן. הרשאות ה-OAuth נשארות read-only.
- אין הוספת URL חופשי על ידי משתמשים — קטלוג מנוהל בלבד.
- אין מסך ניהול לקטלוג (seed מקוד).
- אין רכישת כרטיסים / התראות על זמינות.
- אין פיצול הסריקה ל-Cloud Tasks (רק אם מספר האתרים יגדל).

## מודל נתונים (Firestore)

### `cultureSources/{sourceId}` — קטלוג מנוהל

```ts
interface CultureSource {
  name: string;            // "צוותא תל אביב"
  url: string;             // עמוד לוח האירועים
  type: "cinema" | "theater" | "music" | "venue" | "tickets";
  regions: CultureRegion[];
  enabled: boolean;
  lastScan?: { at: Timestamp; ok: boolean; error?: string; eventCount: number };
  consecutiveFailures?: number;
}
type CultureRegion = "tel-aviv" | "sharon" | "center" | "jerusalem" | "haifa-north" | "south";
```

- מוגדר בקוד ב-`functions/src/culture/catalog.ts` ומסונכרן ל-Firestore בתחילת כל ריצת סריקה (merge; מקור שהוסר מהקוד מסומן `enabled:false`). אין סקריפט seed נפרד.
- קטלוג ראשוני (כתובות URL מדויקות ייקבעו ויאומתו בשלב התוכנית): זאפה (תל אביב, הרצליה, ירושלים, חיפה), צוותא תל אביב, סינמה סיטי (סניפים לפי אזור), יס פלאנט, סינמטק תל אביב, הבימה, הקאמרי, גשר, בית ליסין, היכל התרבות הרצליה/כפר סבא, בארבי.

### `cultureEvents/{eventId}` — אירועים שנסרקו (משותף לכל המשתמשים)

```ts
interface CultureEvent {
  sourceId: string;
  title: string;
  category: CultureSource["type"];
  venue: string;
  city: string;
  region: CultureRegion;
  dates: Timestamp[];      // מופעים ב-14 הימים הקרובים
  firstDate: Timestamp;
  lastDate: Timestamp;     // לשאילתת מחיקת אירועים שעברו
  url: string;             // קישור לעמוד האירוע/כרטיסים (אותו דומיין כמו המקור)
  description?: string;
  review: { score: "positive" | "mixed" | "negative"; summary: string; outlet: string } | null;
  reviewPending: boolean;  // true ביצירה לקולנוע/תיאטרון, עד שחיפוש הביקורת רץ
  recommended: boolean;
  firstSeenAt: Timestamp;
  lastSeenAt: Timestamp;
}
```

- `eventId = sha1(sourceId + "|" + normalizeTitle(title))` — סריקה חוזרת מעדכנת ולא משכפלת.
- אירוע שכל תאריכיו עברו — נמחק בסוף הסריקה.

### `settings/{uid}.culture` — העדפות משתמש

```ts
interface CultureSettings {
  enabled: boolean;
  regions: CultureRegion[];
  types: CultureSource["type"][];
  sourceIds: string[];
  taste: string;           // טקסט חופשי, אופציונלי
  frequency: "daily" | "twiceWeekly" | "weekly";
  days: number[];          // 0=ראשון; daily: מתעלם, twiceWeekly: 2 ימים, weekly: יום אחד
  time: string;            // "HH:MM" שעון ישראל
}
```

ברירת מחדל ב-`DEFAULT_SETTINGS`: `enabled:false`, `frequency:"weekly"`, `days:[0]`, `time:"09:00"`.

### `cultureSentLog/{uid}`

מפה `{ "<YYYY-MM-DD>_<HH:MM>": true }`, כמו לוג ה-digest הקיים.

### Firestore rules

- `cultureSources`, `cultureEvents`: קריאה למשתמשים מחוברים, כתיבה רק מה-Functions (admin SDK).
- `cultureSentLog`: אין גישה מהלקוח.
- `settings/{uid}.culture`: תחת הכלל הקיים של `settings`.

## Cloud Functions

### 1. `cultureDailyScan` — מתוזמנת, כל יום 03:00 Asia/Jerusalem

1. קורא את כל `settings` עם `culture.enabled` ואוסף את איחוד `sourceIds`.
2. לכל מקור פעיל שנבחר (עד `MAX_SOURCES_PER_RUN`), עם concurrency מוגבל (3):
   - `scanSource(source)` → קריאה ל-Claude (`claude-opus-5` עם `fallbacks: "default"`, כלי web fetch) שמחזירה JSON של אירועים ב-14 הימים הקרובים.
   - `validateScanResult` מסנן פריטים לא תקינים (שדות חובה, תאריכים תקינים ובטווח, URL מאותו דומיין).
   - upsert ל-`cultureEvents`; עדכון `lastScan` ו-`consecutiveFailures`.
   - כישלון: נרשם, ממשיכים הלאה; אירועים קיימים של המקור נשמרים.
3. חיפוש ביקורות: לאירועים עם `reviewPending == true` (עד `MAX_REVIEW_LOOKUPS_PER_RUN`) → `lookupReview(event)` (Claude + web search, `max_uses` מוגבל) → מעדכן `review`, `recommended = review?.score === "positive"`, `reviewPending = false`.
4. מחיקת אירועים שעברו.

- הקריאות ל-Claude עטופות ב-`functions/src/culture/claudeScanner.ts` (ממשק `scanSource`, `lookupReview`) כדי לאפשר mock.
- סוד חדש: `ANTHROPIC_API_KEY` דרך `defineSecret`. תלות חדשה: `@anthropic-ai/sdk`.
- timeout מוגדל לפונקציה (1800 שניות), ותקציב עבודה של 25 דקות.
- המודל מוגדר בקבוע יחיד `CULTURE_MODEL`; מעבר ל-`claude-sonnet-5` הוא שינוי של שורה אחת.

### 2. שליחת WhatsApp — בתוך `whatsappSchedulerTick` הקיים

פונקציה חדשה `processCulture(uid, settings, now, ...)` בדפוס של `processDigest`:

1. `isCultureDue(settings.culture, nowParts, sentLog)` — האם השעה/היום תואמים ולא נשלח כבר.
2. טווח: מעכשיו ועד מועד השליחה הבא לפי התדירות (`nextSendAfter`).
3. שאילתה ל-`cultureEvents` לפי `sourceId in sourceIds` (בחלוקה ל-chunks של 30), סינון לפי `regions`, `types` ותאריך בטווח.
4. `selectForMessage` — עד 8 אירועים: קודם `recommended`, אחר כך התאמת מילות מפתח מ-`taste` לכותרת/תיאור, אחר כך מועד קרוב.
5. אין אירועים → לא שולחים, אבל מסמנים בלוג כדי לא לנסות שוב.
6. `buildCultureMessage` → `sendWhatsApp`. `WhatsAppQuotaExceededError` → לא מסמנים, ניסיון חוזר ב-tick הבא.

אין קריאה ל-Claude בזמן השליחה.

### 3. `sendTestCultureCallable`

שולח מיד הודעה לפי ההגדרות הנוכחיות (לכפתור "שלח הודעת בדיקה").

## ממשק

- **`/culture`** (`app/(app)/culture/page.tsx`) + קישור בניווט ב-`app/(app)/layout.tsx`: רשימת כל האירועים מהמקורות והאזורים של המשתמש, ממוינת לפי מועד קרוב, עם סינון לפי סוג, אזור ותאריך (היום / השבוע / הכל), ותג "מומלץ" עם שורת הביקורת. קריאה ישירה מ-Firestore בצד הלקוח.
- **`CultureSection`** ב-`src/components/settings/`, בסגנון `DigestSection`: הפעלה, אזורים (chips), סוגים (chips), רשימת אתרים מסוננת לפי הבחירות (checkbox, עם הערה ליד אתר שנכשל 3 ימים ברצף), שדה טעם אישי, תדירות + ימים + שעה, שמירה, וכפתור הודעת בדיקה.

## טיפול בשגיאות

| מצב | התנהגות |
|---|---|
| אתר לא זמין / מבנה השתנה / JSON שבור | נרשם ב-`lastScan`, `consecutiveFailures++`, ממשיכים; אירועים קיימים נשמרים |
| 3 כישלונות רצופים | הערה "סריקה לא זמינה כרגע" בהגדרות |
| פריט לא תקין בפלט Claude | נזרק ב-`validateScanResult` |
| חריגה מתקרות לילה | שאר המקורות/הביקורות נדחים ללילה הבא (FIFO לפי `lastScan.at`) |
| מכסת WhatsApp | ניסיון חוזר ב-tick הבא |
| אין אירועים לתקופה | לא נשלחת הודעה |

## עלויות

- עלות יומית תלויה במספר המקורות הפעילים, לא במספר המשתמשים.
- ביקורת נבדקת פעם אחת לכל אירוע.
- תקרות קבועות בקוד: `MAX_SOURCES_PER_RUN`, `MAX_REVIEW_LOOKUPS_PER_RUN`, `max_uses` לכלי החיפוש.
- הערכה כספית מדויקת מול המחירון העדכני בשלב התוכנית.

## בדיקות

`node:test` + `node:assert/strict`, בסגנון `nag.test.ts`:

- `eventId` / `normalizeTitle` — יציבות בין ריצות ורווחים/פיסוק.
- `validateScanResult` — קבלה/דחייה של פריטים.
- `selectForMessage` — סינון מקורות/אזורים/טווח, העדפת מומלצים, תקרה של 8.
- `isCultureDue` / `nextSendAfter` — שלוש התדירויות, אזור זמן, לוג שליחות.
- `buildCultureMessage` — פורמט הודעה בעברית.

`claudeScanner` מוחלף ב-mock בבדיקות; בדיקת קצה-לקצה ידנית עם כפתור הודעת הבדיקה.

## קבצים

חדשים:
- `functions/src/culture/types.ts`, `catalog.ts`, `time.ts`, `scanResult.ts`, `claudeScanner.ts`, `scan.ts` (`cultureDailyScan`), `select.ts`, `message.ts`, `schedule.ts`, `notify.ts`, ו-`*.test.ts` מתאימים
- `app/(app)/culture/page.tsx`
- `src/components/settings/CultureSection.tsx`, `src/components/culture/*`

משתנים:
- `functions/src/index.ts` (export), `functions/src/notifications/scheduler.ts` (`processCulture`, callable), `functions/src/types.ts`, `src/lib/types.ts` (`DEFAULT_SETTINGS.culture`)
- `app/(app)/layout.tsx` (ניווט), `app/(app)/settings/*` (הוספת הסקשן), `firestore.rules`, `functions/package.json`
