/**
 * Fictional Hebrew demo content. All people, clubs and venues are invented.
 * Shapes here mirror what the real API should return per child.
 */

export type EventKind = 'match' | 'team' | 'private';

export interface ScheduleItem {
  id: string;
  day: number; // 0 = Sunday … 6 = Saturday (Israeli week)
  time: string;
  kind: EventKind;
  title: string;
  place: string;
}

export interface Match {
  home: string;
  away: string;
  homeShort: string;
  awayShort: string;
  dateLabel: string;
  kickoff: string;
  arrival: string;
  venue: string;
  address: string;
  competition: string;
}

export interface LiveUpdate {
  minute: string;
  text: string;
  kind: 'goal' | 'card' | 'info';
  mine?: boolean;
}

export interface Live {
  status: 'live' | 'final';
  period: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  updates: LiveUpdate[];
}

export interface Carpool {
  title: string;
  driver: string;
  departure: string;
  from: string;
  seats: { taken: number; total: number };
  status: 'confirmed' | 'needs-driver' | 'pending';
  passengers: string[];
}

export interface CommunityPost {
  id: string;
  author: string;
  role: string;
  time: string;
  text: string;
  reactions: number;
  comments: number;
}

export interface Attribute {
  label: string;
  value: number; // 0–100
  delta: number; // change since last assessment
}

export interface Career {
  appearances: number;
  goals: number;
  assists: number;
  minutes: number;
  /** Goal involvements per month, oldest first */
  monthly: { month: string; goals: number; assists: number }[];
  attributes: Attribute[];
  highlights: { date: string; title: string; detail: string; icon: 'star' | 'goal' | 'bolt' }[];
}

export interface ChildNotification {
  id: string;
  text: string;
  time: string;
  tone: 'info' | 'action';
}

export interface Child {
  id: string;
  firstName: string;
  lastName: string;
  age: number;
  sport: string;
  sportIcon: 'ball' | 'whistle';
  club: string;
  team: string;
  season: string;
  number: number;
  position: string;
  jersey: string; // jersey color for illustrated avatar
  hair: string;
  hairStyle: 'short' | 'long' | 'curly';
  nextMatch: Match;
  nextTraining: { title: string; kind: EventKind; dateLabel: string; time: string; place: string; coach: string; bring: string };
  live?: Live;
  notifications: ChildNotification[];
  week: ScheduleItem[];
  carpool: Carpool;
  community: CommunityPost[];
  career: Career;
}

export const parent = {
  firstName: 'רונית',
  lastName: 'לוי',
  unread: 3,
};

/** Demo "today" is Saturday 31.10 — index 6 in the Israeli week. */
export const today = { dayIndex: 6, label: 'שבת, 31 באוקטובר' };

export const weekDays = [
  { short: 'א׳', date: '1.11' },
  { short: 'ב׳', date: '2.11' },
  { short: 'ג׳', date: '3.11' },
  { short: 'ד׳', date: '4.11' },
  { short: 'ה׳', date: '5.11' },
  { short: 'ו׳', date: '6.11' },
  { short: 'ש׳', date: '7.11' },
];

