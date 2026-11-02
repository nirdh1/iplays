/**
 * Calendar extras: add a training from the calendar (team / personal /
 * goalkeeper) and each child's attendance stats for the parent.
 */
import { useEffect, useState } from 'react';
import { BottomSheet } from '../components/shell';
import { Button, Card, SectionHeader, Segmented, StatTile } from '../components/ui';
import { getRoster, isStaffRole, type MyTeam, type Player } from '../lib/api';
import { addDays, supabaseCoach, todayYmd } from '../lib/coachApi';
import { attended, playerAttendance, rateOf, type ChildCell } from '../lib/calendarApi';
import { TrainingSheet, type RosterRef } from './TrainingSheet';

type Kid = Player & { team: MyTeam };

export function AddTrainingButton({ teams, kids, onAdded }: { teams: MyTeam[]; kids: Kid[]; onAdded: () => void }) {
  const [pick, setPick] = useState(false);
  const [team, setTeam] = useState<MyTeam | null>(null);
  const [roster, setRoster] = useState<RosterRef[]>([]);

  useEffect(() => {
    if (!team) return;
    setRoster([]);
    getRoster(team.id)
      .then((r) => setRoster(r.map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`.trim(), position: p.position ?? '' }))))
      .catch(() => setRoster([]));
  }, [team]);

  const start = () => {
    if (teams.length === 1) setTeam(teams[0]);
    else setPick(true);
  };
  const myIds = team ? kids.filter((k) => k.team.id === team.id).map((k) => k.id) : [];

  return (
    <>
      <div className="ip-btn-row">
        <Button variant="secondary" icon="plus" onClick={start}>
          הוספת אימון ליומן
        </Button>
      </div>
      <BottomSheet open={pick} onClose={() => setPick(false)} title="לאיזו קבוצה?">
        <div className="ip-stack ip-stack--tight">
          {teams.map((t) => {
            const names = kids.filter((k) => k.team.id === t.id).map((k) => k.first_name);
            return (
              <Button
                key={t.id}
                variant="secondary"
                block
                onClick={() => {
                  setPick(false);
                  setTeam(t);
                }}
              >
                {t.name}
                {names.length ? ` · ${names.join(', ')}` : ''}
              </Button>
            );
          })}
        </div>
      </BottomSheet>
      <TrainingSheet
        open={!!team}
        staff={isStaffRole(team?.role)}
        roster={roster}
        myPlayerIds={myIds}
        initialType={team && !isStaffRole(team.role) && myIds.length ? 'personal' : undefined}
        onClose={() => setTeam(null)}
        onSave={async (input) => {
          if (!team) return;
          await supabaseCoach(team.id).addSessions(input);
          setTeam(null);
          onAdded();
        }}
      />
    </>
  );
}

/** Each child's attendance over the last 30 / 90 days (team, goalkeeper and personal trainings, matches). */
export function KidsAttendance({ kids }: { kids: Kid[] }) {
  const [days, setDays] = useState<'30' | '90'>('90');
  const [cells, setCells] = useState<Record<string, ChildCell[] | null>>({});
  const key = kids.map((k) => k.id).join(',');

  useEffect(() => {
    let alive = true;
    const from = addDays(todayYmd(), -Number(days));
    setCells({});
    kids.forEach((k) =>
      playerAttendance(k.id, from, todayYmd())
        .then((c) => alive && setCells((x) => ({ ...x, [k.id]: c })))
        .catch(() => alive && setCells((x) => ({ ...x, [k.id]: null }))),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, days]);

  if (!kids.length) return null;
  // before the calendar migration the function isn't there: hide the section
  if (kids.every((k) => cells[k.id] === null)) return null;

  return (
    <section>
      <SectionHeader title="סטטיסטיקת נוכחות" icon="check" />
      <Segmented
        items={[
          { id: '30', label: '30 יום' },
          { id: '90', label: '90 יום' },
        ]}
        value={days}
        onChange={setDays}
        label="תקופה"
      />
      <div className="ip-stack ip-stack--tight">
        {kids.map((k) => {
          const c = cells[k.id];
          if (c === null) return null;
          if (c === undefined) return <p key={k.id} className="ip-muted">טוען…</p>;
          const tr = c.filter((x) => x.kind === 'training');
          const mt = c.filter((x) => x.kind === 'match');
          const rate = rateOf(c);
          return (
            <Card key={k.id}>
              <strong>{k.first_name}</strong>
              <div className="ip-stats ip-att-stats">
                <StatTile value={rate == null ? '–' : `${rate}%`} label="נוכחות" accent />
                <StatTile value={`${tr.filter((x) => attended(x.status)).length}/${tr.length}`} label="אימונים" />
                <StatTile value={`${mt.filter((x) => attended(x.status)).length}/${mt.length}`} label="משחקים" />
              </div>
              {c.some((x) => x.status === 'late') && <p className="ip-muted">{c.filter((x) => x.status === 'late').length} איחורים</p>}
            </Card>
          );
        })}
      </div>
      <p className="ip-footnote">פעילויות שהתקיימו. בלי סימון של המאמן ובלי דיווח שלכם, הילד נספר כנוכח.</p>
    </section>
  );
}
