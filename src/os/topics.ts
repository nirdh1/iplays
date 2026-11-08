// Pure helpers for training topics (no backend imports, so unit tests run in node).

/** Exercises with at least one of the chosen topics, best match first. No topics chosen = all, unchanged. */
export function byTopics<T extends { topics: string[] }>(rows: T[], chosen: string[]): T[] {
  if (chosen.length === 0) return rows;
  const hits = (r: T) => r.topics.filter((t) => chosen.includes(t)).length;
  return rows
    .map((r, i) => ({ r, i, h: hits(r) }))
    .filter((x) => x.h > 0)
    .sort((a, b) => b.h - a.h || a.i - b.i)
    .map((x) => x.r);
}
