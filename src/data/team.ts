/**
 * Fictional team-level demo data, keyed by child id. In the real app this
 * comes from the team endpoints (fixtures, trainings, fund, roster).
 */

export interface Player {
  name: string;
  number: number;
  position: string;
  childId?: string; // set when the player is one of the parent's children
}

export interface Fixture {
  id: string;
  date: string;
  opponent: string;
  home: boolean;
  result?: { us: number; them: number };
  time?: string;
  venue: string;
}

export interface TrainingEvent {
  id: string;
  day: string;
  time: string;
  title: string;
  place: string;
  kind: 'team' | 'private';
  rsvp: 'yes' | 'no' | 'pending';
  going: number;
  squad: number;
}

export interface FundItem {
  id: string;
  title: string;
  goal: number;
  raised: number;
  perFamily: number;
  paid: boolean;
  due: string;
}

export interface StandingRow {
  pos: number;
  team: string;
  played: number;
  points: number;
  us?: boolean;
}

export interface TeamData {
  coach: string;
  assistant: string;
  league: string;
  record: { w: number; d: number; l: number };
  standings: StandingRow[];
  fixtures: Fixture[];
  trainings: TrainingEvent[];
  fund: FundItem[];
  roster: Player[];
}

export const teams: Record<string, TeamData> = {
  noam: {
    coach: 'אורי מזרחי',
    assistant: 'גיל אדרי',
    league: 'ליגת ילדים א׳ · מחוז שרון',
    record: { w: 4, d: 1, l: 0 },
    standings: [
      { pos: 1, team: 'הכוכבים כפר סבא', played: 5, points: 13, us: true },
      { pos: 2, team: 'נשרי הוד השרון', played: 5, points: 12 },
      { pos: 3, team: 'מכבי צור יגאל', played: 5, points: 9 },
      { pos: 4, team: 'הפועל אבן יהודה', played: 5, points: 7 },
    ],
    fixtures: [
      { id: 'f1', date: 'שבת 7.11', opponent: 'נשרי הוד השרון', home: true, time: '10:30', venue: 'מגרש הפארק העירוני' },
      { id: 'f2', date: 'שבת 14.11', opponent: 'הפועל אבן יהודה', home: false, time: '11:00', venue: 'מגרש אבן יהודה' },
      { id: 'f3', date: 'שבת 24.10', opponent: 'מכבי צור יגאל', home: true, result: { us: 3, them: 1 }, venue: 'מגרש הפארק העירוני' },
      { id: 'f4', date: 'שבת 17.10', opponent: 'אליצור רמת השרון', home: false, result: { us: 2, them: 2 }, venue: 'מגרש רמת השרון' },
      { id: 'f5', date: 'שבת 10.10', opponent: 'הפועל אבן יהודה', home: true, result: { us: 4, them: 0 }, venue: 'מגרש הפארק העירוני' },
    ],
    trainings: [
      { id: 't1', day: 'יום א׳ 1.11', time: '17:00–18:30', title: 'אימון קבוצתי', place: 'מגרש סינטטי 2', kind: 'team', rsvp: 'yes', going: 14, squad: 16 },
      { id: 't2', day: 'יום ב׳ 2.11', time: '16:30–17:30', title: 'אימון אישי · טכניקה', place: 'עם המאמן גיל', kind: 'private', rsvp: 'yes', going: 1, squad: 1 },
      { id: 't3', day: 'יום ג׳ 3.11', time: '17:00–18:30', title: 'אימון קבוצתי', place: 'מגרש סינטטי 2', kind: 'team', rsvp: 'pending', going: 9, squad: 16 },
      { id: 't4', day: 'יום ה׳ 5.11', time: '17:00–18:30', title: 'אימון קבוצתי + כושר', place: 'מגרש סינטטי 2', kind: 'team', rsvp: 'pending', going: 6, squad: 16 },
    ],
    fund: [
      { id: 'u1', title: 'מתנת סוף עונה למאמנים', goal: 3000, raised: 2400, perFamily: 150, paid: true, due: '30.11' },
      { id: 'u2', title: 'טורניר חנוכה · דמי השתתפות', goal: 2400, raised: 900, perFamily: 120, paid: false, due: '15.11' },
    ],
    roster: [
      { name: 'עומר דהן', number: 1, position: 'שוער' },
      { name: 'איתן בן דוד', number: 9, position: 'חלוץ' },
      { name: 'נועם לוי', number: 10, position: 'קשר התקפי', childId: 'noam' },
      { name: 'עידו שמש', number: 11, position: 'כנף' },
      { name: 'יונתן פרץ', number: 4, position: 'בלם' },
      { name: 'אריאל חדד', number: 6, position: 'קשר' },
      { name: 'רועי גבאי', number: 3, position: 'מגן' },
      { name: 'דניאל אוחיון', number: 7, position: 'כנף' },
    ],
  },
  maya: {
    coach: 'שירן אברהם',
    assistant: 'דני רוזן',
    league: 'ליגת קט-סל בנות · מחוז שרון',
    record: { w: 3, d: 0, l: 1 },
    standings: [
      { pos: 1, team: 'מכבי הרצליה', played: 4, points: 8 },
      { pos: 2, team: 'ברקים רעננה', played: 4, points: 7, us: true },
      { pos: 3, team: 'גלבוע הצפון', played: 4, points: 6 },
      { pos: 4, team: 'אליצור נתניה', played: 4, points: 5 },
    ],
    fixtures: [
      { id: 'mf1', date: 'היום', opponent: 'גלבוע הצפון', home: true, time: '11:00', venue: 'אולם הספורט אופק' },
      { id: 'mf2', date: 'שבת 7.11', opponent: 'אליצור נתניה', home: false, time: '12:00', venue: 'אולם יד לבנים' },
      { id: 'mf3', date: 'שבת 24.10', opponent: 'מכבי הרצליה', home: false, result: { us: 31, them: 36 }, venue: 'אולם הרצליה' },
      { id: 'mf4', date: 'שבת 17.10', opponent: 'הפועל כפר יונה', home: true, result: { us: 40, them: 22 }, venue: 'אולם אופק' },
    ],
    trainings: [
      { id: 'mt1', day: 'יום ב׳ 2.11', time: '16:00–17:15', title: 'אימון קבוצתי', place: 'אולם אופק', kind: 'team', rsvp: 'yes', going: 10, squad: 12 },
      { id: 'mt2', day: 'יום ד׳ 4.11', time: '16:00–17:15', title: 'אימון קבוצתי', place: 'אולם אופק', kind: 'team', rsvp: 'pending', going: 7, squad: 12 },
      { id: 'mt3', day: 'יום ה׳ 5.11', time: '18:00–19:00', title: 'אימון קליעה אישי', place: 'עם המאמן דני', kind: 'private', rsvp: 'yes', going: 1, squad: 1 },
    ],
    fund: [{ id: 'mu1', title: 'חולצות חימום לקבוצה', goal: 1800, raised: 1800, perFamily: 150, paid: true, due: '1.11' }],
    roster: [
      { name: 'מאיה לוי', number: 7, position: 'רכזת', childId: 'maya' },
      { name: 'נגה כהן', number: 5, position: 'קלעית' },
      { name: 'תמר אלון', number: 12, position: 'פורוורד' },
      { name: 'שירה מור', number: 9, position: 'סנטרית' },
      { name: 'יעל ברק', number: 3, position: 'קלעית' },
      { name: 'הילה סער', number: 10, position: 'פורוורד' },
    ],
  },
  itay: {
    coach: 'רועי כץ',
    assistant: 'אסף לב',
    league: 'טרום א׳ · ליגת התפתחות (ללא טבלה)',
    record: { w: 2, d: 2, l: 1 },
    standings: [],
    fixtures: [
      { id: 'if1', date: 'יום ו׳ 6.11', opponent: 'אליצור רמת השרון', home: true, time: '09:00', venue: 'מגרש בית ספר אלונים' },
      { id: 'if2', date: 'יום ו׳ 23.10', opponent: 'הפועל הוד השרון', home: false, result: { us: 1, them: 1 }, venue: 'מגרש הוד השרון' },
    ],
    trainings: [
      { id: 'it1', day: 'יום ג׳ 3.11', time: '16:00–17:00', title: 'אימון קבוצתי', place: 'מגרש אלונים', kind: 'team', rsvp: 'pending', going: 8, squad: 14 },
    ],
    fund: [{ id: 'iu1', title: 'פירות וכיבוד לטורנירים', goal: 700, raised: 350, perFamily: 50, paid: false, due: '6.11' }],
    roster: [
      { name: 'איתי לוי', number: 4, position: 'מגן', childId: 'itay' },
      { name: 'רון שגיא', number: 8, position: 'קשר' },
      { name: 'אלון זך', number: 9, position: 'חלוץ' },
      { name: 'מיכאל טל', number: 1, position: 'שוער' },
    ],
  },
};
