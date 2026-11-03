/**
 * Staff view of an IFA league game: change a field by hand (the coach's value
 * wins over the IFA), see which fields were changed, go back to the IFA value,
 * and resolve a conflict when the IFA later shows something else.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { Field } from '../components/form';
import { friendlyError } from '../lib/api';
import {
  getMatchOverrides,
  myMatchConflicts,
  OVERRIDE_FIELD_LABEL,
  overrideValueLabel,
  releaseMatchOverride,
  resolveMatchConflict,
  setMatchOverride,
  type Match,
  type MatchConflict,
  type MatchOverride,
} from '../lib/matchApi';

const CONFLICT_TEXT = 'שים לב, נמצאה סתירה בין הנתונים שהגדרת לבין נתוני ההתאחדות לכדורגל.';

/** "2026-12-12T10:00" in Israel time, for <input type="datetime-local">. */
function localInput(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

/** Inverse of localInput: the device clock is assumed to be Israel time, as the app's audience is. */
function fromLocalInput(v: string): string {
  return new Date(v).toISOString();
}

export function IfaMatchOverrides({
  match,
  onChanged,
  limited = false,
}: {
  match: Match;
  onChanged: () => Promise<void>;
  /** parents: time and venue only (the score stays with the staff) */
  limited?: boolean;
}) {
  const [overrides, setOverrides] = useState<MatchOverride[]>([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    when: localInput(match.starts_at),
    venue: match.venue,
    f: match.score_for?.toString() ?? '',
    a: match.score_against?.toString() ?? '',
  });

  const load = useCallback(async () => setOverrides(await getMatchOverrides(match.id)), [match.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      await onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      if (form.when && form.when !== localInput(match.starts_at)) {
        await setMatchOverride(match.id, 'starts_at', { starts_at: fromLocalInput(form.when) });
      }
      if (form.venue.trim() !== match.venue) {
        await setMatchOverride(match.id, 'venue', form.venue.trim());
      }
      if (limited) {
        setEditing(false);
        return;
      }
      const f = form.f === '' ? null : Number(form.f);
      const a = form.a === '' ? null : Number(form.a);
      if ((f == null) !== (a == null)) throw new Error('יש למלא את שתי התוצאות, או להשאיר את שתיהן ריקות.');
      if (f !== match.score_for || a !== match.score_against) {
        await setMatchOverride(match.id, 'score', [f, a]);
        if (f != null && match.status !== 'played') await setMatchOverride(match.id, 'status', 'played');
      }
      setEditing(false);
    });
  }

  const mine = (o: MatchOverride) => !limited || o.field === 'starts_at' || o.field === 'venue';
  const conflicts = overrides.filter((o) => o.conflict_ifa_value != null && mine(o));
  const quiet = overrides.filter((o) => o.conflict_ifa_value == null && mine(o));

  return (
    <div className="ip-stack ip-stack--tight">
      {conflicts.map((o) => (
        <div key={o.field} className="ip-card ip-card--padded ip-conflict" role="alert">
          <p>
            <Icon name="bell" size={16} /> {CONFLICT_TEXT}
          </p>
          <p className="ip-muted">{OVERRIDE_FIELD_LABEL[o.field]}</p>
          <div className="ip-conflict-versions">
            <span>
              <small className="ip-muted">ההגדרה שלך</small>
              <strong>{overrideValueLabel(o.field, o.value)}</strong>
            </span>
            <span>
              <small className="ip-muted">ההתאחדות</small>
              <strong>{overrideValueLabel(o.field, o.conflict_ifa_value)}</strong>
            </span>
          </div>
          <div className="ip-btn-row">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void run(() => resolveMatchConflict(match.id, o.field, true))}>
              השאר את ההגדרה שלי
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => resolveMatchConflict(match.id, o.field, false))}>
              עדכן לפי ההתאחדות
            </Button>
          </div>
        </div>
      ))}

      {quiet.length > 0 && (
        <ul className="ip-override-list">
          {quiet.map((o) => (
            <li key={o.field}>
              <span>
                {OVERRIDE_FIELD_LABEL[o.field]} שונה ידנית · בהתאחדות: {overrideValueLabel(o.field, o.ifa_value)}
              </span>
              <Button variant="ghost" size="sm" icon="undo" disabled={busy} onClick={() => void run(() => releaseMatchOverride(match.id, o.field))}>
                חזרה להתאחדות
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!editing ? (
        <>
          <p className="ip-muted">
            {limited
              ? 'משחק ליגה של ההתאחדות. אפשר לעדכן מועד ומגרש; השינוי נשלח כהתראה לכל הקבוצה.'
              : 'מועד, מגרש ותוצאה מתעדכנים מאתר ההתאחדות. שינוי שתעשה כאן גובר על ההתאחדות בשדה ששינית בלבד.'}
          </p>
          <div className="ip-btn-row">
            <Button variant="secondary" size="sm" icon={limited ? 'calendar' : 'whistle'} onClick={() => setEditing(true)}>
              {limited ? 'עדכון מועד או מגרש' : 'שינוי ידני'}
            </Button>
          </div>
        </>
      ) : (
        <form className="ip-stack ip-stack--tight" onSubmit={(e) => void save(e)}>
          <Field label="מועד">
            <input className="ip-input" type="datetime-local" dir="ltr" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} />
          </Field>
          <Field label="מגרש">
            <input className="ip-input" maxLength={80} value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
          </Field>
          {!limited && (
          <div className="ip-match-score-form">
            <Field label="אנחנו">
              <input className="ip-input" inputMode="numeric" dir="ltr" value={form.f} onChange={(e) => setForm({ ...form, f: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
            </Field>
            <Field label={match.opponent}>
              <input className="ip-input" inputMode="numeric" dir="ltr" value={form.a} onChange={(e) => setForm({ ...form, a: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
            </Field>
          </div>
          )}
          <div className="ip-btn-row">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              שמירה
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>
              ביטול
            </Button>
          </div>
        </form>
      )}
      {error && <p className="ip-error" role="alert">{error}</p>}
    </div>
  );
}

/** Home screen: IFA conflicts waiting in teams I manage. */
export function MatchConflictsHomeCard() {
  const [rows, setRows] = useState<MatchConflict[]>([]);
  useEffect(() => {
    void myMatchConflicts().then(setRows);
  }, []);
  if (!rows.length) return null;
  const first = rows[0];
  return (
    <button
      type="button"
      className="ip-card ip-card--padded ip-coach-entry"
      onClick={() => (window.location.hash = `matches/${first.team_id}/${first.match_id}`)}
    >
      <span className="ip-icon-tile ip-icon-tile--live">
        <Icon name="ball" size={20} />
      </span>
      <span className="ip-list-row-text">
        <span className="ip-list-row-title">סתירה מול נתוני ההתאחדות · {rows.length}</span>
        <span className="ip-list-row-sub">
          {first.team_name} נגד {first.opponent} · {OVERRIDE_FIELD_LABEL[first.field]}
        </span>
      </span>
      <Icon name="chevron" size={18} className="ip-muted" />
    </button>
  );
}
