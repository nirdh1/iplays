/**
 * The MVP's honest status board. Every Club OS screen reads its status from
 * here, so the app and the daily report say the same thing.
 *   live     – real data from the database
 *   partial  – works, with parts marked "בקרוב"
 *   planned  – not built yet; the screen says so and shows no numbers
 */
export type ModuleStatus = 'live' | 'partial' | 'planned';

export interface OsModule {
  id: string;
  label: string;
  icon: 'home' | 'team' | 'calendar' | 'career' | 'grid' | 'card' | 'whistle' | 'shield' | 'check' | 'flag' | 'trophy';
  status: ModuleStatus;
  /** MVP day it is planned for (1-5) */
  day: number;
  summary: string;
  /** what is still missing, shown on the screen */
  missing?: string[];
}

export const modules: OsModule[] = [
  { id: 'teams', label: 'קבוצות וסגל', icon: 'team', status: 'live', day: 1, summary: 'הקבוצות שלך והסגל הפעיל, מהמסד. לחיצה על שחקן פותחת את הכרטיס.' },
  { id: 'home', label: 'בית המאמן', icon: 'home', status: 'live', day: 2, summary: 'האימון הבא, אימונים השבוע, נעדרים מדווחים, אימונים בלי נוכחות.' },
  { id: 'calendar', label: 'יומן ונוכחות', icon: 'calendar', status: 'live', day: 2, summary: 'יומן הקבוצה (14 ימים אחורה, 28 קדימה), יצירה, עריכה וביטול של אימון, סימון נוכחות, המערך המשויך.' },
  { id: 'player', label: 'כרטיס שחקן', icon: 'career', status: 'partial', day: 2, summary: 'נוכחות, הופעות, שערים, הערכת מאמן אחרונה, תוקף אישור רפואי. קריאה בלבד, נפתח מהסגל.', missing: ['הערכה עצמית', 'יעדים', 'משובי משחק'] },
  { id: 'library', label: 'ספריית תרגילים', icon: 'grid', status: 'partial', day: 3, summary: 'ספריית iPlays (25 תרגילי בסיס, טיוטה עד אישור מקצועי), ספריית המועדון והתרגילים שלי. סינון "מה מאמנים היום" לפי נושא אימון, חיפוש, כרטיס תרגיל עם הפעלת תנועה בשרטוט, העתקה, עורך מגרש בסיסי.', missing: ['סבבי תרגילים נוספים לפי נושא, אחרי אישור מקצועי של כל סבב', 'אישור קטגוריות ותרגילים על ידי המנהל המקצועי', 'סיבוב שחקנים וקווים מעוקלים'] },
  { id: 'plans', label: 'מערכי אימון', icon: 'card', status: 'partial', day: 4, summary: 'בונה מערכים מתרגילי הספרייה, בלוק תחנות מקבילות (סבבים, משך תחנה, מעבר, אחראי) עם חישוב משך, שיוך לאימון ביומן עם עותק קפוא.', missing: ['תבניות ושכפול מערך', 'שיבוץ שמי של שחקנים לקבוצות עבודה', 'מתודולוגיית מועדון ותוכנית מול ביצוע'] },
  { id: 'day', label: 'יום האימון', icon: 'whistle', status: 'live', day: 5, summary: 'האימון של היום והמערך המשויך, טיימר שלבים ותחנות עם סבבים וקבוצות, נוכחות, ודוח בדקה (בוצע/שונה/דולג, דירוג, הערה).' },
  { id: 'dashboard', label: 'קוקפיט מנהל', icon: 'shield', status: 'partial', day: 5, summary: 'קוקפיט החלטות בשלושה אזורים: מרכז החלטות (3 תובנות מנתונים אמיתיים, כל אחת עם "מה קרה / למה / מה לעשות" והתערבות אחת), מגרשים היום (לפי היומן בלבד), ומגמות ותוצאות. להנהלת המועדון בלבד.', missing: ['מצב חי של מגרשים וצ\'ק־אין מאמנים (שלב C)', 'מתודולוגיה ותוכנית מול ביצוע', 'כשירות ומגבלות'] },
  { id: 'interventions', label: 'התערבויות', icon: 'flag', status: 'live', day: 5, summary: 'החלטות ניהוליות מתוך תובנות: אחראי, תאריך יעד, מדד בסיס ומדד עדכני שהמערכת מודדת, יומן פעולות, ובדיקת תוצאה עם מסקנה מקצועית. מנהל המועדון רואה הכל; מאמן רואה רק של הקבוצה שלו או מה שהוקצה לו.' },
  { id: 'challenge', label: 'אתגר המועדון', icon: 'trophy', status: 'live', day: 5, summary: 'זירת ראש בראש: האזורים במועדון זה מול זה (נוכחות, מערכים, דוחות, שיפור), והמועדון מול מועדונים אחרים לפי טבלאות הליגה.' },
  { id: 'setup', label: 'הקמת המועדון', icon: 'team', status: 'live', day: 5, summary: 'מסלול ראשון למנהל: שיוך קבוצות המועדון מהקטלוג (חיפוש לפי שם המועדון, בחירה מרובה) והזמנת מאמן לכל קבוצה בקישור.' },
  { id: 'status', label: 'מה עובד', icon: 'check', status: 'live', day: 1, summary: 'מצב כל מסך ב-MVP.' },
];

export const statusLabel: Record<ModuleStatus, string> = { live: 'פעיל', partial: 'חלקי', planned: 'עוד לא מומש' };

export const findModule = (id: string | undefined) => modules.find((m) => m.id === id);
