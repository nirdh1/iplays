/**
 * "The club against other clubs" (user 2026-11-11: "איפה התחרויות בין המועדונים").
 * For each club team, its real league table (team_league_table: IFA games played,
 * or the table the family/staff imported), our row highlighted with the rivals
 * around it. Nothing is estimated: a team with no linked league or no results says so.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Loading, SourceTag } from './StateView';
import { standing, topHalf, windowAround, type LeagueTable } from './league';

export function LeagueRivals({ teams }: { teams: { team_id: string; name: string }[] }) {
  const [tables, setTables] = useState<Map<string, LeagueTable | null> | undefined>(undefined);
  const key = teams.map((t) => t.team_id).join(',');
  useEffect(() => {
    let live = true;
    setTables(undefined);
    if (!supabase || !teams.length) {
      setTables(new Map());
      return;
    }
    const sb = supabase;
    Promise.all(
      teams.slice(0, 30).map((t) =>
        sb
          .rpc('team_league_table', { p_team: t.team_id })
          .then(({ data, error }) => [t.team_id, error || !data ? null : (data as LeagueTable)] as const),
      ),
    ).then((pairs) => live && setTables(new Map(pairs)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const list = tables ? [...tables.values()].filter((t): t is LeagueTable => !!t && t.rows?.length > 0) : [];
  const sum = topHalf(list);

  return (
    <section className="os-card os-rivals" id="ck-rivals" aria-labelledby="ck-rivals-h">
      <div className="os-card__head">
        <h2 id="ck-rivals-h">המועדון מול מועדונים אחרים</h2>
        <SourceTag source="ifa" />
      </div>
      {tables === undefined ? (
        <Loading />
      ) : teams.length === 0 ? (
        <p className="os-muted">אין קבוצות משויכות. אחרי שיוך קבוצות יופיע כאן המיקום של כל קבוצה בליגה שלה מול שאר המועדונים.</p>
      ) : (
        <>
          <p className="os-muted os-small">
            {sum.ranked
              ? `${sum.top} מתוך ${sum.ranked} קבוצות עם תוצאות נמצאות בחצי העליון של הליגה שלהן.`
              : 'עדיין אין לקבוצות המועדון טבלת ליגה עם תוצאות.'}{' '}
            הטבלה מחושבת ממשחקי ההתאחדות שנשמרו באפליקציה.
          </p>
          <div className="os-rivals__grid">
            {teams.map((t) => {
              const tab = tables.get(t.team_id) ?? null;
              const s = tab ? standing(tab.rows ?? []) : null;
              return (
                <article key={t.team_id} className="os-rivals__team" data-team={t.team_id}>
                  <header>
                    <strong>{t.name}</strong>
                    {tab?.league_name && <small>{tab.league_name}</small>}
                  </header>
                  {!tab || !tab.rows?.length || !s ? (
                    <p className="os-muted os-small">הקבוצה לא מקושרת לליגה בהתאחדות, ולכן אין לה טבלה.</p>
                  ) : !tab.has_results ? (
                    <p className="os-muted os-small">
                      בליגה {s.of} קבוצות, אבל עדיין אין בה תוצאות (בגילאים הצעירים ההתאחדות לרוב לא מפרסמת תוצאות).
                    </p>
                  ) : (
                    <>
                      <p className="os-rivals__pos">
                        מקום <b>{s.pos}</b> מתוך {s.of}
                        {s.gapUp !== null && s.gapUp > 0 && <span> · {s.gapUp} נק׳ מהמקום שמעל</span>}
                        {s.gapUp === null && <span> · ראשונה בליגה</span>}
                      </p>
                      <table className="os-rivals__table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>קבוצה</th>
                            <th>מש׳</th>
                            <th>נק׳</th>
                          </tr>
                        </thead>
                        <tbody>
                          {windowAround(tab.rows).map((r) => (
                            <tr key={`${r.pos}-${r.name}`} className={r.is_us ? 'is-us' : ''}>
                              <td>{r.pos}</td>
                              <td>{r.name}</td>
                              <td>{r.played}</td>
                              <td>{r.points}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
