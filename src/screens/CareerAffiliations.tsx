/**
 * Career page: positions (primary + secondary, from a fixed list) and the
 * child's affiliation history: every team they were ever in (league and
 * academy in parallel), plus frameworks outside iPlays a parent records.
 * A parent can mark that the child left a team; history is never deleted
 * and nothing changes at the IFA.
 */
import '../theme/career.css';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/shell';
import { Button, Card, SectionHeader, Segmented, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { friendlyError } from '../lib/api';
import {
  dayLabel,
  externalKindLabel,
  footLabel,
  getProfileExtra,
  NO_POSITION,
  parentEndAffiliation,
  positionsBySport,
  removeExternalAffiliation,
  saveExternalAffiliation,
  setPlayerProfile,
  type Career,
  type ExternalKind,
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

/* ------------------------------------------------------------- affiliations */

const programLabel = (t: TeamAffiliation) => (t.program === 'academy' ? 'אקדמיה' : t.program === 'league' ? 'ליגה' : null);

export function AffiliationsSection({ career, extra, onChanged }: { career: Career; extra: ProfileExtra; onChanged: () => Promise<void> }) {
  const [leaving, setLeaving] = useState<TeamAffiliation | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = extra.teams.filter((t) => !t.ended_on);
  const past = extra.teams.filter((t) => t.ended_on);
  const ext = extra.external;
  if (!extra.teams.length && !ext.length && !extra.can_edit) return null;

  async function removeExt(id: string) {
    if (!window.confirm('להסיר את המסגרת מההיסטוריה?')) return;
    try {
      await removeExternalAffiliation(id);
      await onChanged();
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  return (
    <section>
      <SectionHeader title="מסגרות והיסטוריה" icon="team" />
      <Card padded={false}>
        <ul className="ip-affil-list">
          {active.map((t) => (
            <li key={`a-${t.team_id}-${t.started_on}`}>
              <span className="ip-list-row-text">
                <span className="ip-list-row-title">
                  {t.team_name}
                  {t.is_primary && active.length > 1 && <Tag tone="lime">ראשית</Tag>}
                </span>
                <span className="ip-list-row-sub">
                  {[t.club, programLabel(t), `מ-${dayLabel(t.started_on)}`].filter(Boolean).join(' · ')}
                </span>
              </span>
              {extra.is_parent && (
                <Button variant="secondary" size="sm" onClick={() => setLeaving(t)}>
                  עזב
                </Button>
              )}
            </li>
          ))}
          {ext
            .filter((x) => !x.ended_on)
            .map((x) => (
              <li key={x.id}>
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">{x.name}</span>
                  <span className="ip-list-row-sub">
                    {[externalKindLabel[x.kind], 'מחוץ ל-iPlays', x.started_on && `מ-${dayLabel(x.started_on)}`].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {extra.can_edit && (
                  <button type="button" className="ip-icon-btn" aria-label={`הסרת ${x.name}`} onClick={() => removeExt(x.id)}>
                    <Icon name="close" size={18} />
                  </button>
                )}
              </li>
            ))}
          {[...past.map((t) => ({ key: `p-${t.team_id}-${t.started_on}`, title: t.team_name, sub: [t.club, programLabel(t), `${dayLabel(t.started_on)}–${dayLabel(t.ended_on!)}`, t.end_reason].filter(Boolean).join(' · '), end: t.ended_on!, ext: null as string | null })),
            ...ext.filter((x) => x.ended_on).map((x) => ({ key: x.id, title: x.name, sub: [externalKindLabel[x.kind], x.started_on && `${dayLabel(x.started_on)}–${dayLabel(x.ended_on!)}`].filter(Boolean).join(' · '), end: x.ended_on!, ext: x.id }))]
            .sort((a, b) => b.end.localeCompare(a.end))
            .map((r) => (
              <li key={r.key} className="is-past">
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">{r.title}</span>
                  <span className="ip-list-row-sub">{r.sub}</span>
                </span>
                {r.ext && extra.can_edit && (
                  <button type="button" className="ip-icon-btn" aria-label={`הסרת ${r.title}`} onClick={() => removeExt(r.ext!)}>
                    <Icon name="close" size={18} />
                  </button>
                )}
              </li>
            ))}
          {!extra.teams.length && !ext.length && <li className="ip-muted">עוד אין מסגרות.</li>}
        </ul>
        <div className="ip-pad">
          <Err error={error} />
          {extra.can_edit && (
            <div className="ip-btn-row">
              <Button variant="secondary" size="sm" icon="plus" onClick={() => setAdding(true)}>
                מסגרת מחוץ ל-iPlays
              </Button>
              {extra.is_parent && (
                <Button variant="secondary" size="sm" icon="eye" onClick={() => (window.location.hash = 'find')}>
                  הצטרפות לקבוצה נוספת
                </Button>
              )}
            </div>
          )}
          <p className="ip-footnote">ההיסטוריה נשמרת גם אחרי מעבר. עדכון כאן לא משנה את הרישום בהתאחדות.</p>
        </div>
      </Card>
      {extra.is_parent && <LeaveSheet team={leaving} career={career} onClose={() => setLeaving(null)} onSaved={onChanged} />}
      {extra.can_edit && <ExternalSheet open={adding} career={career} onClose={() => setAdding(false)} onSaved={onChanged} />}
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

function ExternalSheet({ open, career, onClose, onSaved }: { open: boolean; career: Career; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ExternalKind>('academy');
  const [started, setStarted] = useState('');
  const [ended, setEnded] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName('');
      setKind('academy');
      setStarted('');
      setEnded('');
      setError(null);
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('כתבו את שם המסגרת.');
      return;
    }
    if (started && ended && ended < started) {
      setError('תאריך הסיום לפני תאריך ההתחלה.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveExternalAffiliation({ playerId: career.player.id, name: name.trim(), kind, started: started || null, ended: ended || null });
      await onSaved();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="מסגרת מחוץ ל-iPlays">
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="שם המסגרת">
          <input className="ip-input" value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} placeholder="לדוגמה: אקדמיית כדורגל פרטית" required />
        </Field>
        <Field label="סוג">
          <select className="ip-input" value={kind} onChange={(e) => setKind(e.target.value as ExternalKind)}>
            {(Object.keys(externalKindLabel) as ExternalKind[]).map((k) => (
              <option key={k} value={k}>
                {externalKindLabel[k]}
              </option>
            ))}
          </select>
        </Field>
        <div className="ip-field-row ip-field-row--wrap">
          <Field label="מתאריך (לא חובה)">
            <input className="ip-input" type="date" dir="ltr" value={started} onChange={(e) => setStarted(e.target.value)} />
          </Field>
          <Field label="עד (ריק = עדיין שם)">
            <input className="ip-input" type="date" dir="ltr" value={ended} onChange={(e) => setEnded(e.target.value)} />
          </Field>
        </div>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}