export const children: Child[] = [
  {
    id: 'noam',
    firstName: 'נועם',
    lastName: 'לוי',
    age: 11,
    sport: 'כדורגל',
    sportIcon: 'ball',
    club: 'הכוכבים כפר סבא',
    team: 'ילדים א׳',
    season: '2026/27',
    number: 10,
    position: 'קשר התקפי',
    jersey: '#3DA5FF',
    hair: '#3b2a1e',
    hairStyle: 'short',
    nextMatch: {
      home: 'הכוכבים כפר סבא',
      away: 'נשרי הוד השרון',
      homeShort: 'הכוכבים',
      awayShort: 'נשרי הוד',
      dateLabel: 'שבת 7.11',
      kickoff: '10:30',
      arrival: '09:45',
      venue: 'מגרש הפארק העירוני',
      address: 'דרך הפארק 12, כפר סבא',
      competition: 'ליגת ילדים א׳ · מחזור 6',
    },
    nextTraining: {
      title: 'אימון קבוצתי',
      kind: 'team',
      dateLabel: 'מחר, יום א׳',
      time: '17:00–18:30',
      place: 'מגרש סינטטי 2',
      coach: 'המאמן אורי',
      bring: 'נעלי פקקים, בקבוק מים',
    },
    notifications: [
      { id: 'n1', text: 'אישור השתתפות בטורניר חנוכה ממתין לך', time: 'לפני שעה', tone: 'action' },
      { id: 'n2', text: 'המאמן אורי העלה סרטון ניתוח מהמשחק האחרון', time: 'אתמול', tone: 'info' },
    ],
    live: {
      status: 'final',
      period: 'סיום · שבת שעברה',
      home: 'הכוכבים',
      away: 'מכבי צור יגאל',
      homeScore: 3,
      awayScore: 1,
      updates: [
        { minute: "52'", text: 'שער! נועם לוי כובש מבעיטה מחוץ לרחבה', kind: 'goal', mine: true },
        { minute: "38'", text: 'שער! עידו שמש מקביעה אחרי מסירה של נועם', kind: 'goal' },
        { minute: "21'", text: 'שער לצור יגאל', kind: 'goal' },
        { minute: "9'", text: 'שער! איתן בן דוד בנגיחה', kind: 'goal' },
      ],
    },
    week: [
      { id: 'w1', day: 0, time: '17:00', kind: 'team', title: 'אימון קבוצתי', place: 'מגרש סינטטי 2' },
      { id: 'w2', day: 1, time: '16:30', kind: 'private', title: 'אימון אישי · טכניקה', place: 'עם המאמן גיל' },
      { id: 'w3', day: 2, time: '17:00', kind: 'team', title: 'אימון קבוצתי', place: 'מגרש סינטטי 2' },
      { id: 'w4', day: 4, time: '17:00', kind: 'team', title: 'אימון קבוצתי + כושר', place: 'מגרש סינטטי 2' },
      { id: 'w5', day: 6, time: '10:30', kind: 'match', title: 'משחק ליגה מול נשרי הוד השרון', place: 'מגרש הפארק העירוני' },
    ],
    carpool: {
      title: 'הסעה למשחק בשבת',
      driver: 'אבא של עידו (משה שמש)',
      departure: '09:20',
      from: 'רחוב ויצמן 40',
      seats: { taken: 3, total: 4 },
      status: 'confirmed',
      passengers: ['נועם', 'עידו', 'איתן'],
    },
    community: [
      {
        id: 'c1',
        author: 'אורי מזרחי',
        role: 'מאמן ראשי',
        time: 'לפני 3 שעות',
        text: 'כל הכבוד על המשחק בשבת! השבוע נתמקד במעברים מהגנה להתקפה. נא להגיע 10 דקות לפני האימון.',
        reactions: 24,
        comments: 6,
      },
      {
        id: 'c2',
        author: 'הועד',
        role: 'קופת הקבוצה',
        time: 'אתמול',
        text: 'נאספו 2,400 ₪ מתוך 3,000 ₪ למתנת סוף העונה למאמנים. תודה לכולם!',
        reactions: 11,
        comments: 2,
      },
    ],
    career: {
      appearances: 14,
      goals: 9,
      assists: 6,
      minutes: 812,
      monthly: [
        { month: 'מאי', goals: 1, assists: 1 },
        { month: 'יוני', goals: 2, assists: 0 },
        { month: 'ספט׳', goals: 2, assists: 2 },
        { month: 'אוק׳', goals: 4, assists: 3 },
      ],
      attributes: [
        { label: 'מהירות', value: 78, delta: 6 },
        { label: 'סיבולת', value: 71, delta: 4 },
        { label: 'טכניקה', value: 84, delta: 3 },
        { label: 'ראיית משחק', value: 80, delta: 5 },
      ],
      highlights: [
        { date: '24.10', title: 'שחקן המשחק', detail: 'שער ובישול מול מכבי צור יגאל', icon: 'star' },
        { date: '10.10', title: 'צמד ראשון העונה', detail: 'מול הפועל אבן יהודה', icon: 'goal' },
        { date: '01.10', title: 'שיא אישי בספרינט', detail: '30 מטר ב-4.9 שניות', icon: 'bolt' },
      ],
    },
  },
  {
    id: 'maya',
    firstName: 'מאיה',
    lastName: 'לוי',
    age: 9,
    sport: 'כדורסל',
    sportIcon: 'ball',
    club: 'ברקים רעננה',
    team: 'קט-סל בנות',
    season: '2026/27',
    number: 7,
    position: 'רכזת',
    jersey: '#7CF23D',
    hair: '#5a3a22',
    hairStyle: 'long',
    nextMatch: {
      home: 'ברקים רעננה',
      away: 'גלבוע הצפון',
      homeShort: 'ברקים',
      awayShort: 'גלבוע',
      dateLabel: 'היום',
      kickoff: '11:00',
      arrival: '10:15',
      venue: 'אולם הספורט אופק',
      address: 'רחוב אחוזה 150, רעננה',
      competition: 'ליגת קט-סל · מחזור 4',
    },
    nextTraining: {
      title: 'אימון קבוצתי',
      kind: 'team',
      dateLabel: 'יום ב׳',
      time: '16:00–17:15',
      place: 'אולם אופק',
      coach: 'המאמנת שירן',
      bring: 'נעלי אולם, מגבת',
    },
    notifications: [
      { id: 'n3', text: 'המשחק בשידור חי עכשיו · רבע 3', time: 'עכשיו', tone: 'action' },
    ],
    live: {
      status: 'live',
      period: 'רבע 3 · 04:12',
      home: 'ברקים',
      away: 'גלבוע',
      homeScore: 34,
      awayScore: 28,
      updates: [
        { minute: 'רבע 3', text: 'מאיה לוי · שלשה!', kind: 'goal', mine: true },
        { minute: 'רבע 3', text: 'פסק זמן לגלבוע הצפון', kind: 'info' },
        { minute: 'רבע 2', text: 'מחצית: ברקים 26 · גלבוע 24', kind: 'info' },
      ],
    },
    week: [
      { id: 'm1', day: 1, time: '16:00', kind: 'team', title: 'אימון קבוצתי', place: 'אולם אופק' },
      { id: 'm2', day: 3, time: '16:00', kind: 'team', title: 'אימון קבוצתי', place: 'אולם אופק' },
      { id: 'm3', day: 4, time: '18:00', kind: 'private', title: 'אימון קליעה אישי', place: 'עם המאמן דני' },
      { id: 'm4', day: 6, time: '12:00', kind: 'match', title: 'משחק חוץ מול אליצור נתניה', place: 'אולם יד לבנים' },
    ],
    carpool: {
      title: 'הסעה למשחק החוץ בנתניה',
      driver: 'טרם נקבע נהג',
      departure: '11:00',
      from: 'אולם אופק',
      seats: { taken: 2, total: 4 },
      status: 'needs-driver',
      passengers: ['מאיה', 'נגה'],
    },
    community: [
      {
        id: 'c3',
        author: 'שירן אברהם',
        role: 'מאמנת',
        time: 'לפני שעה',
        text: 'בנות, אתן משחקות מדהים! תמונות מהמחצית הראשונה עלו לגלריה.',
        reactions: 31,
        comments: 9,
      },
    ],
    career: {
      appearances: 6,
      goals: 42,
      assists: 15,
      minutes: 148,
      monthly: [
        { month: 'מאי', goals: 6, assists: 2 },
        { month: 'יוני', goals: 8, assists: 3 },
        { month: 'ספט׳', goals: 12, assists: 4 },
        { month: 'אוק׳', goals: 16, assists: 6 },
      ],
      attributes: [
        { label: 'מהירות', value: 74, delta: 3 },
        { label: 'סיבולת', value: 66, delta: 5 },
        { label: 'קליעה', value: 79, delta: 8 },
        { label: 'מסירה', value: 82, delta: 2 },
      ],
      highlights: [
        { date: '17.10', title: 'שיא נקודות אישי', detail: '14 נקודות מול מכבי הרצליה', icon: 'star' },
        { date: '03.10', title: '3 שלשות במשחק', detail: 'מול הפועל כפר יונה', icon: 'bolt' },
      ],
    },
  },
  {
    id: 'itay',
    firstName: 'איתי',
    lastName: 'לוי',
    age: 7,
    sport: 'כדורגל',
    sportIcon: 'ball',
    club: 'הכוכבים כפר סבא',
    team: 'טרום א׳',
    season: '2026/27',
    number: 4,
    position: 'מגן',
    jersey: '#FFB020',
    hair: '#2a1d14',
    hairStyle: 'curly',
    nextMatch: {
      home: 'הכוכבים כפר סבא',
      away: 'אליצור רמת השרון',
      homeShort: 'הכוכבים',
      awayShort: 'אליצור',
      dateLabel: 'יום ו׳ 6.11',
      kickoff: '09:00',
      arrival: '08:30',
      venue: 'מגרש בית ספר אלונים',
      address: 'רחוב הדקל 3, כפר סבא',
      competition: 'טורניר טרום א׳',
    },
    nextTraining: {
      title: 'אימון קבוצתי',
      kind: 'team',
      dateLabel: 'יום ג׳',
      time: '16:00–17:00',
      place: 'מגרש אלונים',
      coach: 'המאמן רועי',
      bring: 'בקבוק מים, כובע',
    },
    notifications: [],
    week: [
      { id: 'i1', day: 2, time: '16:00', kind: 'team', title: 'אימון קבוצתי', place: 'מגרש אלונים' },
      { id: 'i2', day: 5, time: '09:00', kind: 'match', title: 'טורניר טרום א׳', place: 'מגרש אלונים' },
    ],
    carpool: {
      title: 'הסעה לטורניר ביום ו׳',
      driver: 'רונית לוי (את)',
      departure: '08:15',
      from: 'הבית',
      seats: { taken: 2, total: 3 },
      status: 'pending',
      passengers: ['איתי', 'רון'],
    },
    community: [
      {
        id: 'c4',
        author: 'רועי כץ',
        role: 'מאמן',
        time: 'אתמול',
        text: 'מזכיר: ביום ו׳ טורניר בבית ספר אלונים. כל ילד מביא פרי לחלוקה בהפסקה 🍉',
        reactions: 8,
        comments: 3,
      },
    ],
    career: {
      appearances: 5,
      goals: 2,
      assists: 1,
      minutes: 160,
      monthly: [
        { month: 'מאי', goals: 0, assists: 0 },
        { month: 'יוני', goals: 1, assists: 0 },
        { month: 'ספט׳', goals: 0, assists: 1 },
        { month: 'אוק׳', goals: 1, assists: 0 },
      ],
      attributes: [
        { label: 'מהירות', value: 58, delta: 7 },
        { label: 'סיבולת', value: 55, delta: 4 },
        { label: 'טכניקה', value: 49, delta: 6 },
        { label: 'עבודת צוות', value: 72, delta: 5 },
      ],
      highlights: [{ date: '20.10', title: 'שער ראשון!', detail: 'בטורניר הסתיו', icon: 'goal' }],
    },
  },
];
