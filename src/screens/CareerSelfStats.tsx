/**
 * Career page: goals and assists the family reports itself, game by game.
 * The child has no login, so the parent enters them on the child's behalf.
 * Shown on their own, marked as self-reported, and never added to the goals
 * reported live during a game.
 */
import '../theme/career.css';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/shell';
import { Button, Card, SectionHeader, Segmented, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { friendlyError } from '../lib/api';
import { dayLabel, getSelfStats, removeSelfStat, saveSelfStat, type SelfStat, type SelfStats } from '../lib/careerApi';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

export function SelfStatsSection({ playerId, name }: { playerId: string; name: string }) {
  const [data, setData] = useState<SelfStats | null | undefined>(undefined);
  const [editing, setEditing] = useState<SelfStat | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      getSelfStats(playerId)
        .then(setData)
        .catch(() => setData(null)), // not allowed, or migration not run yet: hidden
    [playerId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return null;
  if (!data.items.length && !data.can_edit) return null;

  async function remove(id: string) {
    if (!window.confirm('למחוק את הדיווח הזה?')) return;
    try {
      await removeSelfStat(id);
      await load();
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  const t = data.totals;
  return (
    <section>
      <SectionHeader title="שערים ובישולים (דיווח עצמי)" icon="goal" />
      <Card>
        <div className="ip-self-totals">
          <div>
            <strong>{t.goals}</strong>
            <span>שערים</span>
          </div>
          <div>
            <strong>{t.assists}</strong>
            <span>בישולים</span>
          </div>
          <div>
            <strong>{t.games}</strong>
            <span>משחקים שדווחו</span>
          </div>
        </div>
        {data.items.length > 0 && (
          <ul className="ip-fitness-list ip-fitness-list--manage">
            {data.items.map((s) => (
              <li key={s.id}>
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">
                    מול {s.opponent}
                    {s.goals > 0 && <Tag tone="lime">{s.goals === 1 ? 'שער' : `${s.goals} שערים`}</Tag>}
                    {s.assists > 0 && <Tag>{s.assists === 1 ? 'בישול' : `${s.assists} בישולים`}</Tag>}
                  </span>
                  <span className="ip-list-row-sub">
                    {[dayLabel(s.date), s.team_name ?? 'משחק מחוץ לאפליקציה', s.note].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {data.can_edit && (
                  <span className="ip-self-actions">
                    <button type="button" className="ip-link" onClick={() => setEditing(s)}>
                      עריכה
                    </button>
                    <button type="button" className="ip-icon-btn" aria-label="מחיקת הדיווח" onClick={() => remove(s.id)}>
                      <Icon name="close" size={18} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <Err error={error} />
        {data.can_edit && (
          <div className="ip-btn-row">
            <Button variant="secondary" size="sm" icon="plus" onClick={() => setEditing('new')}>
              דיווח על משחק
            </Button>
          </div>
        )}
        <p className="ip-footnote">
          {data.can_edit ? `ההורים מדווחים בשם ${name}. ` : 'דווח על ידי ההורים. '}
          המספרים האלה לא רשמיים ולא נספרים יחד עם השערים שדווחו בזמן המשחק.
        </p>
      </Card>
      {data.can_edit && (
        <SelfStatSheet
          open={editing !== null}
          editing={editing === 'new' ? null : editing}
          data={data}
          playerId={playerId}
          name={name}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </section>
  );
}

function Counter({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <Field label={label}>
      <div className="ip-counter">
        <button type="button" className="ip-icon-btn" aria-label={`פחות ${label}`} onClick={() => onChange(Math.max(0, value - 1))} disabled={value === 0}>
          −
        </button>
        <strong aria-live="polite">{value}</strong>
        <button type="button" className="ip-icon-btn" aria-label={`עוד ${label}`} onClick={() => onChange(Math.min(30, value + 1))}>
          <Icon name="plus" size={18} />
        </button>
      </div>
    </Field>
  );
}

function SelfStatSheet({
  open,
  editing,
  data,
  playerId,
  name,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: SelfStat | null;
  data: SelfStats;
  playerId: string;
  name: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const games = data.recent_games;
  const [mode, setMode] = useState<'app' | 'other'>('app');
  const [matchId, setMatchId] = useState('');
  const [date, setDate] = useState(today());
  const [opponent, setOpponent] = useState('');
  const [goals, setGoals] = useState(0);
  const [assists, setAssists] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      setMode(editing.match_id ? 'app' : 'other');
      setMatchId(editing.match_id ?? '');
      setDate(editing.date);
      setOpponent(editing.opponent);
      setGoals(editing.goals);
      setAssists(editing.assists);
      setNote(editing.note ?? '');
    } else {
      const first = games.find((g) => !g.reported);
      setMode(games.length ? 'app' : 'other');
      setMatchId(first?.id ?? games[0]?.id ?? '');
      setDate(today());
      setOpponent('');
      setGoals(0);
      setAssists(0);
      setNote('');
    }
  }, [open, editing, games]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'app' && !matchId) {
      setError('בחרו משחק.');
      return;
    }
    if (mode === 'other' && !opponent.trim()) {
      setError('כתבו נגד מי שיחקו.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveSelfStat({
        playerId,
        id: editing?.id ?? null,
        matchId: mode === 'app' ? matchId : null,
        date: mode === 'app' ? null : date,
        opponent: mode === 'app' ? '' : opponent.trim(),
        goals,
        assists,
        note: note.trim(),
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={`שערים ובישולים של ${name}`}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        {games.length > 0 && (
          <Segmented
            label="איזה משחק"
            items={[
              { id: 'app', label: 'משחק של הקבוצה' },
              { id: 'other', label: 'משחק אחר' },
            ]}
            value={mode}
            onChange={setMode}
          />
        )}
        {mode === 'app' ? (
          <Field label="המשחק">
            <select className="ip-input" value={matchId} onChange={(e) => setMatchId(e.target.value)} required>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {dayLabel(g.date)} · מול {g.opponent}
                  {g.reported && g.id !== editing?.match_id ? ' (כבר דווח, יעודכן)' : ''}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div className="ip-field-row ip-field-row--wrap">
            <Field label="תאריך">
              <input className="ip-input" type="date" dir="ltr" max={today()} value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="נגד">
              <input className="ip-input" value={opponent} onChange={(e) => setOpponent(e.target.value.slice(0, 80))} placeholder="שם הקבוצה היריבה" required />
            </Field>
          </div>
        )}
        <div className="ip-field-row">
          <Counter label="שערים" value={goals} onChange={setGoals} />
          <Counter label="בישולים" value={assists} onChange={setAssists} />
        </div>
        <Field label="הערה (לא חובה)">
          <input className="ip-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="לדוגמה: שער מבעיטה חופשית" />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}
