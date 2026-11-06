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
  icon: 'home' | 'team' | 'calendar' | 'career' | 'grid' | 'card' | 'whistle' | 'shield' | 'check';
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
  { id: 'library', label: 'ספריית תרגילים', icon: 'grid', status: 'partial', day: 3, summary: 'ספריית iPlays (10 תרגילי בסיס, טיוטה עד אישור מקצועי), ספריית המועדון והתרגילים שלי. חיפוש וסינון, כרטיס תרגיל, העתקה, עורך מגרש בסיסי.', missing: ['15 תרגילי בסיס נוספים (מתוך 25)', 'אישור קטגוריות ותרגילים על ידי המנהל המקצועי', 'סיבוב שחקנים וקווים מעוקלים'] },
  { id: 'plans', label: 'מערכי אימון', icon: 'card', status: 'partial', day: 4, summary: 'בונה מערכים מתרגילי הספרייה, בלוק תחנות מקבילות (סבבים, משך תחנה, מעבר, אחראי) עם חישוב משך, שיוך לאימון ביומן עם עותק קפוא.', missing: ['תבניות ושכפול מערך', 'שיבוץ שמי של שחקנים לקבוצות עבודה', 'מתודולוגיית מועדון ותוכנית מול ביצוע'] },
  { id: 'day', label: 'יום האימון', icon: 'whistle', status: 'live', day: 5, summary: 'האימון של היום והמערך המשויך, טיימר שלבים ותחנות עם סבבים וקבוצות, נוכחות, ודוח בדקה (בוצע/שונה/דולג, דירוג, הערה).' },
  { id: 'dashboard', label: 'דשבורד מנהל', icon: 'shield', status: 'partial', day: 5, summary: '5 מדדים אמיתיים (אימונים שהתקיימו, נוכחות מסימוני צוות, דוחות חסרים, אימונים בלי מערך, תרגילים חדשים) ועד 3 פעולות בעדיפות. להנהלת המועדון בלבד.', missing: ['מתודולוגיה ותוכנית מול ביצוע', 'כשירות ומגבלות', 'משימות והאצלה'] },
  { id: 'status', label: 'מה עובד', icon: 'check', status: 'live', day: 1, summary: 'מצב כל מסך ב-MVP.' },
];

export const statusLabel: Record<ModuleStatus, string> = { live: 'פעיל', partial: 'חלקי', planned: 'עוד לא מומש' };

export const findModule = (id: string | undefined) => modules.find((m) => m.id === id);
