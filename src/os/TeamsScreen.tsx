import { useEffect, useState } from 'react';
import { friendlyError, getRoster, type MyTeam, type Player } from '../lib/api';
import { ErrorNote, Loading, NoData, SourceTag } from './StateView';
import { envLabel } from './env';

/** Day 1: the team and its active roster, straight from player_assignments. */
export function TeamsScreen({ team }: { team: MyTeam; playerId?: string }) {
  const [roster, setRoster] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRoster(null);
    setError(null);
    getRoster(team.id)
      .then((r) => live && setRoster(r))
      .catch((e) => live && setError(friendlyError(e)));
    return () => {
      live = false;
    };
  }, [team.id]);

  const byYear = new Map<number | null, number>();
  for (const p of roster ?? []) byYear.set(p.birth_year, (byYear.get(p.birth_year) ?? 0) + 1);

  return (
    <div className="os-stack">
      <section className="os-card">
        <div className="os-card__head">
          <h2>{team.name}</h2>
          <SourceTag source={envLabel ? 'synthetic' : 'db'} />
        </div>
        <p className="os-muted">
          {[team.club, team.season].filter(Boolean).join(' · ') || 'בלי מועדון ועונה'}
        </p>
        {roster && (
          <div className="os-kpis">
            <div className="os-kpi">
              <strong>{roster.length}</strong>
              <span>שחקנים פעילים</span>
            </div>
            {[...byYear.entries()]
              .filter(([y]) => y != null)
              .sort(([a], [b]) => (a ?? 0) - (b ?? 0))
              .map(([y, n]) => (
                <div className="os-kpi" key={y}>
                  <strong>{n}</strong>
                  <span>שנתון {y}</span>
                </div>
              ))}
          </div>
        )}
      </section>

      <section className="os-card">
        <div className="os-card__head">
          <h2>סגל</h2>
          <span className="os-muted">כרטיס שחקן: יום 2</span>
        </div>
        {error && <ErrorNote message={error} />}
        {!roster && !error && <Loading />}
        {roster && roster.length === 0 && <NoData>אין שחקנים פעילים בקבוצה</NoData>}
        {roster && roster.length > 0 && (
          <ul className="os-roster">
            {roster.map((p) => (
              <li key={p.id}>
                <span className="os-shirt">{p.shirt_number ?? '–'}</span>
                <span className="os-roster__name">
                  {p.first_name} {p.last_name}
                </span>
                <span className="os-muted">{p.position || 'ללא עמדה'}</span>
                <span className="os-muted">{p.birth_year ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
