/**
 * Diagram model shared by exercises and (later) lineups. Coordinates are in
 * metres: x along the length of the area (0..length), y across it (0..width).
 * Stored as JSON in exercises.diagram; the same JSON draws identically on a
 * phone and on a desktop because only the scale changes.
 */
export type PitchPreset = '11v11' | '9v9' | '7v7' | 'half' | 'third' | 'custom';
export type ElementType = 'player' | 'gk' | 'ball' | 'cone' | 'goal' | 'minigoal' | 'mannequin';
export type LineType = 'pass' | 'run' | 'dribble' | 'shot';
export type Team = 'a' | 'b' | 'n';

export interface DiagramElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  team?: Team;
  label?: string;
  rot?: number;
}
export interface DiagramLine {
  id: string;
  type: LineType;
  pts: [number, number][];
}
export interface Diagram {
  v: 1;
  elements: DiagramElement[];
  lines: DiagramLine[];
}

export const emptyDiagram = (): Diagram => ({ v: 1, elements: [], lines: [] });

/** Size of each preset in metres (length × width). Small-sided sizes follow common youth-format ranges. */
export const presetSize: Record<Exclude<PitchPreset, 'custom'>, { l: number; w: number }> = {
  '11v11': { l: 105, w: 68 },
  '9v9': { l: 70, w: 50 },
  '7v7': { l: 55, w: 35 },
  half: { l: 52.5, w: 68 },
  third: { l: 35, w: 68 },
};

export const presetLabel: Record<PitchPreset, string> = {
  '11v11': 'מגרש 11 (105×68)',
  '9v9': 'מגרש 9 (70×50)',
  '7v7': 'מגרש 7 (55×35)',
  half: 'חצי מגרש',
  third: 'שליש מגרש',
  custom: 'שטח מותאם',
};

export function areaOf(preset: PitchPreset, w?: number | null, l?: number | null): { l: number; w: number } {
  if (preset === 'custom') return { l: Math.max(5, l ?? 20), w: Math.max(5, w ?? 15) };
  return presetSize[preset];
}

export function parseDiagram(raw: unknown): Diagram {
  const d = (raw ?? {}) as Partial<Diagram>;
  return {
    v: 1,
    elements: Array.isArray(d.elements) ? d.elements.filter((e) => e && typeof e.x === 'number' && typeof e.y === 'number') : [],
    lines: Array.isArray(d.lines) ? d.lines.filter((l) => l && Array.isArray(l.pts) && l.pts.length >= 2) : [],
  };
}

export const MAX_ITEMS = 200;

/** Short text description of a diagram, for screen readers and as a fallback. */
export function describe(d: Diagram): string {
  const count = (t: ElementType) => d.elements.filter((e) => e.type === t).length;
  const parts = [
    count('player') && `${count('player')} שחקנים`,
    count('gk') && `${count('gk')} שוערים`,
    count('ball') && `${count('ball')} כדורים`,
    count('cone') && `${count('cone')} קונוסים`,
    count('goal') + count('minigoal') && `${count('goal') + count('minigoal')} שערים`,
    d.lines.filter((l) => l.type === 'pass').length && `${d.lines.filter((l) => l.type === 'pass').length} מסירות`,
    d.lines.filter((l) => l.type !== 'pass').length && `${d.lines.filter((l) => l.type !== 'pass').length} תנועות`,
  ].filter(Boolean);
  return parts.length ? `שרטוט: ${parts.join(', ')}` : 'שרטוט ריק';
}
