/**
 * Team contacts directory ("אלפון הקבוצה" tab of the team page) and the
 * "אנשי קשר" area of a player's profile (career page).
 *
 * Parents fill in their own details once (they are used for all their
 * children) and choose, one switch per detail, what other parents of the
 * team may see. Everything starts hidden. The child's phone is shared only
 * when a parent of the child switches it on. Managers see everything; the
 * server leaves out (null) whatever this viewer may not see.
 * Server: supabase/migrations/20261103500000_team_contacts.sql
 */
import '../theme/contacts.css';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { InitialsAvatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/shell';
import { Button, Card, EmptyState, SectionHeader, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { useAuth } from '../auth/AuthContext';
import { friendlyError } from '../lib/api';
import {
  SHARE_LABELS,
  addressText,
  contactsError,
  emailOk,
  mailHref,
  mapsHref,
  myContactCard,
  personRole,
  phoneOk,
  playerContactBook,
  removeExtraContact,
  saveExtraContact,
  saveMyContactCard,
  savePlayerPhone,
  searchKey,
  setMyShare,
  setPlayerPhoneShare,
  teamDirectory,
  telHref,
  waHref,
  wazeHref,
  type ContactBook,
  type ContactPerson,
  type DirectoryPlayer,
  type ExtraInput,
  type MyCard,
  type ShareField,
  type TeamDirectory,
} from '../lib/contactsApi';

const errText = (e: unknown) => contactsError(e) ?? friendlyError(e);
const fullName = (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`.trim();

/* ================================================================ actions */

/** Quick buttons for the details this viewer may see. Nothing is sent from iplays. */
function ContactActions({ person, withAddress = true, name }: { person: Pick<ContactPerson, 'phone' | 'whatsapp' | 'email' | 'address'>; withAddress?: boolean; name: string }) {
  const { phone, whatsapp, email, address } = person;
  if (!phone && !whatsapp && !email && !(withAddress && address)) return null;
  return (
    <span className="ip-ct-actions">
      {phone && (
        <a className="ip-ct-action" href={telHref(phone)} aria-label={`חיוג אל ${name}`} title="חיוג">
          <Icon name="phone" size={20} />
        </a>
      )}
      {whatsapp && (
        <a className="ip-ct-action ip-ct-action--wa" href={waHref(whatsapp)} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp אל ${name}`} title="WhatsApp">
          <Icon name="whatsapp" size={20} />
        </a>
      )}
      {email && (
        <a className="ip-ct-action" href={mailHref(email)} aria-label={`מייל אל ${name}`} title="מייל">
          <Icon name="mail" size={20} />
        </a>
      )}
      {withAddress && address && (
        <a className="ip-ct-action" href={wazeHref(address)} target="_blank" rel="noopener noreferrer" aria-label={`ניווט ב־Waze אל ${name}`} title="ניווט">
          <Icon name="navigate" size={20} />
        </a>
      )}
    </span>
  );
}

