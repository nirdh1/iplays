import { useEffect, useState } from 'react';
import { listTopics, type Topic } from './exercisesApi';

let cache: Promise<Topic[]> | null = null;

/** Training topics, loaded once per page. [] while loading or when the list does not exist yet. */
export function useTopics(): Topic[] {
  const [topics, setTopics] = useState<Topic[]>([]);
  useEffect(() => {
    let live = true;
    (cache ??= listTopics().catch(() => [])).then((t) => live && setTopics(t));
    return () => {
      live = false;
    };
  }, []);
  return topics;
}

export const topicLabel = (topics: Topic[], code: string) => topics.find((t) => t.code === code)?.label ?? code;

/** Toggle chips. Used as the "what are we working on today" filter and in the editor. */
export function TopicChips({
  topics,
  value,
  onChange,
  max,
  label,
}: {
  topics: Topic[];
  value: string[];
  onChange: (v: string[]) => void;
  max?: number;
  label: string;
}) {
  if (topics.length === 0) return null;
  const full = max !== undefined && value.length >= max;
  return (
    <div className="os-topics" role="group" aria-label={label}>
      <span className="os-topics__label">{label}</span>
      <div className="os-topics__chips">
        {topics.map((t) => {
          const on = value.includes(t.code);
          return (
            <button
              key={t.code}
              type="button"
              className={`os-topic${on ? ' is-on' : ''}`}
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => onChange(on ? value.filter((x) => x !== t.code) : [...value, t.code])}
            >
              {t.label}
            </button>
          );
        })}
        {value.length > 0 && (
          <button type="button" className="os-topic os-topic--clear" onClick={() => onChange([])}>
            ניקוי
          </button>
        )}
      </div>
    </div>
  );
}

export function TopicTags({ topics, codes, highlight = [] }: { topics: Topic[]; codes: string[]; highlight?: string[] }) {
  if (codes.length === 0 || topics.length === 0) return null;
  return (
    <span className="os-ex-card__tags">
      {codes.map((c) => (
        <span key={c} className={`os-chip${highlight.includes(c) ? ' os-chip--done' : ''}`}>
          {topicLabel(topics, c)}
        </span>
      ))}
    </span>
  );
}
