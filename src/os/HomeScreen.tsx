import { useEffect, useState } from 'react';
import { friendlyError, type MyTeam } from '../lib/api';
import { addDays, reasonLabel, supabaseCoach, todayYmd, type Absence, type TrainingSession } from '../lib/coachApi';
import { dayLabel, pastAttendance, sessionsBetween, timeLabel, weekStart, type PastAttendance } from './data';
import { ErrorNote, Loading, NoData, SourceTag } from './StateView';

interface HomeData {
  week: TrainingSession[];
  next: TrainingSession | null;
  absences: Absence[];
  past: PastAttendance;
  pastSessions: Map<string, TrainingSession>;
}

/** Coach Home: everything here is read from the team's real trainings, reports and marks. */
export function HomeScreen({ team }: { team: MyTeam }) {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    const today = todayYmd();
    const ws = weekStart(today);
    Promise.all([
      sessionsBetween(team.id, ws, addDays(ws, 6)),
      sessionsBetween(team.id, today, addDays(today, 30)),
      supabaseCoach(team.id).listAbsences(),
      pastAttendance(team.id, 14),
      sessionsBetween(team.id, addDays(today, -14), today),
    ])
      .then(([week, ahead, absences, past, recent]) => {
        if (!live) return;
        const now = Date.now();
        const next = ahead.find((s) => !s.canceled && new Date(s.starts_at).getTime() > now) ?? null;
        const soon = addDays(today, 7);
        setData({
          week,
          next,
          absences: absences.filter((a) => a.to_date >= today && a.from_date <= soon),
          past,
          pastSessions: new Map(recent.map((s) => [s.id, s])),
        });
      })
      .catch((e) => live && setError(friendlyError(e)));
    return () => {
      live = false;
    };
  }, [team.id]);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  const held = data.week.filter((s) => !s.canceled && new Date(s.starts_at).getTime() < Date.now()).length;
  const planned = data.week.filter((s) => !s.canceled).length;
  const canceled = data.week.length - planned;

  return (
    <div className="os-grid">
      <section className="os-card os-card--hero">
        <div className="os-card__head">
          <h2>האימון הבא</h2>
          <SourceTag source="db" />
        </div>
        {data.next ? (
          <>
            <p className="os-hero">
              {dayLabel(data.next.starts_at)} · {timeLabel(data.next.starts_at)}
            </p>
            <p className="os-muted">
              {data.next.title} · {data.next.duration_min} דק׳{data.next.location ? ` · ${data.next.location}` : ''}
            </p>
            <a className="os-btn" href={`#os/calendar/${data.next.id}`}>
              פתיחה ונוכחות
            </a>
          </>
        ) : (
          <NoData>אין אימון מתוכנן ב-30 הימים הקרובים</NoData>
        )}
      </section>

      <section className="os-card">
        <div className="os-card__head">
          <h2>השבוע</h2>
          <SourceTag source="db" />
        </div>
        <div className="os-kpis">
          <div className="os-kpi">
            <strong>{planned}</strong>
            <span>אימונים מתוכננים</span>
          </div>
          <div className="os-kpi">
            <strong>{held}</strong>
            <span>כבר התקיימו</span>
          </div>
          {canceled > 0 && (
            <div className="os-kpi">
              <strong>{canceled}</strong>
              <span>בוטלו</span>
            </div>
          )}
        </div>
      </section>

      <section className="os-card">
        <div className="os-card__head">
          <h2>נוכחות ב-14 הימים האחרונים</h2>
          <SourceTag source="coach" />
        </div>
        {data.past.rate === null ? (
          <NoData>אין מספיק נתונים: לא סומנה נוכחות באף אימון</NoData>
        ) : (
          <div className="os-kpis">
            <div className="os-kpi">
              <strong>{data.past.rate}%</strong>
              <span>הגיעו (מתוך {data.past.markedCells} סימונים)</span>
            </div>
            <div className="os-kpi">
              <strong>{data.past.held.length}</strong>
              <span>אימונים שהתקיימו</span>
            </div>
          </div>
        )}
      </section>

      <section className="os-card">
        <div className="os-card__head">
          <h2>אימונים בלי נוכחות</h2>
          <span className="os-muted">14 ימים</span>
        </div>
        {data.past.unmarked.length === 0 ? (
          <NoData>{data.past.held.length ? 'בכל האימונים סומנה נוכחות' : 'לא התקיימו אימונים'}</NoData>
        ) : (
          <ul className="os-list">
            {data.past.unmarked.map((id) => {
              const s = data.pastSessions.get(id);
              return (
                <li key={id}>
                  <a href={`#os/calendar/${id}`}>
                    <span>{s ? `${dayLabel(s.starts_at)} · ${timeLabel(s.starts_at)}` : 'אימון'}</span>
                    <span className="os-chip os-chip--warn">חסרה נוכחות</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="os-card">
        <div className="os-card__head">
          <h2>היעדרויות מדווחות</h2>
          <span className="os-muted">7 הימים הקרובים</span>
        </div>
        {data.absences.length === 0 ? (
          <NoData>אין היעדרויות מדווחות</NoData>
        ) : (
          <ul className="os-list">
            {data.absences.map((a) => (
              <li key={a.id}>
                <span>
                  <strong>{a.player_name}</strong> · {a.kind === 'late' ? 'יאחר' : 'לא יגיע'} · {reasonLabel[a.reason]}
                </span>
                <span className="os-muted">{a.from_date === a.to_date ? a.from_date.slice(5).split('-').reverse().join('.') : `${a.from_date.slice(5).split('-').reverse().join('.')}–${a.to_date.slice(5).split('-').reverse().join('.')}`}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="os-muted os-small">דיווחי הורים. סיבת "חולה" או "פציעה" מוצגת בלי ההערה החופשית.</p>
      </section>
    </div>
  );
}
