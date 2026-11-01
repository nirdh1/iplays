/**
 * Sport profiles: what differs between sports. Everything else (teams,
 * trainings, announcements, absences, attendance, carpools, payments, kit,
 * permissions) is the shared core and works the same for every sport.
 * Screens ask the profile what to show; a sport without a profile entry gets
 * the core only.
 */
import type { Sport } from './api';

export interface SportProfile {
  /** matches against an opponent */
  hasMatches: boolean;
  /** lineups per match; null = no lineups in this sport */
  lineup: null | {
    defaultSize: number;
    sizes: number[];
    /** label of slot 1..n (index 0 = slot 1); missing = "שחקן" */
    slotLabels: string[];
  };
  /** what a score counts */
  scoreLabel: string;
}

const football: SportProfile = {
  hasMatches: true,
  lineup: { defaultSize: 7, sizes: [5, 7, 8, 9, 11], slotLabels: ['שוער'] },
  scoreLabel: 'שערים',
};

const basketball: SportProfile = {
  hasMatches: true,
  lineup: { defaultSize: 5, sizes: [5], slotLabels: ['רכז', 'קלע', 'פורוורד', 'פורוורד', 'סנטר'] },
  scoreLabel: 'נקודות',
};

// other sports: the shared core only (trainings, attendance, absences, ...), no matches or lineups
const core: SportProfile = { hasMatches: false, lineup: null, scoreLabel: 'תוצאה' };

export function sportProfile(sport: Sport | string | undefined): SportProfile {
  if (sport === 'football') return football;
  if (sport === 'basketball') return basketball;
  return core;
}

export function slotLabel(p: SportProfile, slot: number) {
  return p.lineup?.slotLabels[slot - 1] ?? 'שחקן';
}
