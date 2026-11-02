/**
 * Career page: the child's profile on the pitch (position, strong foot) and
 * medical clearance (parents + medical staff). Body measurements moved to
 * the parent-only private area (DevelopmentSection.tsx).
 * The server returns null for a part the viewer may not see, and the part
 * is then not rendered at all.
 */
import '../theme/career.css';
import { useEffect, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/shell';
import { Button, Card, SectionHeader, Segmented, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { friendlyError } from '../lib/api';
import {
  addMedicalClearance,
  daysUntil,
  dayLabel,
  footLabel,
  positionsBySport,
  removeRecord,
  setPlayerProfile,
  type Career,
  type StrongFoot,
} from '../lib/careerApi';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

/* ---------------------------------------------------------------- profile */

export function ProfileSection({ career, onChanged }: { career: Career; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const p = career.player;
  const sport = career.sport ?? p.sport ?? 'football';
  const showFoot = sport === 'football';
  const editable = career.can_edit_profile;
  if (!p.position && !p.strong_foot && !editable) return null;
  return (
    <section>
      <SectionHeader title="פרטי שחקן" icon="user" action={editable ? 'עריכה' : undefined} onAction={() => setOpen(true)} />
      <Card>
        <div className="ip-profile-facts">
          <div>
            <span>תפקיד</span>
            <strong>{p.position || 'לא צוין'}</strong>
          </div>
          {showFoot && (
            <div>
              <span>רגל חזקה</span>
              <strong>{p.strong_foot ? footLabel[p.strong_foot] : 'לא צוין'}</strong>
            </div>
          )}
        </div>
      </Card>
      {editable && <ProfileSheet open={open} career={career} showFoot={showFoot} sport={sport} onClose={() => setOpen(false)} onSaved={onChanged} />}
    </section>
  );
}

function ProfileSheet({ open, career, showFoot, sport, onClose, onSaved }: { open: boolean; career: Career; showFoot: boolean; sport: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const p = career.player;
  const [position, setPosition] = useState(p.position);
  const [foot, setFoot] = useState<StrongFoot | ''>(p.strong_foot ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPosition(p.position);
      setFoot(p.strong_foot ?? '');
      setError(null);
    }
  }, [open, p.position, p.strong_foot]);
  const options = positionsBySport[sport] ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setPlayerProfile(p.id, position.trim(), foot || null);
      await onSaved();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={`פרטי השחקן: ${p.first_name}`}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="תפקיד במגרש">
          <input className="ip-input" list="ip-positions" value={position} onChange={(e) => setPosition(e.target.value.slice(0, 30))} placeholder="בחרו או כתבו" />
          <datalist id="ip-positions">
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </Field>
        {options.length > 0 && (
          <div className="ip-chip-row">
            {options.map((o) => (
              <button type="button" key={o} className={`ip-chip ${position === o ? 'is-on' : ''}`} onClick={() => setPosition(o)}>
                {o}
              </button>
            ))}
          </div>
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

/* ---------------------------------------------------------------- medical */

export function MedicalSection({ career, onChanged }: { career: Career; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = career.medical;
  if (list === null) return null;
  const editable = career.can_edit_medical;
  const current = list[0]; // newest valid_until first
  const days = current ? daysUntil(current.valid_until) : null;
  const status =
    !current ? { tone: 'warning' as const, text: 'אין אישור רפואי' }
    : days! < 0 ? { tone: 'warning' as const, text: 'פג תוקף' }
    : days! <= 30 ? { tone: 'warning' as const, text: `יפוג בעוד ${days} ימים` }
    : { tone: 'lime' as const, text: 'בתוקף' };

  async function remove(id: string) {
    if (!window.confirm('למחוק את האישור הזה?')) return;
    try {
      await removeRecord('medical', id);
      await onChanged();
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  return (
    <section>
      <SectionHeader title="אישור רפואי" icon="shield" />
      <Card>
        <div className="ip-medical-status">
          <Tag tone={status.tone} icon={status.tone === 'lime' ? 'check' : undefined}>
            {status.text}
          </Tag>
          {current && (
            <span className="ip-muted">
              עד {dayLabel(current.valid_until)}
              {current.issuer && ` · ${current.issuer}`}
            </span>
          )}
        </div>
        {editable && list.length > 0 && (
          <ul className="ip-fitness-list ip-fitness-list--manage">
            {list.map((m) => (
              <li key={m.id}>
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">
                    {dayLabel(m.issued_on)} – {dayLabel(m.valid_until)}
                  </span>
                  <span className="ip-list-row-sub">{m.issuer || ' '}</span>
                </span>
                <button type="button" className="ip-icon-btn" aria-label="מחיקת האישור" onClick={() => remove(m.id)}>
                  <Icon name="close" size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Err error={error} />
        {editable && (
          <div className="ip-btn-row">
            <Button variant="secondary" size="sm" icon="plus" onClick={() => setOpen(true)}>
              {current ? 'אישור חדש' : 'הוספת אישור'}
            </Button>
          </div>
        )}
        <p className="ip-footnote">מידע רפואי: רק ההורים וצוות עם הרשאה רפואית רואים אותו. נשמרים רק התאריכים ומי חתם, בלי הקובץ עצמו.</p>
      </Card>
      {editable && <MedicalSheet open={open} career={career} onClose={() => setOpen(false)} onSaved={onChanged} />}
    </section>
  );
}

function addYear(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function MedicalSheet({ open, career, onClose, onSaved }: { open: boolean; career: Career; onClose: () => void; onSaved: () => Promise<void> }) {
  const [issued, setIssued] = useState(today());
  const [until, setUntil] = useState(addYear(today()));
  const [issuer, setIssuer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setIssued(today());
      setUntil(addYear(today()));
      setIssuer('');
      setError(null);
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (until < issued) {
      setError('תאריך התוקף לפני תאריך האישור.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addMedicalClearance({ playerId: career.player.id, issued, validUntil: until, issuer: issuer.trim() });
      await onSaved();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={`אישור רפואי ל${career.player.first_name}`}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="תאריך האישור">
          <input
            className="ip-input"
            type="date"
            dir="ltr"
            max={today()}
            value={issued}
            onChange={(e) => {
              setIssued(e.target.value);
              if (e.target.value) setUntil(addYear(e.target.value));
            }}
            required
          />
        </Field>
        <Field label="בתוקף עד">
          <input className="ip-input" type="date" dir="ltr" value={until} onChange={(e) => setUntil(e.target.value)} required />
        </Field>
        <Field label="רופא / מכון">
          <input className="ip-input" value={issuer} onChange={(e) => setIssuer(e.target.value.slice(0, 80))} placeholder="לא חובה" />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}
