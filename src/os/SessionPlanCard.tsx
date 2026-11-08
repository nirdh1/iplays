import { useEffect, useState } from 'react';
import { friendlyError } from '../lib/api';
import { getAssignment, unassignPlan, type Assignment } from './plans/api';
import { ErrorNote, Loading, SourceTag } from './StateView';

type SnapBlock = Assignment['snapshot']['blocks'][number] & { minutes?: number };

/** The plan assigned to one training (the frozen snapshot), on the session page. */
export function SessionPlanCard({ sessionId }: { sessionId: string }) {
  const [a, setA] = useState<Assignment | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getAssignment(sessionId).then(setA).catch((e) => setError(friendlyError(e)));
  }, [sessionId]);

  const unassign = async () => {
    if (!window.confirm('להסיר את המערך מהאימון הזה? המערך עצמו לא נמחק.')) return;
    setBusy(true);
    try {
      await unassignPlan(sessionId);
      setA(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorNote message={error} />;
  if (a === undefined) return <Loading />;
  if (!a)
    return (
      <section className="os-card">
        <div className="os-card__head">
          <h2>מערך אימון</h2>
        </div>
        <p className="os-muted">לאימון הזה עוד לא שויך מערך.</p>
        <a className="os-btn os-btn--ghost" href="#os/plans">
          בחר מערך ושייך
        </a>
      </section>
    );
  const p = a.snapshot;
  const blocks = (p.blocks ?? []) as SnapBlock[];
  return (
    <section className="os-card">
      <div className="os-card__head">
        <h2>מערך: {p.title}</h2>
        <span className="os-ex-card__tags">
          <span className="os-chip os-chip--done">{p.total_min} דק׳</span>
          <SourceTag source="coach" />
        </span>
      </div>
      {p.goal && <p className="os-muted">נושא: {p.goal}</p>}
      <ol className="os-plan-lines">
        {blocks.map((b, i) => (
          <li key={i}>
            <span>
              {b.kind === 'stations' ? `תחנות${b.title ? `: ${b.title}` : ''}` : b.kind === 'break' ? b.title || 'הפסקה' : b.exercise?.title ?? b.title}
              {b.kind === 'stations' && (
                <span className="os-muted os-small">
                  {' '}
                  · {b.stations.length} תחנות, {b.groups} קבוצות, {b.rounds}×{b.station_min} דק׳ + מעבר {b.transition_min} דק׳ ·{' '}
                  {b.stations.map((s) => s.exercise?.title ?? s.title).join(' / ')}
                </span>
              )}
            </span>
            <span className="os-chip">{b.minutes ?? '—'} דק׳</span>
          </li>
        ))}
      </ol>
      <p className="os-muted os-small">עותק מתאריך השיוך {new Date(a.assigned_at).toLocaleDateString('he-IL')}. הורים ושחקנים רואים רק את השם והנושא.</p>
      <div className="os-row os-row--start">
        {a.plan_id && (
          <a className="os-btn os-btn--ghost" href={`#os/plans/${a.plan_id}`}>
            פתח את המערך
          </a>
        )}
        <button type="button" className="os-btn os-btn--ghost" onClick={unassign} disabled={busy}>
          הסר מהאימון
        </button>
      </div>
    </section>
  );
}