/** One person with every detail this viewer may see, and the quick buttons. */
function PersonBlock({ person, label, onEditMe }: { person: ContactPerson; label?: string; onEditMe?: () => void }) {
  const nothing = !person.phone && !person.whatsapp && !person.email && !person.address;
  const editMe = person.is_me && onEditMe;
  return (
    <div className="ip-ct-person">
      <div className="ip-ct-person-head">
        <InitialsAvatar name={person.name} size={40} tone={person.kind === 'extra' ? 'lime' : 'blue'} />
        <span className="ip-list-row-text">
          <span className="ip-list-row-title">
            {person.name} {person.is_me && <Tag tone="lime">אני</Tag>}
          </span>
          <span className="ip-list-row-sub">{label ?? personRole(person)}</span>
        </span>
        {editMe && <EditMeButton onClick={onEditMe} />}
      </div>
      {person.is_me && !person.phone ? (
        <p className="ip-ct-hidden">
          <Icon name="phone" size={16} /> עוד לא הזנת טלפון.{' '}
          {editMe && (
            <button type="button" className="ip-link" onClick={onEditMe}>
              להוספה
            </button>
          )}
        </p>
      ) : null}
      {nothing ? (
        !person.is_me && (
          <p className="ip-ct-hidden">
            <Icon name="lock" size={16} /> לא שותפו פרטי קשר
          </p>
        )
      ) : (
        <dl className="ip-ct-details">
          {person.phone && (
            <div>
              <dt>טלפון</dt>
              <dd>
                <a href={telHref(person.phone)} dir="ltr">
                  {person.phone}
                </a>
              </dd>
            </div>
          )}
          {person.whatsapp && (
            <div>
              <dt>WhatsApp</dt>
              <dd>
                <a href={waHref(person.whatsapp)} target="_blank" rel="noopener noreferrer" dir="ltr">
                  {person.whatsapp}
                </a>
              </dd>
            </div>
          )}
          {person.email && (
            <div>
              <dt>דוא״ל</dt>
              <dd>
                <a href={mailHref(person.email)} dir="ltr">
                  {person.email}
                </a>
              </dd>
            </div>
          )}
          {person.address && (
            <div>
              <dt>כתובת</dt>
              <dd>
                {addressText(person.address)}
                <span className="ip-ct-nav">
                  <a className="ip-chip" href={wazeHref(person.address)} target="_blank" rel="noopener noreferrer">
                    Waze
                  </a>
                  <a className="ip-chip" href={mapsHref(person.address)} target="_blank" rel="noopener noreferrer">
                    Google Maps
                  </a>
                </span>
              </dd>
            </div>
          )}
        </dl>
      )}
      <ContactActions person={person} name={person.name} withAddress={false} />
    </div>
  );
}

/** Pencil next to the signed-in user's own entry: edit phone, e-mail, address and sharing (same data as #me). */
function EditMeButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="ip-ct-action ip-ct-edit" onClick={onClick} aria-label="עריכת הפרטים שלי" title="עריכת הפרטים שלי">
      <Icon name="edit" size={18} />
    </button>
  );
}

function parentLabels(contacts: ContactPerson[]): Map<ContactPerson, string> {
  const labels = new Map<ContactPerson, string>();
  let n = 0;
  for (const c of contacts) {
    if (c.kind !== 'parent') continue;
    n += 1;
    labels.set(c, c.kinship ? `${c.kinship} · הורה ${n}` : `הורה ${n}`);
  }
  return labels;
}

/* ================================================================ my card */

