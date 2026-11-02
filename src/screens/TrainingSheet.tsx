/**
 * Add a training or a weekly series. Used by the coach board and by the
 * calendar. Types offered depend on who is adding:
 *   staff:   team training · goalkeepers of the team · picked players
 *   parents: team training · personal training (own child + teammates)
 *            · goalkeeper training (private / all the team's goalkeepers)
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/shell';
import { Button } from '../components/ui';
import { Err, Field } from '../components/form';
import { friendlyError } from '../lib/api';
import { addDays, todayYmd, type SessionInput, type TrainingAudience, type TrainingKind } from '../lib/coachApi';
import { calendarError, isGoalkeeperPosition } from '../lib/calendarApi';

export interface RosterRef {
  id: string;
  name: string;
  position: string;
}

type TypeId = 'team' | 'personal' | 'gk_private' | 'gk_team' | 'picked';

const typeDef: Record<TypeId, { label: string; kind: TrainingKind; audience: TrainingAudience; title: string; hint: string }> = {
  team: { label: 'אימון קבוצתי', kind: 'team', audience: 'team', title: 'אימון קבוצתי', hint: 'מופיע ביומן של כל השחקנים וההורים בקבוצה.' },
  personal: { label: 'אימון אישי', kind: 'personal', audience: 'players', title: 'אימון אישי', hint: 'מופיע רק ביומן המשפחתי שלכם, וביומן של מי שתצרפו.' },
  gk_private: { label: 'אימון שוערים פרטי', kind: 'goalkeeper', audience: 'players', title: 'אימון שוערים', hint: 'מופיע רק אצלכם ואצל מי שתצרפו.' },
  gk_team: { label: 'אימון שוערים קבוצתי', kind: 'goalkeeper', audience: 'goalkeepers', title: 'אימון שוערים קבוצתי', hint: 'מופיע אוטומטית לכל השוערים בקבוצה ולהורים שלהם.' },
  picked: { label: 'שחקנים נבחרים', kind: 'goalkeeper', audience: 'players', title: 'אימון שוערים', hint: 'בחרו כל שחקן שתרצו, לא רק שוערים. האימון יופיע להם ולהוריהם.' },
};

const durations = [45, 60, 75, 90, 120];
const repeats = [
  { n: 1, label: 'פעם אחת' },
  { n: 4, label: '4 שבועות' },
  { n: 8, label: '8 שבועות' },
  { n: 12, label: '12 שבועות' },
  { n: 26, label: 'חצי שנה' },
];

export function TrainingSheet({
  open,
  onClose,
  onSave,
  staff,
  roster,
  myPlayerIds,
  allowTeam = true,
  initialType,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (input: SessionInput) => Promise<void>;
  staff: boolean;
  /** the team's players (to pick participants); empty = team trainings only */
  roster: RosterRef[];
  /** my children in this team */
  myPlayerIds: string[];
  allowTeam?: boolean;
  initialType?: TypeId;
}) {
  const myGk = roster.some((p) => myPlayerIds.includes(p.id) && isGoalkeeperPosition(p.position));
  const types = useMemo<TypeId[]>(() => {
    const list: TypeId[] = allowTeam ? ['team'] : [];
    if (!roster.length) return list.length ? list : ['team'];
    if (staff) return [...list, 'gk_team', 'picked'];
    if (myPlayerIds.length) list.push('personal');
    if (myGk) list.push('gk_private', 'gk_team');
    return list;
  }, [allowTeam, roster.length, staff, myPlayerIds.length, myGk]);

  const blank = () => ({ date: addDays(todayYmd(), 1), time: '17:00', duration_min: 90, title: '', location: '', note: '', repeatWeeks: 1 });
  const [type, setType] = useState<TypeId>('team');
  const [f, setF] = useState(blank);
  const [players, setPlayers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = initialType && types.includes(initialType) ? initialType : types[0];
    setType(t);
    setF(blank());
    setPlayers(myPlayerIds.length === 1 && !staff ? [...myPlayerIds] : []);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const def = typeDef[type];
  const picking = def.audience === 'players';
  const pickable = picking ? roster : [];
  const valid = !!f.date && !!f.time && (!picking || (players.length > 0 && (staff || players.some((p) => myPlayerIds.includes(p)))));
  const weekday = f.date ? new Date(`${f.date}T12:00`).toLocaleDateString('he-IL', { weekday: 'long' }) : '';
  const toggle = (id: string) => setPlayers((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        ...f,
        title: f.title.trim() || def.title,
        kind: def.kind,
        audience: def.audience,
        players: picking ? players : [],
      });
    } catch (err) {
      setError(calendarError(err) ?? friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="הוספת אימון">
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        {types.length > 1 && (
          <Field label="סוג">
            <div className="ip-player-chips">
              {types.map((t) => (
                <button key={t} type="button" className={type === t ? 'is-on' : ''} aria-pressed={type === t} onClick={() => setType(t)}>
                  {typeDef[t].label}
                </button>
              ))}
            </div>
          </Field>
        )}
        {types.length > 1 && <p className="ip-footnote">{def.hint}</p>}

        {picking && (
          <Field label={staff ? 'שחקנים' : 'משתתפים (הילד שלכם וחברים מהקבוצה)'}>
            <div className="ip-player-chips">
              {pickable.map((p) => (
                <button key={p.id} type="button" className={players.includes(p.id) ? 'is-on' : ''} aria-pressed={players.includes(p.id)} onClick={() => toggle(p.id)}>
                  {p.name}
                  {isGoalkeeperPosition(p.position) ? ' 🧤' : ''}
                </button>
              ))}
            </div>
          </Field>
        )}

        <div className="ip-field-row">
          <Field label="תאריך">
            <input type="date" className="ip-input" min={todayYmd()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          </Field>
          <Field label="שעה">
            <input type="time" className="ip-input" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} required />
          </Field>
        </div>
        <Field label="משך">
          <div className="ip-player-chips">
            {durations.map((d) => (
              <button key={d} type="button" className={f.duration_min === d ? 'is-on' : ''} aria-pressed={f.duration_min === d} onClick={() => setF({ ...f, duration_min: d })}>
                {d === 60 ? 'שעה' : d === 90 ? 'שעה וחצי' : d === 120 ? 'שעתיים' : `${d} דק׳`}
              </button>
            ))}
          </div>
        </Field>
        <Field label={weekday ? `חזרה כל ${weekday} באותה שעה` : 'חזרה שבועית'}>
          <div className="ip-player-chips">
            {repeats.map((r) => (
              <button key={r.n} type="button" className={f.repeatWeeks === r.n ? 'is-on' : ''} aria-pressed={f.repeatWeeks === r.n} onClick={() => setF({ ...f, repeatWeeks: r.n })}>
                {r.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="כותרת">
          <input className="ip-input" value={f.title} maxLength={60} placeholder={def.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="מקום">
          <input className="ip-input" value={f.location} maxLength={80} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="למשל: מגרש סינטטי 2" />
        </Field>
        <Field label="הערה">
          <input className="ip-input" value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="לא חובה, למשל: להביא כפפות" />
        </Field>
        {picking && !valid && players.length > 0 && !staff && <p className="ip-muted">צריך לבחור גם ילד שלכם.</p>}
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy || !valid}>
          {busy ? 'שומרים…' : f.repeatWeeks > 1 ? `הוספת ${f.repeatWeeks} אימונים` : 'הוספת האימון'}
        </Button>
      </form>
    </BottomSheet>
  );
}
