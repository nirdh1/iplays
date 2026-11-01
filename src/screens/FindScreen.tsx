/**
 * #find: open search for any signed-in user. Find a child by name (and birth
 * year) and see their team and club, or find a club and its teams by birth
 * year. Every result leads to the team's page, where the join / follow
 * request is sent.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { Button, Card, EmptyState, ListRow, SectionHeader, Segmented, Tag } from '../components/ui';
import { Field } from '../components/form';
import { friendlyError } from '../lib/api';
import {
  cancelJoinRequest,
  clubTeamsPublic,
  joinError,
  myJoinRequests,
  programLabel,
  searchClubs,
  searchPlayers,
  type ClubHit,
  type ClubTeamRow,
  type MyRequest,
  type PlayerHit,
} from '../lib/joinApi';

type Mode = 'child' | 'club';
const statusLabel: Record<string, string> = { pending: 'ממתין לאישור', approved: 'אושר', rejected: 'נדחה', cancelled: 'בוטל' };

export function FindScreen({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<Mode>('child');
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

  async function search(e?: FormEvent) {
    e?.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'child') setPlayers(await searchPlayers(q, by));
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
        <h1>חיפוש ילד או מועדון</h1>
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
            <Field label={mode === 'child' ? 'שם הילד' : 'שם המועדון או העיר'}>
              <input id="find-q" className="ip-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === 'child' ? 'לדוגמה: נועם לוי' : 'לדוגמה: מכבי'} autoFocus />
            </Field>
            <Field label="שנתון">
              <input id="find-year" className="ip-input" inputMode="numeric" dir="ltr" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="2016" />
            </Field>
          </div>
          <Button type="submit" variant="primary" icon="eye" block disabled={busy || q.trim().length < 2}>
            {busy ? 'מחפשים…' : 'חיפוש'}
          </Button>
        </form>
      </Card>

      {error && <p className="ip-error" role="alert">{error}</p>}

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

      <p className="ip-footnote">בחיפוש מופיעים רק שם, שנתון, קבוצה ומועדון. מיקומי אימונים, שעות ופרטי קשר גלויים רק לחברי הקבוצה.</p>
    </div>
  );
}
