/**
 * Club sign-up (spec section 3): type a city, tick clubs, tick teams, send a
 * request. Picking a club gives no rights by itself: the club's admin (or the
 * iplays team, when the club has no admin yet) approves first. Clubs and
 * academies that are not in the list can be opened by hand.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, Card, EmptyState, SectionHeader, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { friendlyError } from '../lib/api';
import {
  cancelClubAccess,
  clubError,
  clubStatusLabel,
  createClubManual,
  myClubAccessRequests,
  programKindLabel,
  requestClubAccess,
  searchClubsByCity,
  signupClubTeams,
  teamRoleLabel,
  type AccessKind,
  type CityClub,
  type ClubKind,
  type MyAccessRequest,
  type SignupTeam,
  type StaffTeamRole,
} from '../lib/clubApi';

const errText = (e: unknown) => clubError(e) ?? friendlyError(e);
const staffRoles: StaffTeamRole[] = ['coach', 'assistant_coach', 'instructor', 'team_manager'];

const requestStatusLabel: Record<MyAccessRequest['status'], string> = {
  pending: 'ממתינה לאישור',
  approved: 'אושרה',
  rejected: 'לא אושרה',
  cancelled: 'בוטלה',
};

export function ClubSignup({ onCreated }: { onCreated: (clubId: string) => void }) {
  const [city, setCity] = useState('');
  const [clubs, setClubs] = useState<CityClub[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [teams, setTeams] = useState<SignupTeam[]>([]);
  const [pickedTeams, setPickedTeams] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<AccessKind>('club_admin');
  const [teamRole, setTeamRole] = useState<StaffTeamRole>('coach');
  const [roleTitle, setRoleTitle] = useState('');
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [mine, setMine] = useState<MyAccessRequest[]>([]);
  const [manual, setManual] = useState(false);

  const loadMine = () => myClubAccessRequests().then(setMine).catch(() => undefined);
  useEffect(() => {
    void loadMine();
  }, []);

  // teams of the ticked clubs
  useEffect(() => {
    const ids = [...picked];
    if (ids.length === 0) {
      setTeams([]);
      return;
    }
    let live = true;
    signupClubTeams(ids)
      .then((t) => live && setTeams(t))
      .catch((e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [picked]);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (city.trim().length < 2) return;
    setError(null);
    setSent(null);
    try {
      setClubs(await searchClubsByCity(city));
      setPicked(new Set());
      setPickedTeams(new Set());
    } catch (err) {
      setError(errText(err));
    }
  };

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const clubById = useMemo(() => new Map((clubs ?? []).map((c) => [c.club_id, c])), [clubs]);
  const teamsByClub = useMemo(() => {
    const m = new Map<string, SignupTeam[]>();
    for (const t of teams) m.set(t.club_id, [...(m.get(t.club_id) ?? []), t]);
    return m;
  }, [teams]);

  const missingTeams = kind === 'team_staff' && [...picked].some((id) => !(teamsByClub.get(id) ?? []).some((t) => pickedTeams.has(t.team_id)));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const n = await requestClubAccess({
        clubIds: [...picked],
        teamIds: [...pickedTeams],
        kind,
        teamRole,
        roleTitle,
        message,
        phone,
      });
      setSent(n);
      setPicked(new Set());
      setPickedTeams(new Set());
      setClubs((list) => list?.map((c) => (picked.has(c.club_id) ? { ...c, my_status: 'pending' } : c)) ?? null);
      await loadMine();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const pending = mine.filter((r) => r.status === 'pending' || Date.now() - Date.parse(r.created_at) < 14 * 864e5);

  return (
    <section className="ip-stack">
      <Card>
        <form className="ip-stack ip-stack--tight" onSubmit={search}>
          <h2 className="ip-club-h2">הצטרפות כמועדון או כאקדמיה</h2>
          <p className="ip-muted">מקלידים עיר, מסמנים את המועדונים ואת הקבוצות, ושולחים בקשה. ההרשאות נפתחות רק אחרי אישור של מנהל המועדון או של צוות iplays.</p>
          <div className="ip-club-search">
            <Field label="עיר">
              <input className="ip-input" value={city} maxLength={60} onChange={(e) => setCity(e.target.value)} placeholder="למשל: לוד" />
            </Field>
            <Button type="submit" variant="primary" disabled={city.trim().length < 2}>
              חיפוש
            </Button>
          </div>
        </form>
      </Card>

      <Err error={error} />
      {sent !== null && (
        <p className="ip-success" role="status">
          {sent === 1 ? 'הבקשה נשלחה.' : `${sent} בקשות נשלחו.`} נעדכן אותך בהתראה כשתאושר.
        </p>
      )}

      {clubs !== null && (
        <div>
          <SectionHeader title={clubs.length ? `מועדונים ב${city.trim()} · ${clubs.length}` : 'לא נמצאו מועדונים'} icon="team" />
          <Card padded={false}>
            {clubs.length === 0 ? (
              <EmptyState icon="team" title="אין מועדונים ידועים" text="אפשר לפתוח מועדון או אקדמיה ידנית למטה." />
            ) : (
              clubs.map((c) => (
                <label key={c.club_id} className={`ip-club-pick${c.my_status ? ' is-disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={picked.has(c.club_id)}
                    disabled={!!c.my_status}
                    onChange={() => setPicked((s) => toggle(s, c.club_id))}
                  />
                  <span className="ip-list-row-text">
                    <span className="ip-list-row-title">{c.name}</span>
                    <span className="ip-club-tags">
                      {c.city && <span className="ip-list-row-sub">{c.city}</span>}
                      <span className="ip-list-row-sub">{c.teams} קבוצות</span>
                      {c.kind === 'academy' && <Tag tone="blue">אקדמיה</Tag>}
                      {c.ifa_registered && <Tag tone="navy">התאחדות</Tag>}
                      {!c.managed && <Tag tone="warning">{clubStatusLabel.catalog}</Tag>}
                      {c.my_status === 'staff' && <Tag tone="lime">את/ה כבר בצוות</Tag>}
                      {c.my_status === 'pending' && <Tag tone="warning">בקשה ממתינה</Tag>}
                    </span>
                  </span>
                </label>
              ))
            )}
          </Card>
        </div>
      )}

      {picked.size > 0 && (
        <Card>
          <div className="ip-stack ip-stack--tight">
            <Field label="מה התפקיד שלך?">
              <select className="ip-input" value={kind} onChange={(e) => setKind(e.target.value as AccessKind)}>
                <option value="club_admin">ניהול המועדון כולו</option>
                <option value="team_staff">מאמן / איש צוות בקבוצות מסוימות</option>
              </select>
            </Field>
            {kind === 'team_staff' && (
              <Field label="תפקיד בקבוצות">
                <select className="ip-input" value={teamRole} onChange={(e) => setTeamRole(e.target.value as StaffTeamRole)}>
                  {staffRoles.map((r) => (
                    <option key={r} value={r}>
                      {teamRoleLabel[r]}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {[...picked].map((clubId) => {
              const list = teamsByClub.get(clubId) ?? [];
              return (
                <div key={clubId}>
                  <h3 className="ip-club-h3">
                    {clubById.get(clubId)?.name} · {kind === 'team_staff' ? 'בחרו קבוצות' : 'קבוצות (לא חובה)'}
                  </h3>
                  {list.length === 0 ? (
                    <p className="ip-muted">עוד אין קבוצות רשומות במועדון הזה.</p>
                  ) : (
                    <div className="ip-club-teamgrid">
                      {list.map((t) => (
                        <label key={t.team_id} className="ip-club-pick ip-club-pick--small">
                          <input type="checkbox" checked={pickedTeams.has(t.team_id)} onChange={() => setPickedTeams((s) => toggle(s, t.team_id))} />
                          <span className="ip-list-row-text">
                            <span className="ip-list-row-title">{t.name}</span>
                            <span className="ip-club-tags">
                              {t.age_group && <span className="ip-list-row-sub">{t.age_group}</span>}
                              {t.program_kind && <span className="ip-list-row-sub">{programKindLabel[t.program_kind]}</span>}
                              {t.league && <span className="ip-list-row-sub">{t.league}</span>}
                              {t.has_staff && <Tag>יש מאמן</Tag>}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="ip-club-grid">
              <Field label="תפקידך במועדון">
                <input className="ip-input" value={roleTitle} maxLength={80} placeholder="למשל: יו״ר, רכז" onChange={(e) => setRoleTitle(e.target.value)} />
              </Field>
              <Field label="טלפון לאימות">
                <input className="ip-input" value={phone} maxLength={30} inputMode="tel" dir="ltr" onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </div>
            <Field label="הודעה למאשר">
              <textarea className="ip-input" rows={3} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} />
            </Field>
            <p className="ip-muted ip-club-hint">
              כדי שאף אחד לא ישתלט על מועדון קיים, הבקשה עוברת לאישור מנהל המועדון. במועדון שאין לו עדיין מנהל, צוות iplays מאמת את הבקשה (בדרך כלל בטלפון).
            </p>
            {missingTeams && <p className="ip-muted">בחרו לפחות קבוצה אחת בכל מועדון שסימנתם.</p>}
            <Button variant="primary" disabled={busy || missingTeams} onClick={submit}>
              {busy ? 'שולח…' : picked.size === 1 ? 'שליחת בקשה' : `שליחת ${picked.size} בקשות`}
            </Button>
          </div>
        </Card>
      )}

      {pending.length > 0 && (
        <div>
          <SectionHeader title="הבקשות שלי" icon="clock" />
          <Card padded={false}>
            {pending.map((r) => (
              <div key={r.id} className="ip-club-row">
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">{r.club_name}</span>
                  <span className="ip-list-row-sub">
                    {r.kind === 'club_admin' ? 'ניהול המועדון' : r.teams.map((t) => t.name).join(', ')} · {requestStatusLabel[r.status]}
                    {r.review_note ? ` · ${r.review_note}` : ''}
                  </span>
                </span>
                {r.status === 'pending' && (
                  <Button variant="ghost" size="sm" onClick={() => cancelClubAccess(r.id).then(loadMine)}>
                    ביטול
                  </Button>
                )}
                {r.status === 'approved' && (
                  <Button variant="secondary" size="sm" onClick={() => onCreated(r.club_id)}>
                    כניסה
                  </Button>
                )}
              </div>
            ))}
          </Card>
        </div>
      )}

      {manual ? (
        <ManualClubCard onCreated={onCreated} defaultCity={city} />
      ) : (
        <Button variant="ghost" icon="plus" onClick={() => setManual(true)}>
          המועדון או האקדמיה לא ברשימה? פתיחה ידנית
        </Button>
      )}
    </section>
  );
}

function ManualClubCard({ onCreated, defaultCity }: { onCreated: (id: string) => void; defaultCity: string }) {
  const [name, setName] = useState('');
  const [city, setCity] = useState(defaultCity);
  const [kind, setKind] = useState<ClubKind>('academy');
  const [ifa, setIfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await createClubManual({ name, city, kind, ifaRegistered: ifa }));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <form className="ip-stack ip-stack--tight" onSubmit={submit}>
        <h2 className="ip-club-h2">פתיחה ידנית</h2>
        <p className="ip-muted">למועדונים ולאקדמיות פרטיות שלא מופיעים במאגר ההתאחדות. נפתח כטיוטה ואת/ה הבעלים. אפשר לבקש אימות אחר כך.</p>
        <div className="ip-club-grid">
          <Field label="סוג">
            <select className="ip-input" value={kind} onChange={(e) => setKind(e.target.value as ClubKind)}>
              <option value="academy">אקדמיה פרטית</option>
              <option value="club">מועדון</option>
            </select>
          </Field>
          <Field label="שם">
            <input className="ip-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="עיר">
            <input className="ip-input" value={city} maxLength={60} onChange={(e) => setCity(e.target.value)} required />
          </Field>
        </div>
        <label className="ip-check">
          <input type="checkbox" checked={ifa} onChange={(e) => setIfa(e.target.checked)} />
          <span>רשום בהתאחדות לכדורגל</span>
        </label>
        <Err error={error} />
        <Button type="submit" variant="primary" disabled={busy || !name.trim() || !city.trim()}>
          {busy ? 'פותח…' : 'פתיחה'}
        </Button>
      </form>
    </Card>
  );
}
