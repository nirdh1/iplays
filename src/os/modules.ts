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
  { id: 'teams', label: 'קבוצות וסגל', icon: 'team', status: 'live', day: 1, summary: 'הקבוצות שלך והסגל הפעיל, מהמסד.', missing: ['כרטיס שחקן מלא (יום 2)'] },
  { id: 'home', label: 'בית המאמן', icon: 'home', status: 'planned', day: 2, summary: 'האימון הבא, אימונים השבוע, נעדרים מדווחים, אימונים בלי נוכחות.' },
  { id: 'calendar', label: 'יומן ונוכחות', icon: 'calendar', status: 'planned', day: 2, summary: 'יומן הקבוצה, יצירה ועריכה של אימון, סימון נוכחות.' },
  { id: 'player', label: 'כרטיס שחקן', icon: 'career', status: 'planned', day: 2, summary: 'קריירה, נוכחות, הערכות ומבדקים, לקריאה בלבד.' },
  { id: 'library', label: 'ספריית תרגילים', icon: 'grid', status: 'planned', day: 3, summary: 'חיפוש וסינון, כרטיס תרגיל, עורך מגרש בסיסי.' },
  { id: 'plans', label: 'מערכי אימון', icon: 'card', status: 'planned', day: 4, summary: 'בונה מערכים, תחנות מקבילות, שיוך לאימון ביומן.' },
  { id: 'day', label: 'יום האימון', icon: 'whistle', status: 'planned', day: 5, summary: 'המערך של היום, טיימר שלבים ותחנות, דוח בדקה.' },
  { id: 'dashboard', label: 'דשבורד מנהל', icon: 'shield', status: 'planned', day: 5, summary: 'מדדים אמיתיים בלבד: אימונים שהתקיימו, נוכחות, דוחות חסרים.' },
  { id: 'status', label: 'מה עובד', icon: 'check', status: 'live', day: 1, summary: 'מצב כל מסך ב-MVP.' },
];

export const statusLabel: Record<ModuleStatus, string> = { live: 'פעיל', partial: 'חלקי', planned: 'עוד לא מומש' };

export const findModule = (id: string | undefined) => modules.find((m) => m.id === id);
