/**
 * #find: open search for any signed-in user. Find a team by the child's birth
 * year and team / club name, a child by name (and birth year), or a club and
 * its teams. Every result leads to the team's page, where the join / follow
 * request is sent. A team that is not in the app yet can be opened by a
 * parent (no coach needed).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { BottomSheet } from '../components/shell';
import { Icon } from '../components/Icon';
import { Button, Card, EmptyState, ListRow, SectionHeader, Segmented, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { friendlyError, sportLabel, type Sport } from '../lib/api';
import {
  birthYearsLabel,
  cancelJoinRequest,
  clubTeamsPublic,
  joinError,
  markOnboarded,
  myJoinRequests,
  openTeam as openNewTeam,
  PARENT_DECLARATION,
  programLabel,
  searchClubs,
  searchPlayers,
  searchTeams,
  type ClubHit,
  type ClubTeamRow,
  type MyRequest,
  type PlayerHit,
  type TeamHit,
} from '../lib/joinApi';

type Mode = 'team' | 'child' | 'club';
const statusLabel: Record<string, string> = { pending: 'ממתין לאישור', approved: 'אושר', rejected: 'נדחה', cancelled: 'בוטל' };

export function FindScreen({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<Mode>('team');
  const [teams, setTeams] = useState<TeamHit[] | null>(null);
  const [opening, setOpening] = useState(false);
  const [q, setQ] = useState('');
  const [year, setYear] = useState('');
  const [players, setPlayers] = useState<PlayerHit[] | null>(null);
  const [clubs, setClubs] = useState<ClubHit[] | null>(null);
  const [club, setClub] = useState<ClubHit | null>(null);
  const [clubTeams, setClubTeams] = useState<ClubTeamRow[] | null>(null);
  const [mine, setMine] = useState<MyRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMine = () => myJoinRequests().then(setMine).catch(() => setMine([]));
  useEffect(() => {
    void loadMine();
  }, []);

  const by = year.length === 4 ? Number(year) : null;
  const canSearch = q.trim().length >= 2 || (mode === 'team' && by !== null);

  async function search(e?: FormEvent) {
    e?.preventDefault();
    if (!canSearch) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'team') setTeams(await searchTeams(q.trim().length >= 2 ? q : '', by));
      else if (mode === 'child') setPlayers(await searchPlayers(q, by));
      else {
        setClub(null);
        setClubTeams(null);
        setClubs(await searchClubs(q));
      }
    } catch (err) {
      setError(joinError(err) ?? friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function openClub(c: ClubHit) {
    setClub(c);
    setClubTeams(null);
    try {
      setClubTeams(await clubTeamsPublic(c.club_id, by));
    } catch (err) {
      setError(joinError(err) ?? friendlyError(err));
    }
  }

  const openTeam = (teamId: string) => (window.location.hash = `t/${teamId}`);

  return (
    <div className="ip-stack">
      <div className="ip-backbar">
        <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
          <Icon name="back" size={20} />
        </button>
        <h1>חיפוש קבוצה, ילד או מועדון</h1>
        <span />
      </div>

      {mine.some((r) => r.status === 'pending') && (
        <section>
          <SectionHeader title="הבקשות שלי" icon="clock" />
          <Card padded={false}>
            {mine.map((r) => (
              <div key={r.id} className="ip-member">
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">
                    {r.child_name} · {r.team_name}
                  </span>
                  <span className="ip-list-row-sub">
                    {[r.club_name, r.relation === 'parent' ? 'הורה' : 'מעקב'].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <Tag tone={r.status === 'approved' ? 'lime' : r.status === 'pending' ? 'warning' : 'neutral'}>{statusLabel[r.status]}</Tag>
                {r.status === 'pending' && (
                  <Button variant="ghost" size="sm" onClick={() => cancelJoinRequest(r.id).then(loadMine)}>
                    ביטול
                  </Button>
                )}
              </div>
            ))}
          </Card>
        </section>
      )}

      <Card>
        <form className="ip-form ip-form--sheet" onSubmit={search}>
          <Segmented
            label="מה מחפשים"
            items={[
              { id: 'team', label: 'קבוצה' },
              { id: 'child', label: 'ילד' },
              { id: 'club', label: 'מועדון' },
            ]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
          />
          <div className="ip-field-row">
            <Field label={mode === 'team' ? 'קבוצה, מועדון או עיר' : mode === 'child' ? 'שם הילד' : 'שם המועדון או העיר'}>
              <input id="find-q" className="ip-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === 'team' ? 'לא חובה, לדוגמה: מכבי' : mode === 'child' ? 'לדוגמה: נועם לוי' : 'לדוגמה: מכבי'} autoFocus />
            </Field>
            <Field label={mode === 'team' ? 'שנתון הילד' : 'שנתון'}>
              <input id="find-year" className="ip-input" inputMode="numeric" dir="ltr" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="2016" />
            </Field>
          </div>
          <Button type="submit" variant="primary" icon="eye" block disabled={busy || !canSearch}>
            {busy ? 'מחפשים…' : 'חיפוש'}
          </Button>
        </form>
      </Card>

      {error && <p className="ip-error" role="alert">{error}</p>}

      {mode === 'team' && teams && (
        <section>
          <SectionHeader title={by ? `נמצאו ${teams.length} קבוצות לשנתון ${by}` : `נמצאו ${teams.length} קבוצות`} icon="team" />
          {teams.length === 0 ? (
            <EmptyState icon="team" title="לא נמצאה קבוצה" text="אולי אף אחד עוד לא פתח אותה באפליקציה. אפשר לפתוח אותה עכשיו." />
          ) : (
            <Card padded={false}>
              {teams.map((t) => (
                <ListRow
                  key={t.team_id}
                  icon="team"
                  iconTone={t.program_kind === 'academy' ? 'lime' : 'blue'}
                  title={t.name}
                  subtitle={[t.club_name, t.city, birthYearsLabel(t.birth_year_from, t.birth_year_to), t.program_kind && programLabel[t.program_kind], `${t.players} שחקנים`]
                    .filter(Boolean)
                    .join(' · ')}
                  trailing={t.is_member ? <Tag tone="lime" icon="check">שלי</Tag> : !t.has_staff ? <Tag tone="warning">בלי מאמן</Tag> : undefined}
                  onClick={() => openTeam(t.team_id)}
                />
              ))}
            </Card>
          )}
          <Card className="ip-find-open">
            <p>
              <strong>לא מצאתם את הקבוצה?</strong> פתחו אותה בעצמכם. לא צריך מאמן: הורים נוספים ימצאו אותה לפי השנתון ויצטרפו מיד, וכשמאמן או המועדון יצטרפו הם יקבלו את הניהול.
            </p>
            <Button variant="secondary" icon="plus" onClick={() => setOpening(true)}>
              פתיחת קבוצה חדשה
            </Button>
          </Card>
        </section>
      )}

      {mode === 'child' && players && (
        <section>
          <SectionHeader title={`נמצאו ${players.length}`} icon="user" />
          {players.length === 0 ? (
            <EmptyState icon="user" title="לא נמצא ילד בשם הזה" text="נסו שם אחר, בלי שנתון, או חפשו את המועדון." />
          ) : (
            <Card padded={false}>
              {players.map((p) => (
                <ListRow
                  key={`${p.player_id}-${p.team_id}`}
                  icon="user"
                  title={`${p.first_name} ${p.last_name}`}
                  subtitle={[p.birth_year && `שנתון ${p.birth_year}`, p.team_name, p.club_name, p.program_kind && programLabel[p.program_kind]].filter(Boolean).join(' · ')}
                  onClick={() => openTeam(p.team_id)}
                />
              ))}
            </Card>
          )}
        </section>
      )}

      {mode === 'club' && clubs && !club && (
        <section>
          <SectionHeader title={`נמצאו ${clubs.length} מועדונים`} icon="shield" />
          {clubs.length === 0 ? (
            <EmptyState icon="shield" title="לא נמצא מועדון" text="נסו חלק מהשם או את שם העיר." />
          ) : (
            <Card padded={false}>
              {clubs.map((c) => (
                <ListRow
                  key={c.club_id}
                  icon="shield"
                  iconTone="navy"
                  title={c.name}
                  subtitle={[c.city, `${c.teams} קבוצות`].filter(Boolean).join(' · ')}
                  trailing={c.status === 'verified' ? <Tag tone="lime" icon="check">מאומת</Tag> : undefined}
                  onClick={() => void openClub(c)}
                />
              ))}
            </Card>
          )}
        </section>
      )}

      {mode === 'club' && club && (
        <section>
          <SectionHeader title={by ? `${club.name} · שנתון ${by}` : club.name} icon="team" action="כל המועדונים" onAction={() => setClub(null)} />
          {clubTeams === null ? (
            <p className="ip-muted ip-pad">טוען…</p>
          ) : clubTeams.length === 0 ? (
            <EmptyState icon="team" title="אין קבוצות מתאימות" text={by ? 'נסו בלי שנתון כדי לראות את כל הקבוצות.' : 'למועדון עוד אין קבוצות פעילות.'} />
          ) : (
            <Card padded={false}>
              {clubTeams.map((t) => (
                <ListRow
                  key={t.team_id}
                  icon="team"
                  iconTone={t.program_kind === 'academy' ? 'lime' : 'blue'}
                  title={t.name}
                  subtitle={[t.program_name || (t.program_kind && programLabel[t.program_kind]), t.season, `${t.players} שחקנים`].filter(Boolean).join(' · ')}
                  onClick={() => openTeam(t.team_id)}
                />
              ))}
            </Card>
          )}
        </section>
      )}

      <OpenTeamSheet open={opening} defaultName={q.trim()} defaultYear={year} onClose={() => setOpening(false)} />

      <p className="ip-footnote">בחיפוש מופיעים רק שם, שנתון, קבוצה ומועדון. מיקומי אימונים, שעות ופרטי קשר גלויים רק לחברי הקבוצה.</p>
    </div>
  );
}

/** A parent opens a team that is not in the app yet, with their child. */
function OpenTeamSheet({ open, defaultName, defaultYear, onClose }: { open: boolean; defaultName: string; defaultYear: string; onClose: () => void }) {
  const { refresh } = useAuth();
  const [f, setF] = useState({ name: '', club: '', sport: 'football' as Sport, year: '', first: '', last: '' });
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setF((x) => ({ ...x, name: x.name || defaultName, year: x.year || defaultYear }));
      setDeclared(false);
      setError(null);
    }
  }, [open, defaultName, defaultYear]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const teamId = await openNewTeam({
        name: f.name,
        club: f.club,
        sport: f.sport,
        birthYear: Number(f.year),
        childFirst: f.first,
        childLast: f.last,
        declareParent: declared,
      });
      markOnboarded();
      await refresh();
      window.location.hash = `myteam/${teamId}`;
    } catch (err) {
      setError(joinError(err) ?? friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const ready = f.name.trim().length >= 2 && f.year.length === 4 && f.first.trim() && declared;
  return (
    <BottomSheet open={open} onClose={onClose} title="פתיחת קבוצה חדשה">
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="שם הקבוצה">
          <input id="ot-name" className="ip-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.slice(0, 60) })} placeholder="לדוגמה: ילדים ג׳ 2016" required />
        </Field>
        <Field label="מועדון">
          <input id="ot-club" className="ip-input" value={f.club} onChange={(e) => setF({ ...f, club: e.target.value.slice(0, 60) })} placeholder="לדוגמה: הפועל רמת גן" />
        </Field>
        <div className="ip-field-row">
          <Field label="ענף">
            <select id="ot-sport" className="ip-input" value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value as Sport })}>
              {(Object.keys(sportLabel) as Sport[]).map((s) => (
                <option key={s} value={s}>
                  {sportLabel[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="שנתון">
            <input id="ot-year" className="ip-input" inputMode="numeric" dir="ltr" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="2016" required />
          </Field>
        </div>
        <p className="ip-muted">הילד/ה שלך בקבוצה</p>
        <div className="ip-field-row">
          <Field label="שם פרטי">
            <input id="ot-first" className="ip-input" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value.slice(0, 40) })} required />
          </Field>
          <Field label="שם משפחה">
            <input id="ot-last" className="ip-input" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value.slice(0, 40) })} />
          </Field>
        </div>
        <label className="ip-declare">
          <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
          <span>{PARENT_DECLARATION}</span>
        </label>
        <p className="ip-footnote">את/ה נכנס/ת כהורה, לא כמאמן. עד שמאמן או המועדון יצטרפו, הורים שמצהירים שהם ההורים נכנסים מיד.</p>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy || !ready}>
          {busy ? 'פותחים…' : 'פתיחת הקבוצה'}
        </Button>
      </form>
    </BottomSheet>
  );
}