/** The signed-in parent's own details + the four sharing switches (saved at once). */
export function MyCardEditor({ onSaved }: { onSaved?: () => void }) {
  const { refresh } = useAuth();
  const [card, setCard] = useState<MyCard | null | undefined>(undefined);
  const [form, setForm] = useState<MyCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [switching, setSwitching] = useState<ShareField | null>(null);

  useEffect(() => {
    myContactCard()
      .then((c) => {
        setCard(c);
        setForm(c);
      })
      .catch((e) => {
        setCard(null);
        setError(errText(e));
      });
  }, []);

  if (card === undefined) return <p className="ip-muted">טוען…</p>;
  if (!card || !form) return <Err error={error ?? 'לא הצלחנו לטעון את הפרטים שלך.'} />;

  const set = (k: keyof MyCard) => (e: { target: { value: string } }) => {
    setSaved(false);
    setForm({ ...form, [k]: e.target.value });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!phoneOk(form.phone) || !phoneOk(form.whatsapp_phone)) return setError('מספר הטלפון לא תקין. ספרות בלבד, אפשר עם + בהתחלה.');
    if (!emailOk(form.contact_email)) return setError('כתובת הדוא״ל לא תקינה.');
    setBusy(true);
    setError(null);
    try {
      await saveMyContactCard(form);
      setCard(form);
      setSaved(true);
      void refresh();
      onSaved?.();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  // each switch is saved the moment it changes
  async function toggle(field: ShareField, on: boolean) {
    if (!card || !form) return;
    const before = form.sharing;
    const next = { ...before, [field]: on };
    setForm({ ...form, sharing: next });
    setSwitching(field);
    setError(null);
    try {
      await setMyShare(field, on);
      setCard({ ...card, sharing: next });
      onSaved?.();
    } catch (err) {
      setForm((f) => (f ? { ...f, sharing: before } : f));
      setError(errText(err));
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div className="ip-ct-editor">
      <form className="ip-form" onSubmit={submit}>
        <Field label="שם מלא">
          <input className="ip-input" value={form.full_name} onChange={set('full_name')} maxLength={80} autoComplete="name" />
        </Field>
        <Field label="טלפון">
          <input className="ip-input" type="tel" dir="ltr" inputMode="tel" value={form.phone} onChange={set('phone')} maxLength={20} placeholder="050-0000000" autoComplete="tel" />
        </Field>
        <Field label="WhatsApp (אם שונה מהטלפון)">
          <input className="ip-input" type="tel" dir="ltr" inputMode="tel" value={form.whatsapp_phone} onChange={set('whatsapp_phone')} maxLength={20} placeholder={form.phone || '050-0000000'} />
        </Field>
        <Field label="דוא״ל ליצירת קשר">
          <input className="ip-input" type="email" dir="ltr" value={form.contact_email} onChange={set('contact_email')} maxLength={120} placeholder={form.login_email} autoComplete="email" />
        </Field>
        <div className="ip-ct-address-row">
          <Field label="רחוב">
            <input className="ip-input" value={form.street} onChange={set('street')} maxLength={80} autoComplete="address-line1" />
          </Field>
          <Field label="מספר">
            <input className="ip-input" value={form.house_number} onChange={set('house_number')} maxLength={10} inputMode="numeric" />
          </Field>
        </div>
        <Field label="עיר">
          <input className="ip-input" value={form.city} onChange={set('city')} maxLength={40} autoComplete="address-level2" />
        </Field>
        <div className="ip-btn-row">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'שומר…' : 'שמירת הפרטים'}
          </Button>
          {saved && (
            <span className="ip-ct-saved" role="status">
              <Icon name="check" size={18} /> נשמר
            </span>
          )}
        </div>
      </form>

      <div className="ip-ct-share">
        <strong>מה הורים אחרים בקבוצה רואים?</strong>
        <p className="ip-muted">כל פרט מוסתר עד שמפעילים אותו. השינוי נשמר מיד. צוות הקבוצה ומנהלי המועדון רואים תמיד את כל הפרטים.</p>
        {SHARE_LABELS.map((s) => (
          <label key={s.key} className="ip-check ip-ct-switch">
            <input type="checkbox" role="switch" checked={!!form.sharing[s.key]} disabled={switching === s.key} onChange={(e) => void toggle(s.key, e.target.checked)} />
            <span>
              {s.label} <span className="ip-muted">· {form.sharing[s.key] ? 'גלוי להורים' : 'מוסתר'}</span>
            </span>
          </label>
        ))}
      </div>
      <Err error={error} />
    </div>
  );
}

/* ================================================================ team tab */

export function TeamDirectorySection({ teamId }: { teamId: string }) {
  const [dir, setDir] = useState<TeamDirectory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<DirectoryPlayer | null>(null);
  const [mine, setMine] = useState(false);

  const load = useCallback(
    () =>
      teamDirectory(teamId)
        .then((d) => {
          setDir(d);
          setError(null);
        })
        .catch((e) => setError(errText(e))),
    [teamId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const list = useMemo(() => {
    const q = searchKey(query);
    const players = dir?.players ?? [];
    if (!q) return players;
    return players.filter((p) => searchKey([fullName(p), ...p.contacts.map((c) => c.name)].join(' ')).includes(q));
  }, [dir, query]);

  // a parent with several children in the team: "גם ההורה של ..."
  const kidsOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of dir?.players ?? []) for (const c of p.contacts) if (c.user_id) m.set(c.user_id, [...(m.get(c.user_id) ?? []), p.first_name]);
    return m;
  }, [dir]);

  const meShared = useMemo(() => {
    const me = dir?.players.flatMap((p) => p.contacts).find((c) => c.is_me);
    return me ? Object.values(me.sharing ?? {}).some(Boolean) : null;
  }, [dir]);

  if (error) {
    return (
      <Card>
        <Err error={error.includes('הרשאה') ? 'האלפון פתוח רק להורים ולצוות של הקבוצה.' : error} />
      </Card>
    );
  }
  if (!dir) return <p className="ip-muted">טוען…</p>;

  return (
    <div className="ip-stack ip-ct">
      <Card className="ip-ct-intro">
        <div className="ip-ct-intro-row">
          <Icon name="shield" size={22} />
          <p>
            {dir.full_access
              ? 'כמנהל/ת את רואה את כל פרטי הקשר של המשפחות בקבוצה, גם אלה שלא שותפו עם הורים אחרים.'
              : 'כאן מופיעים רק פרטים שכל משפחה בחרה לשתף עם הורי הקבוצה.'}
          </p>
        </div>
        {meShared !== null && (
          <div className="ip-ct-intro-row">
            <Icon name="user" size={22} />
            <p>{meShared ? 'חלק מהפרטים שלך גלויים להורים בקבוצה.' : 'הפרטים שלך מוסתרים מהורים אחרים.'}</p>
            <Button variant="secondary" size="sm" icon="edit" onClick={() => setMine(true)}>
              הפרטים שלי
            </Button>
          </div>
        )}
      </Card>

      <label className="ip-ct-search">
        <Icon name="search" size={20} />
        <input className="ip-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש לפי שם שחקן או הורה" aria-label="חיפוש באלפון" />
      </label>

      {!dir.players.length ? (
        <Card>
          <EmptyState icon="team" title="האלפון עוד ריק" text="כשהורים יצטרפו לקבוצה ויקשרו את הילדים שלהם, הם יופיעו כאן." />
        </Card>
      ) : !list.length ? (
        <p className="ip-muted">לא נמצאו שחקנים או הורים בשם הזה.</p>
      ) : (
        <Card padded={false}>
          <ul className="ip-ct-list">
            {list.map((p) => {
              const parents = p.contacts.filter((c) => c.kind !== 'extra');
              const first = parents.find((c) => c.phone || c.whatsapp || c.email) ?? null;
              return (
                <li key={p.player_id} className="ip-ct-row">
                  <button type="button" className="ip-ct-row-main" onClick={() => setOpen(p)}>
                    <InitialsAvatar name={fullName(p)} size={44} tone={p.mine ? 'lime' : 'navy'} />
                    <span className="ip-list-row-text">
                      <span className="ip-list-row-title">
                        {fullName(p)}
                        {p.shirt_number != null && <span className="ip-muted"> · #{p.shirt_number}</span>}
                      </span>
                      <span className="ip-list-row-sub">{parents.map((c) => c.name).join(', ') || 'ללא הורים רשומים'}</span>
                    </span>
                  </button>
                  {first && <ContactActions person={first} name={first.name} withAddress={false} />}
                  {p.contacts.some((c) => c.is_me) && <EditMeButton onClick={() => setMine(true)} />}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {dir.without_family > 0 && (
        <p className="ip-muted ip-ct-foot">
          {dir.without_family === 1 ? 'שחקן אחד בסגל עוד בלי משפחה רשומה באפליקציה.' : `${dir.without_family} שחקנים בסגל עוד בלי משפחה רשומה באפליקציה.`}
        </p>
      )}

      <BottomSheet open={!!open} onClose={() => setOpen(null)} title={open ? fullName(open) : ''}>
        {open && (
          <PlayerContactCard
            player={open}
            kidsOf={kidsOf}
            onEditMe={() => {
              setOpen(null);
              setMine(true);
            }}
          />
        )}
      </BottomSheet>
      <BottomSheet open={mine} onClose={() => setMine(false)} title="הפרטים שלי באלפון">
        {mine && <MyCardEditor onSaved={() => void load()} />}
      </BottomSheet>
    </div>
  );
}

function PlayerContactCard({ player, kidsOf, onEditMe }: { player: DirectoryPlayer; kidsOf: Map<string, string[]>; onEditMe: () => void }) {
  const labels = parentLabels(player.contacts);
  return (
    <div className="ip-ct-card">
      {player.phone && (
        <PersonBlock
          person={{ kind: 'extra', user_id: null, id: null, name: player.first_name, kinship: '', is_me: false, phone: player.phone, whatsapp: player.phone, email: null, address: null, sharing: null }}
          label="הטלפון של השחקן"
        />
      )}
      {player.contacts.map((c, i) => {
        const siblings = c.user_id ? (kidsOf.get(c.user_id) ?? []).filter((n) => n !== player.first_name) : [];
        const base = labels.get(c) ?? personRole(c);
        return <PersonBlock key={c.user_id ?? c.id ?? i} person={c} label={siblings.length ? `${base} · גם של ${siblings.join(', ')}` : base} onEditMe={onEditMe} />;
      })}
      {!player.contacts.length && !player.phone && <p className="ip-muted">אין עדיין אנשי קשר לשחקן הזה.</p>}
    </div>
  );
}

/* ================================================================ player profile */

/** "אנשי קשר" on the player's profile: the child's family edits, managers view. */
export function PlayerContactsSection({ playerId, name }: { playerId: string; name: string }) {
  const [book, setBook] = useState<ContactBook | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [extra, setExtra] = useState<ExtraInput | null>(null);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      playerContactBook(playerId)
        .then((b) => {
          setBook(b);
          setPhone(b?.phone ?? '');
          setError(null);
        })
        .catch((e) => {
          // the migration not run yet: the area is simply not shown
          setBook(null);
          if (!contactsError(e)?.includes('מסד הנתונים')) setError(errText(e));
        }),
    [playerId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (book === undefined) return null;
  if (!book) return error ? <Err error={error} /> : null;

  const labels = parentLabels(book.contacts);
  const me = book.contacts.find((c) => c.is_me);
  const others = book.contacts.filter((c) => !c.is_me && c.kind !== 'extra');
  const extras = book.contacts.filter((c) => c.kind === 'extra');

  async function savePhone(e: FormEvent) {
    e.preventDefault();
    if (!phoneOk(phone)) return setError('מספר הטלפון לא תקין. ספרות בלבד, אפשר עם + בהתחלה.');
    setBusy(true);
    setError(null);
    try {
      await savePlayerPhone(playerId, phone.trim());
      await load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function sharePhone(on: boolean) {
    setBook((b) => (b ? { ...b, share_phone: on } : b));
    try {
      await setPlayerPhoneShare(playerId, on);
    } catch (err) {
      setBook((b) => (b ? { ...b, share_phone: !on } : b));
      setError(errText(err));
    }
  }

  return (
    <section className="ip-ct">
      <SectionHeader title="אנשי קשר" icon="phone" />
      <Card className="ip-ct-card">
        {book.full_access && !book.mine && (
          <p className="ip-ct-note">
            <Icon name="shield" size={18} /> צפייה כמנהל/ת: כל הפרטים מוצגים. רק ההורים יכולים לערוך.
          </p>
        )}

        {/* the child's own phone */}
        {book.can_edit ? (
          <form className="ip-ct-kidphone" onSubmit={savePhone}>
            <Field label={`הטלפון של ${name} (אם יש)`}>
              <input className="ip-input" type="tel" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="050-0000000" />
            </Field>
            <Button type="submit" variant="secondary" size="sm" disabled={busy || phone.trim() === book.phone}>
              {busy ? 'שומר…' : 'שמירה'}
            </Button>
            <label className="ip-check ip-ct-switch">
              <input type="checkbox" role="switch" checked={!!book.share_phone} onChange={(e) => void sharePhone(e.target.checked)} />
              <span>
                לשתף את הטלפון של {name} עם הורי הקבוצה <span className="ip-muted">· {book.share_phone ? 'גלוי' : 'מוסתר'}</span>
              </span>
            </label>
          </form>
        ) : (
          book.phone && (
            <PersonBlock
              person={{ kind: 'extra', user_id: null, id: null, name, kinship: '', is_me: false, phone: book.phone, whatsapp: book.phone, email: null, address: null, sharing: null }}
              label="הטלפון של השחקן"
            />
          )
        )}

        {me && (
          <div className="ip-ct-mine">
            <PersonBlock person={me} label={`${labels.get(me) ?? personRole(me)} · הפרטים שלך`} onEditMe={() => setMine(true)} />
            <p className="ip-muted ip-ct-small">
              משותף עם הורים אחרים: {SHARE_LABELS.filter((s) => me.sharing?.[s.key]).map((s) => s.label).join(', ') || 'שום פרט'}. הפרטים שלך משמשים לכל הילדים שלך.
            </p>
            <Button variant="secondary" size="sm" icon="edit" onClick={() => setMine(true)}>
              עדכון הפרטים והשיתוף שלי
            </Button>
          </div>
        )}

        {others.map((c) => (
          <PersonBlock key={c.user_id ?? c.id} person={c} label={labels.get(c)} />
        ))}

        {(extras.length > 0 || book.can_edit) && (
          <div className="ip-ct-extras">
            <strong>אנשי קשר נוספים</strong>
            {extras.map((c) => (
              <div key={c.id} className="ip-ct-extra">
                <PersonBlock person={c} />
                {book.can_edit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="edit"
                    onClick={() =>
                      setExtra({
                        id: c.id,
                        name: c.name,
                        kinship: c.kinship,
                        phone: c.phone ?? '',
                        email: c.email ?? '',
                        share_phone: !!c.sharing?.phone,
                        share_whatsapp: !!c.sharing?.whatsapp,
                        share_email: !!c.sharing?.email,
                      })
                    }
                  >
                    עריכה
                  </Button>
                )}
              </div>
            ))}
            {book.can_edit && (
              <Button
                variant="ghost"
                size="sm"
                icon="plus"
                onClick={() => setExtra({ id: null, name: '', kinship: '', phone: '', email: '', share_phone: false, share_whatsapp: false, share_email: false })}
              >
                הוספת איש קשר
              </Button>
            )}
          </div>
        )}
        <Err error={error} />
      </Card>

      <BottomSheet open={mine} onClose={() => setMine(false)} title="הפרטים שלי">
        {mine && <MyCardEditor onSaved={() => void load()} />}
      </BottomSheet>
      <BottomSheet open={!!extra} onClose={() => setExtra(null)} title={extra?.id ? 'עריכת איש קשר' : 'איש קשר נוסף'}>
        {extra && (
          <ExtraForm
            playerId={playerId}
            value={extra}
            onDone={() => {
              setExtra(null);
              void load();
            }}
          />
        )}
      </BottomSheet>
    </section>
  );
}

function ExtraForm({ playerId, value, onDone }: { playerId: string; value: ExtraInput; onDone: () => void }) {
  const [x, setX] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!x.name.trim()) return setError('צריך למלא שם.');
    if (!phoneOk(x.phone)) return setError('מספר הטלפון לא תקין. ספרות בלבד, אפשר עם + בהתחלה.');
    if (!emailOk(x.email)) return setError('כתובת הדוא״ל לא תקינה.');
    setBusy(true);
    setError(null);
    try {
      await saveExtraContact(playerId, x);
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!x.id || !window.confirm(`למחוק את ${x.name} מאנשי הקשר?`)) return;
    setBusy(true);
    try {
      await removeExtraContact(x.id);
      onDone();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  }

  return (
    <form className="ip-form" onSubmit={submit}>
      <Field label="שם מלא">
        <input className="ip-input" value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} maxLength={80} required />
      </Field>
      <Field label="קרבה / תפקיד (סבתא, מטפלת…)">
        <input className="ip-input" value={x.kinship} onChange={(e) => setX({ ...x, kinship: e.target.value })} maxLength={30} />
      </Field>
      <Field label="טלפון">
        <input className="ip-input" type="tel" dir="ltr" inputMode="tel" value={x.phone} onChange={(e) => setX({ ...x, phone: e.target.value })} maxLength={20} />
      </Field>
      <Field label="דוא״ל">
        <input className="ip-input" type="email" dir="ltr" value={x.email} onChange={(e) => setX({ ...x, email: e.target.value })} maxLength={120} />
      </Field>
      <div className="ip-ct-share">
        <strong>מה הורים אחרים בקבוצה רואים?</strong>
        {(
          [
            ['share_phone', 'טלפון'],
            ['share_whatsapp', 'WhatsApp'],
            ['share_email', 'דוא״ל'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="ip-check ip-ct-switch">
            <input type="checkbox" role="switch" checked={x[k]} onChange={(e) => setX({ ...x, [k]: e.target.checked })} />
            <span>
              {label} <span className="ip-muted">· {x[k] ? 'גלוי להורים' : 'מוסתר'}</span>
            </span>
          </label>
        ))}
      </div>
      <Err error={error} />
      <div className="ip-btn-row">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'שומר…' : 'שמירה'}
        </Button>
        {x.id && (
          <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
            מחיקה
          </Button>
        )}
      </div>
    </form>
  );
}
