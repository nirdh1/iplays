import { useEffect, useState } from 'react';
import { friendlyError } from '../lib/api';
import { getCareer, type Career } from '../lib/careerApi';
import { ErrorNote, Loading, NoData, SourceTag } from './StateView';

/** Player card, read only, from player_career() (same rules as V1). */
export function PlayerScreen({ playerId }: { playerId: string }) {
  const [career, setCareer] = useState<Career | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setCareer(undefined);
    getCareer(playerId)
      .then((c) => live && setCareer(c))
      .catch((e) => live && setError(friendlyError(e)));
    return () => {
      live = false;
    };
  }, [playerId]);

  if (error) return <ErrorNote message={error} />;
  if (career === undefined) return <Loading />;
  if (career === null) return <NoData>אין לך הרשאה לכרטיס של השחקן הזה</NoData>;
  const { player: p, totals: t } = career;
  const rate = t.trainings ? Math.round((t.trainings_attended / t.trainings) * 100) : null;
  const lastAssess = career.assessments?.length ? career.assessments[career.assessments.length - 1] : null;
  const validUntil = career.medical?.length ? career.medical.map((m) => m.valid_until).sort().slice(-1)[0] : null;

  return (
    <div className="os-stack">
      <a className="os-back" href="#os/teams">
        → לסגל
      </a>
      <section className="os-card os-player">
        <span className="os-shirt os-shirt--lg">{p.shirt_number ?? '–'}</span>
        <div>
          <h2>
            {p.first_name} {p.last_name}
          </h2>
          <p className="os-muted">{[p.position, p.birth_year ? `שנתון ${p.birth_year}` : null, p.team_name].filter(Boolean).join(' · ')}</p>
        </div>
      </section>

      <section className="os-card">
        <div className="os-card__head">
          <h2>אימונים ומשחקים</h2>
          <SourceTag source="db" />
        </div>
        <div className="os-kpis">
          <div className="os-kpi">
            <strong>{rate === null ? '—' : `${rate}%`}</strong>
            <span>{rate === null ? 'אין מספיק נתונים' : `נוכחות (${t.trainings_attended}/${t.trainings})`}</span>
          </div>
          <div className="os-kpi">
            <strong>{t.appearances}</strong>
            <span>הופעות</span>
          </div>
          <div className="os-kpi">
            <strong>{t.goals}</strong>
            <span>שערים (דיווח בקבוצה)</span>
          </div>
        </div>
      </section>

      <section className="os-card">
        <div className="os-card__head">
          <h2>הערכת מאמן אחרונה</h2>
          <SourceTag source="coach" />
        </div>
        {career.assessments === null ? (
          <NoData>אין הרשאה לצפייה בהערכות</NoData>
        ) : !lastAssess ? (
          <NoData>עוד לא נשמרה הערכה</NoData>
        ) : (
          <div className="os-kpis">
            {(
              [
                ['speed', 'מהירות'],
                ['stamina', 'סיבולת'],
                ['technique', 'טכניקה'],
                ['vision', 'ראיית משחק'],
              ] as const
            ).map(([k, label]) => (
              <div className="os-kpi" key={k}>
                <strong>{lastAssess[k] ?? '—'}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="os-card">
        <h2>פרטיות</h2>
        <ul className="os-list os-list--plain">
          <li>מדדי גוף: גלויים להורה בלבד (כלל V1 בתוקף עד שמודול המדדים של V2 ייבנה).</li>
          <li>אישור רפואי: {career.medical === null ? 'אין הרשאה' : validUntil ? `בתוקף עד ${validUntil.split('-').reverse().join('.')}` : 'לא הוזן'}. פרטי המנפיק וההערה לא מוצגים כאן.</li>
        </ul>
      </section>

      <section className="os-state os-state--planned">
        <h2>עוד לא מומש בכרטיס</h2>
        <p className="os-muted">הערכה עצמית, יעדים, משובי משחק, נושאים שתורגלו. מתוכננים אחרי ה-MVP.</p>
      </section>
    </div>
  );
}
