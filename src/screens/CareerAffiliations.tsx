/**
 * Career page: positions (primary + secondary, from a fixed list) and a
 * small "left the team" action. Affiliation history stays in the DB but is
 * no longer shown. Nothing changes at the IFA.
 */
import '../theme/career.css';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/shell';
import { Button, Card, SectionHeader, Segmented, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { friendlyError } from '../lib/api';
import {
  footLabel,
  getProfileExtra,
  NO_POSITION,
  parentEndAffiliation,
  positionsBySport,
  setPlayerProfile,
  type Career,
  type ProfileExtra,
  type StrongFoot,
  type TeamAffiliation,
} from '../lib/careerApi';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

/** Loads the extra profile data once per player and hands it to both sections. */
export function useProfileExtra(playerId: string) {
  const [extra, setExtra] = useState<ProfileExtra | null | undefined>(undefined);
  const load = useCallback(
    () =>
      getProfileExtra(playerId)
        .then(setExtra)
        .catch(() => setExtra(null)), // migration not run yet: the sections stay hidden
    [playerId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return { extra, reload: load };
}

/* ---------------------------------------------------------------- positions */

export function PositionsSection({ career, extra, onChanged }: { career: Career; extra: ProfileExtra; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const p = career.player;
  const sport = career.sport ?? p.sport ?? 'football';
  const showFoot = sport === 'football';
  const editable = extra.can_edit;
  return (
    <section>
      <SectionHeader title="עמדות ופרטי שחקן" icon="user" action={editable ? 'עריכה' : undefined} onAction={() => setOpen(true)} />
      <Card>
        <div className="ip-profile-facts">
          <div>
            <span>עמדה ראשית</span>
            <strong>{extra.position || NO_POSITION}</strong>
          </div>
          {showFoot && (
            <div>
              <span>רגל חזקה</span>
              <strong>{p.strong_foot ? footLabel[p.strong_foot] : 'לא צוין'}</strong>
            </div>
          )}
        </div>
        {extra.secondary_positions.length > 0 && (
          <div className="ip-position-tags">
            <span>עמדות משניות</span>
            <div>
              {extra.secondary_positions.map((x) => (
                <Tag key={x}>{x}</Tag>
              ))}
            </div>
          </div>
        )}
      </Card>
      {editable && (
        <PositionsSheet open={open} career={career} extra={extra} sport={sport} showFoot={showFoot} onClose={() => setOpen(false)} onSaved={onChanged} />
      )}
    </section>
  );
}

function PositionsSheet({
  open,
  career,
  extra,
  sport,
  showFoot,
  onClose,
  onSaved,
}: {
  open: boolean;
  career: Career;
  extra: ProfileExtra;
  sport: string;
  showFoot: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const p = career.player;
  const options = extra.position_list ?? positionsBySport[sport] ?? [];
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState<string[]>([]);
  const [foot, setFoot] = useState<StrongFoot | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    // an old free-text position that isn't in the list starts as "not decided"
    setPrimary(options.length && !options.includes(extra.position) ? '' : extra.position);
    setSecondary(extra.secondary_positions);
    setFoot(p.strong_foot ?? '');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (x: string) => setSecondary((s) => (s.includes(x) ? s.filter((y) => y !== x) : [...s, x]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setPlayerProfile(p.id, primary, secondary.filter((x) => x !== primary), foot || null);
      await onSaved();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={`עמדות: ${p.first_name}`}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="עמדה ראשית">
          {options.length ? (
            <select className="ip-input" value={primary} onChange={(e) => setPrimary(e.target.value)}>
              <option value="">{NO_POSITION}</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input className="ip-input" value={primary} onChange={(e) => setPrimary(e.target.value.slice(0, 30))} placeholder={NO_POSITION} />
          )}
        </Field>
        {options.length > 0 && (
          <Field label="עמדות משניות (אפשר כמה)">
            <div className="ip-chip-row" role="group" aria-label="עמדות משניות">
              {options
                .filter((o) => o !== primary)
                .map((o) => (
                  <button type="button" key={o} aria-pressed={secondary.includes(o)} className={`ip-chip ${secondary.includes(o) ? 'is-on' : ''}`} onClick={() => toggle(o)}>
                    {o}
                  </button>
                ))}
            </div>
          </Field>
        )}
        {showFoot && (
          <Field label="רגל חזקה">
            <Segmented
              label="רגל חזקה"
              items={[
                { id: 'right', label: 'ימין' },
                { id: 'left', label: 'שמאל' },
                { id: 'both', label: 'שתיהן' },
              ]}
              value={foot as StrongFoot}
              onChange={(v) => setFoot(v === foot ? '' : v)}
            />
          </Field>
        )}
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}

/* ------------------------------------------------------------- leave team */

/**
 * The "frameworks and history" list was removed from the UI (it did not add
 * to the experience). The data stays in the DB; only the "left the team"
 * action is kept, as a small card, so a parent or a player who owns their
 * profile can still record a move.
 */
export function LeaveTeamSection({ career, extra, onChanged }: { career: Career; extra: ProfileExtra; onChanged: () => Promise<void> }) {
  const [leaving, setLeaving] = useState<TeamAffiliation | null>(null);
  const active = extra.teams.filter((t) => !t.ended_on);
  if (!(extra.is_owner ?? extra.is_parent) || !active.length) return null;

  return (
    <section>
      <Card>
        <div className="ip-btn-row">
          {active.map((t) => (
            <Button key={`${t.team_id}-${t.started_on}`} variant="secondary" size="sm" onClick={() => setLeaving(t)}>
              {active.length > 1 ? `עזיבת ${t.team_name}` : 'עזיבת הקבוצה'}
            </Button>
          ))}
        </div>
      </Card>
      <LeaveSheet team={leaving} career={career} onClose={() => setLeaving(null)} onSaved={onChanged} />
    </section>
  );
}

function LeaveSheet({ team, career, onClose, onSaved }: { team: TeamAffiliation | null; career: Career; onClose: () => void; onSaved: () => Promise<void> }) {
  const [moved, setMoved] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (team) {
      setMoved('');
      setDate(today());
      setError(null);
    }
  }, [team]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!team) return;
    setBusy(true);
    setError(null);
    try {
      await parentEndAffiliation(career.player.id, team.team_id, moved.trim(), date);
      await onSaved();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={team !== null} onClose={onClose} title={team ? `${career.player.first_name} עזב/ה את ${team.team_name}` : 'עזיבת קבוצה'}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="לאיזה מועדון עבר/ה? (לא חובה)">
          <input className="ip-input" value={moved} onChange={(e) => setMoved(e.target.value.slice(0, 80))} placeholder="לדוגמה: מכבי יפו" />
        </Field>
        <Field label="מתאריך">
          <input className="ip-input" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <p className="ip-footnote">
          ההיסטוריה של {career.player.first_name} בקבוצה נשמרת, והצוות שלה יקבל הודעה. הרישום בהתאחדות לא משתנה. אם הקבוצה החדשה נמצאת ב-iPlays, אפשר להצטרף אליה אחר כך דרך החיפוש.
        </p>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'אישור'}
        </Button>
      </form>
    </BottomSheet>
  );
}
