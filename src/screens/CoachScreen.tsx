/**
 * Coach board: announcements from the coach, the training schedule, and
 * absence / lateness reports from parents (one training, or dates marked in
 * advance such as a family event). Staff manage trainings and post
 * announcements; parents report for their own children.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { InitialsAvatar } from '../components/Avatar';
import { BottomSheet } from '../components/shell';
import { Button, Card, EmptyState, MetaRow, SectionHeader, Segmented, Tag, TeamCrest } from '../components/ui';
import { Err, Field } from '../components/form';
import { useAuth } from '../auth/AuthContext';
import { friendlyError, getRoster, isStaffRole } from '../lib/api';
import {
  absenceCovers,
  addDays,
  demoCoach,
  reasonLabel,
  scopeLabel,
  sessionDate,
  supabaseCoach,
  todayYmd,
  type Absence,
  type AbsenceKind,
  type AbsenceReason,
  type AbsenceScope,
  type Announcement,
  type CoachBackend,
  type TrainingSession,
} from '../lib/coachApi';
import {
  calendarError,
  docTypes,
  isGoalkeeperPosition,
  listAbsenceDocs,
  MAX_DOC_BYTES,
  openAbsenceDoc,
  removeAbsenceDoc,
  trainingTypeLabel,
  uploadAbsenceDoc,
  type AbsenceDoc,
} from '../lib/calendarApi';
import { TrainingSheet, type RosterRef } from './TrainingSheet';
import { teams as demoTeams } from '../data/team';
import { parent, type Child } from '../data/demo';
import '../theme/coach.css';
import { AttendanceSheet } from './AttendanceSheet';

interface PlayerRef {
  id: string;
  name: string;
}

/* ------------------------------------------------------------ wrappers */

const demoSlots: Record<string, { weekday: number; time: string; duration: number; location: string }[]> = {
  noam: [
    { weekday: 0, time: '17:00', duration: 90, location: 'מגרש סינטטי 2' },
    { weekday: 2, time: '17:00', duration: 90, location: 'מגרש סינטטי 2' },
    { weekday: 4, time: '17:00', duration: 90, location: 'מגרש סינטטי 2' },
  ],
  maya: [
    { weekday: 1, time: '16:00', duration: 75, location: 'אולם אופק' },
    { weekday: 3, time: '16:00', duration: 75, location: 'אולם אופק' },
  ],
  itay: [{ weekday: 2, time: '16:00', duration: 60, location: 'מגרש אלונים' }],
};

/** Demo mode: fictional team of the selected child, with a parent / coach view switch. */
export function DemoCoachScreen({ child, onBack }: { child: Child; onBack: () => void }) {
  const t = demoTeams[child.id];
  const mine = t.roster.find((p) => p.childId === child.id);
  const myPlayers = useMemo<PlayerRef[]>(() => [{ id: `${child.id}-me`, name: mine?.name ?? `${child.firstName} ${child.lastName}` }], [child, mine]);
  const backend = useMemo(
    () =>
      demoCoach(
        child.id,
        {
          coach: t.coach,
          slots: demoSlots[child.id] ?? demoSlots.noam,
          others: t.roster.filter((p) => !p.childId).map((p) => ({ id: `${child.id}-${p.number}`, name: p.name })),
        },
        { name: `${parent.firstName} ${parent.lastName}`, players: new Map(myPlayers.map((p) => [p.id, p.name])) },
      ),
    [child.id, t, myPlayers],
  );
  const [view, setView] = useState<'parent' | 'coach'>('parent');
  return (
    <CoachBoard
      key={child.id}
      backend={backend}
      teamName={child.team}
      club={child.club}
      coachName={t.coach}
      staff={view === 'coach'}
      myPlayers={view === 'coach' ? [] : myPlayers}
      onBack={onBack}
      demoSwitch={
        <div className="ip-coach-demo">
          <Segmented
            items={[
              { id: 'parent', label: 'תצוגת הורה' },
              { id: 'coach', label: 'תצוגת מאמן' },
            ]}
            value={view}
            onChange={setView}
            label="תצוגה"
          />
          <p className="ip-muted">מצב הדגמה: אפשר לעבור בין מה שההורה רואה למה שהמאמן רואה. השינויים נשמרים רק בדפדפן הזה.</p>
        </div>
      }
    />
  );
}

/** Backend mode: a real team the signed-in user belongs to. */
export function TeamCoachScreen({ teamId, onBack }: { teamId: string; onBack: () => void }) {
  const { session, teams } = useAuth();
  const me = session!.user.id;
  const team = teams.find((x) => x.id === teamId);
  const staff = isStaffRole(team?.role);
  const backend = useMemo(() => supabaseCoach(teamId), [teamId]);
  const [myPlayers, setMyPlayers] = useState<PlayerRef[] | null>(null);
  const [roster, setRoster] = useState<RosterRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getRoster(teamId)
      .then((r) => {
        setRoster(r.map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`.trim(), position: p.position ?? '' })));
        setMyPlayers(r.filter((p) => p.guardians.includes(me)).map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`.trim() })));
      })
      .catch((e) => setError(friendlyError(e)));
  }, [teamId, me]);

  if (!team) {
    return (
      <div className="ip-stack">
        <CoachBackBar onBack={onBack} />
        <EmptyState icon="team" title="הקבוצה לא נמצאה" text="ייתכן שיצאת מהקבוצה או שהקישור שגוי." />
      </div>
    );
  }
  if (error) return <p className="ip-error" role="alert">{error}</p>;
  if (!myPlayers) return <p className="ip-muted ip-pad">טוען…</p>;
  return (
    <CoachBoard
      backend={backend}
      teamName={team.name}
      club={team.club}
      staff={staff}
      canSchedule
      myPlayers={myPlayers}
      roster={roster}
      me={me}
      onBack={onBack}
      withAttendance
      withDocs
    />
  );
}

/* --------------------------------------------------------------- board */

type Tab = 'news' | 'trainings' | 'absences';

interface BoardProps {
  backend: CoachBackend;
  teamName: string;
  club: string;
  coachName?: string;
  staff: boolean;
  myPlayers: PlayerRef[];
  onBack: () => void;
  demoSwitch?: ReactNode;
  /** real teams: staff mark attendance per training */
  withAttendance?: boolean;
  /** may add / cancel / delete trainings: staff, and on real teams every member (parents too) */
  canSchedule?: boolean;
  /** the team's players (real teams): goalkeeper / personal trainings */
  roster?: RosterRef[];
  me?: string;
  /** real teams: medical documents on absences */
  withDocs?: boolean;
}

type ReportPreset = { sessionId?: string; mode: 'session' | 'dates'; kind?: AbsenceKind; playerId?: string; edit?: Absence };

function CoachBoard({ backend, teamName, club, coachName, staff, myPlayers, onBack, demoSwitch, withAttendance, canSchedule = staff, roster = [], me, withDocs }: BoardProps) {
  const [attFor, setAttFor] = useState<TrainingSession | null>(null);
  const [tab, setTab] = useState<Tab>('news');
  const [sessions, setSessions] = useState<TrainingSession[] | null>(null);
  const [news, setNews] = useState<Announcement[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportPreset | null>(null);
  const [sheet, setSheet] = useState<null | 'session' | 'news'>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [docs, setDocs] = useState<AbsenceDoc[]>([]);

  const load = useCallback(async () => {
    try {
      const [s, n, a] = await Promise.all([backend.listSessions(), backend.listAnnouncements(), backend.listAbsences()]);
      setSessions(s);
      setNews(n);
      setAbsences(a);
      setError(null);
      if (withDocs) setDocs(await listAbsenceDocs(a.map((x) => x.id)).catch(() => []));
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [backend, withDocs]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const run = async (fn: () => Promise<void>, done?: string) => {
    try {
      await fn();
      await load();
      if (done) setToast(done);
    } catch (e) {
      setError(calendarError(e) ?? friendlyError(e));
    }
  };

  const myIds = new Set(myPlayers.map((p) => p.id));
  const names = new Map(roster.map((p) => [p.id, p.name]));
  const gk = new Set(roster.filter((p) => isGoalkeeperPosition(p.position)).map((p) => p.id));
  /** players expected at a training (null = the whole team) */
  const playersOf = (s: TrainingSession): Set<string> | null =>
    !s.audience || s.audience === 'team' ? null : s.audience === 'goalkeepers' ? gk : new Set(s.participants ?? []);
  const canEdit = (s: TrainingSession) =>
    !s.audience || s.audience === 'team' ? canSchedule : s.created_by === me || (staff && !s.private) || (!staff && s.audience === 'goalkeepers');
  const visibleAbsences = staff ? absences : absences.filter((a) => myIds.has(a.player_id));
  const upcoming = (sessions ?? []).filter((s) => sessionDate(s) >= todayYmd());
  const next = upcoming.find((s) => !s.canceled);
  const nextReports = next ? absences.filter((a) => absenceCovers(a, next)) : [];
  const canReport = myPlayers.length > 0;

  return (
    <div className="ip-stack">
      <CoachBackBar onBack={onBack} />

      <Card tone="navy" className="ip-team-hero">
        <div className="ip-team-hero-id">
          <TeamCrest name={club || teamName} tone="lime" size={56} />
          <div>
            <h1>{teamName}</h1>
            {club && <p>{club}</p>}
            {coachName && <p className="ip-on-navy-muted">מאמן: {coachName}</p>}
          </div>
        </div>
        {next ? (
          <div className="ip-coach-next">
            <span className="ip-on-navy-muted">האימון הבא</span>
            <strong>
              {fmtDay(sessionDate(next))} · {fmtTime(next.starts_at)}
            </strong>
            <span className="ip-on-navy-muted">
              {next.location}
              {staff && ` · ${countLabel(nextReports.filter((a) => playersOf(next)?.has(a.player_id) ?? true))}`}
            </span>
          </div>
        ) : (
          <p className="ip-on-navy-muted ip-coach-next">אין אימונים מתוכננים כרגע</p>
        )}
      </Card>

      {demoSwitch}

      {canReport && (
        <div className="ip-coach-actions">
          <Button variant="lime" icon="clock" block onClick={() => setReport({ mode: 'session', sessionId: next?.id })}>
            דיווח איחור / אי־הגעה
          </Button>
          <Button variant="secondary" icon="calendar" block onClick={() => setReport({ mode: 'dates', kind: 'absent' })}>
            סימון תאריכים מראש
          </Button>
        </div>
      )}
      {staff ? (
        <div className="ip-coach-actions">
          <Button variant="primary" icon="chat" block onClick={() => setSheet('news')}>
            הודעה חדשה לקבוצה
          </Button>
          <Button variant="secondary" icon="whistle" block onClick={() => setSheet('session')}>
            הוספת ימי אימון
          </Button>
        </div>
      ) : (
        canSchedule && (
          <>
            <div className="ip-coach-actions">
              <Button variant="secondary" icon="whistle" block onClick={() => setSheet('session')}>
                הוספת לוח אימונים
              </Button>
            </div>
            <p className="ip-footnote">כל הורה בקבוצה יכול להזין, לבטל ולמחוק אימונים קבוצתיים. אימון אישי או אימון שוערים פרטי מופיע רק אצלכם ואצל מי שצירפתם.</p>
          </>
        )
      )}

      {error && (
        <p className="ip-error" role="alert">
          {error}
        </p>
      )}

      <div className="ip-sticky-seg">
        <Segmented
          items={[
            { id: 'news', label: 'הודעות' },
            { id: 'trainings', label: 'אימונים' },
            { id: 'absences', label: staff ? `היעדרויות${visibleAbsences.length ? ` · ${visibleAbsences.length}` : ''}` : 'הדיווחים שלי' },
          ]}
          value={tab}
          onChange={setTab}
          label="אזורי לוח המאמן"
        />
      </div>

      {sessions === null ? (
        <p className="ip-muted ip-pad">טוען…</p>
      ) : tab === 'news' ? (
        <NewsList
          items={news}
          staff={staff}
          onPin={(a) => run(() => backend.setPinned(a.id, !a.pinned))}
          onDelete={(a) => confirm(`למחוק את ההודעה "${a.title}"?`) && run(() => backend.deleteAnnouncement(a.id), 'ההודעה נמחקה')}
        />
      ) : tab === 'trainings' ? (
        <TrainingList
          sessions={upcoming}
          absences={absences}
          staff={staff}
          canEdit={canEdit}
          playersOf={playersOf}
          names={names}
          myPlayers={myPlayers}
          onReport={(s, playerId) => setReport({ mode: 'session', sessionId: s.id, playerId })}
          onAttendance={withAttendance ? setAttFor : undefined}
          onCancel={(s) => run(() => backend.setCanceled(s.id, !s.canceled), s.canceled ? 'האימון חזר ללוח' : 'האימון סומן כמבוטל')}
          onDelete={(s) => {
            if (s.series_id && upcoming.filter((x) => x.series_id === s.series_id && x.starts_at > s.starts_at).length > 0) {
              const all = confirm('למחוק גם את כל האימונים הבאים בסדרה? (ביטול = רק את האימון הזה)');
              if (all) return run(() => backend.deleteSeriesFrom(s), 'האימונים נמחקו');
            }
            return confirm('למחוק את האימון מהלוח?') && run(() => backend.deleteSession(s.id), 'האימון נמחק');
          }}
        />
      ) : (
        <AbsenceList
          items={visibleAbsences}
          sessions={sessions}
          staff={staff}
          canReport={canReport}
          docs={docs}
          isMine={(a) => myIds.has(a.player_id)}
          onAdd={() => setReport({ mode: 'dates', kind: 'absent' })}
          onEdit={(a) => setReport({ mode: a.session_id ? 'session' : 'dates', edit: a, playerId: a.player_id, sessionId: a.session_id ?? undefined })}
          onOpenDoc={(d) => openAbsenceDoc(d).catch((e) => setError(friendlyError(e)))}
          onRemoveDoc={(d) => confirm('להסיר את המסמך?') && run(() => removeAbsenceDoc(d), 'המסמך הוסר')}
          onDelete={async (a) => {
            if (!confirm('לבטל את הדיווח?')) return;
            await run(async () => {
              for (const d of docs.filter((x) => x.absence_id === a.id)) await removeAbsenceDoc(d);
              await backend.deleteAbsence(a.id);
            }, 'הדיווח בוטל');
          }}
        />
      )}

      {attFor && <AttendanceSheet kind="training" eventId={attFor.id} title={`נוכחות · ${attFor.title}`} onClose={() => setAttFor(null)} />}

      <ReportSheet
        preset={report}
        sessions={upcoming.filter((s) => !s.canceled)}
        players={myPlayers}
        withDocs={!!withDocs}
        onClose={() => setReport(null)}
        onSave={async (input, file) => {
          const editing = report?.edit;
          let id: string | null = editing?.id ?? null;
          if (editing) {
            await backend.updateAbsence(editing.id, input);
          } else {
            id = await backend.reportAbsence(input);
          }
          let docFailed = false;
          if (file && id) {
            try {
              await uploadAbsenceDoc(id, file);
            } catch {
              docFailed = true;
            }
          }
          setReport(null);
          await load();
          if (docFailed) setError('הדיווח נשמר, אבל המסמך לא הועלה. אפשר לנסות שוב מעריכת הדיווח.');
          setToast(editing ? 'הדיווח עודכן' : 'הדיווח נשלח למאמן');
        }}
      />
      <TrainingSheet
        open={sheet === 'session'}
        staff={staff}
        roster={roster}
        myPlayerIds={myPlayers.map((p) => p.id)}
        onClose={() => setSheet(null)}
        onSave={async (input) => {
          await backend.addSessions(input);
          setSheet(null);
          setTab('trainings');
          await load();
          setToast(input.repeatWeeks > 1 ? `נוספו ${input.repeatWeeks} אימונים` : 'האימון נוסף');
        }}
      />
      <NewsSheet
        open={sheet === 'news'}
        onClose={() => setSheet(null)}
        onSave={async (a) => {
          await backend.postAnnouncement(a);
          setSheet(null);
          setTab('news');
          await load();
          setToast('ההודעה פורסמה לקבוצה');
        }}
      />

      {toast && (
        <div className="ip-toast" role="status">
          <Icon name="check" size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}

function CoachBackBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="ip-backbar">
      <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
        <Icon name="back" size={20} />
      </button>
      <h1>לוח המאמן</h1>
      <span />
    </div>
  );
}

/* --------------------------------------------------------- formatting */

function parseYmd(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
}
function fmtDay(d: string) {
  if (d === todayYmd()) return 'היום';
  if (d === addDays(todayYmd(), 1)) return 'מחר';
  return parseYmd(d).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });
}
function fmtShort(d: string) {
  return parseYmd(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
}
function fmtRange(a: Absence) {
  return a.from_date === a.to_date ? fmtDay(a.from_date) : `${fmtShort(a.from_date)}–${fmtShort(a.to_date)}`;
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}
function endTime(s: TrainingSession) {
  return fmtTime(new Date(new Date(s.starts_at).getTime() + s.duration_min * 60_000).toISOString());
}
function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'עכשיו';
  if (min < 60) return `לפני ${min} דק׳`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? 'לפני שעה' : `לפני ${h} שעות`;
  const d = Math.round(h / 24);
  return d === 1 ? 'אתמול' : `לפני ${d} ימים`;
}
function countLabel(list: Absence[]) {
  const absent = list.filter((a) => a.kind === 'absent').length;
  const late = list.filter((a) => a.kind === 'late').length;
  if (!absent && !late) return 'אין דיווחי היעדרות';
  return [absent && `${absent} לא מגיעים`, late && `${late} מאחרים`].filter(Boolean).join(' · ');
}
function absenceTitle(a: Absence) {
  return a.kind === 'late' ? `מאחר${a.minutes_late ? ` כ-${a.minutes_late} דק׳` : ''}` : 'לא מגיע';
}

/* -------------------------------------------------------- announcements */

function NewsList({ items, staff, onPin, onDelete }: { items: Announcement[]; staff: boolean; onPin: (a: Announcement) => void; onDelete: (a: Announcement) => void }) {
  const sorted = [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  if (!sorted.length) {
    return (
      <Card>
        <EmptyState icon="chat" title="עוד אין הודעות" text={staff ? 'כתבו הודעה ראשונה לקבוצה: שינוי שעה, ציוד לאימון או תזכורת.' : 'כשהמאמן יפרסם הודעה היא תופיע כאן.'} />
      </Card>
    );
  }
  return (
    <section className="ip-stack ip-stack--tight">
      {sorted.map((a) => (
        <Card key={a.id} as="article" className={`ip-news ${a.pinned ? 'is-pinned' : ''}`}>
          <div className="ip-post-head">
            <InitialsAvatar name={a.author_name} size={40} tone="navy" />
            <span>
              <strong>{a.author_name}</strong>
              <span className="ip-muted">{ago(a.created_at)}</span>
            </span>
            {a.pinned && <Tag tone="lime" icon="pin">נעוץ</Tag>}
          </div>
          <h3 className="ip-news-title">{a.title}</h3>
          {a.body && <p className="ip-news-body">{a.body}</p>}
          {staff && (
            <div className="ip-btn-row">
              <Button variant="ghost" size="sm" icon="pin" onClick={() => onPin(a)}>
                {a.pinned ? 'ביטול נעיצה' : 'נעיצה למעלה'}
              </Button>
              <Button variant="ghost" size="sm" icon="close" onClick={() => onDelete(a)}>
                מחיקה
              </Button>
            </div>
          )}
        </Card>
      ))}
    </section>
  );
}

/* ------------------------------------------------------------ trainings */

function TrainingList({
  sessions,
  absences,
  staff,
  canSchedule = staff,
  canEdit = () => canSchedule,
  playersOf = () => null,
  names,
  myPlayers,
  onReport,
  onCancel,
  onDelete,
  onAttendance,
}: {
  onAttendance?: (s: TrainingSession) => void;
  sessions: TrainingSession[];
  absences: Absence[];
  staff: boolean;
  canSchedule?: boolean;
  canEdit?: (s: TrainingSession) => boolean;
  playersOf?: (s: TrainingSession) => Set<string> | null;
  names?: Map<string, string>;
  myPlayers: PlayerRef[];
  onReport: (s: TrainingSession, playerId: string) => void;
  onCancel: (s: TrainingSession) => void;
  onDelete: (s: TrainingSession) => void;
}) {
  if (!sessions.length) {
    return (
      <Card>
        <EmptyState icon="whistle" title="אין אימונים בלוח" text={canSchedule ? 'הוסיפו ימי אימון קבועים, למשל כל יום ראשון ושלישי ב-17:00.' : 'המאמן עוד לא פרסם את לוח האימונים.'} />
      </Card>
    );
  }
  return (
    <section className="ip-stack ip-stack--tight">
      {sessions.map((s) => {
        const only = playersOf(s);
        const reports = absences.filter((a) => absenceCovers(a, s) && (!only || only.has(a.player_id)));
        const mineHere = myPlayers.filter((p) => !only || only.has(p.id));
        const typeLabel = trainingTypeLabel(s.kind, s.audience);
        const editable = canEdit(s);
        const who = s.audience === 'players' && names ? (s.participants ?? []).map((id) => names.get(id)).filter(Boolean).join(', ') : '';
        return (
          <Card key={s.id} className={`ip-training-event ${s.canceled ? 'is-canceled' : ''}`}>
            <div className="ip-carpool-head">
              <strong>{s.title}</strong>
              {s.canceled ? <Tag tone="warning">בוטל</Tag> : <Tag tone="blue">{fmtDay(sessionDate(s))}</Tag>}
            </div>
            {(typeLabel || s.series_id) && (
              <div className="ip-tag-row">
                {typeLabel && <Tag tone="lime">{typeLabel}</Tag>}
                {s.private && <Tag icon="shield">פרטי</Tag>}
                {s.series_id && <Tag icon="undo">חוזר כל שבוע</Tag>}
              </div>
            )}
            {who && <MetaRow icon="user">{who}</MetaRow>}
            <MetaRow icon="clock">
              {fmtDay(sessionDate(s))} · {fmtTime(s.starts_at)}–{endTime(s)}
            </MetaRow>
            {s.location && <MetaRow icon="pin">{s.location}</MetaRow>}
            {s.note && <p className="ip-coach-note">{s.note}</p>}

            {staff ? (
              <>
                <p className="ip-coach-count">{countLabel(reports)}</p>
                {reports.length > 0 && (
                  <ul className="ip-coach-reports">
                    {reports.map((a) => (
                      <li key={a.id}>
                        <strong>{a.player_name}</strong> · {absenceTitle(a)} · <span className="ip-muted">{reasonLabel[a.reason]}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="ip-btn-row">
                  {onAttendance && !s.canceled && (!s.private || editable) && (
                    <Button variant="primary" size="sm" icon="check" onClick={() => onAttendance(s)}>
                      נוכחות
                    </Button>
                  )}
                  {editable && (
                    <>
                      <Button variant="secondary" size="sm" icon={s.canceled ? 'undo' : 'close'} onClick={() => onCancel(s)}>
                        {s.canceled ? 'החזרת האימון' : 'ביטול האימון'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onDelete(s)}>
                        מחיקה
                      </Button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
              {!s.canceled &&
              mineHere.map((p) => {
                const mine = reports.find((a) => a.player_id === p.id);
                return (
                  <div key={p.id} className="ip-coach-mine">
                    <span>{myPlayers.length > 1 ? p.name : 'הסטטוס שלכם'}</span>
                    {mine ? (
                      <Tag tone={mine.kind === 'late' ? 'warning' : 'navy'}>{absenceTitle(mine)}</Tag>
                    ) : (
                      <Button variant="secondary" size="sm" icon="clock" onClick={() => onReport(s, p.id)}>
                        דיווח איחור / אי־הגעה
                      </Button>
                    )}
                  </div>
                );
              })}
              {editable && (
                <div className="ip-btn-row">
                  <Button variant="secondary" size="sm" icon={s.canceled ? 'undo' : 'close'} onClick={() => onCancel(s)}>
                    {s.canceled ? 'החזרת האימון' : 'ביטול האימון'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onDelete(s)}>
                    מחיקה
                  </Button>
                </div>
              )}
              </>
            )}
          </Card>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------- absences */

function AbsenceList({
  items,
  sessions,
  staff,
  canReport,
  docs = [],
  isMine = () => !staff,
  onAdd,
  onEdit,
  onOpenDoc,
  onRemoveDoc,
  onDelete,
}: {
  items: Absence[];
  sessions: TrainingSession[];
  staff: boolean;
  canReport: boolean;
  docs?: AbsenceDoc[];
  isMine?: (a: Absence) => boolean;
  onAdd: () => void;
  onEdit?: (a: Absence) => void;
  onOpenDoc?: (d: AbsenceDoc) => void;
  onRemoveDoc?: (d: AbsenceDoc) => void;
  onDelete: (a: Absence) => void;
}) {
  const today = todayYmd();
  const current = items.filter((a) => a.to_date >= today);
  const past = items.filter((a) => a.to_date < today);
  return (
    <>
      <section>
        <SectionHeader title={staff ? 'היעדרויות ואיחורים קרובים' : 'דיווחים פעילים'} icon="calendar" />
        {current.length ? (
          <div className="ip-stack ip-stack--tight">
            {current.map((a) => (
              <AbsenceCard
                key={a.id}
                a={a}
                sessions={sessions}
                staff={staff}
                docs={docs.filter((d) => d.absence_id === a.id)}
                onDelete={onDelete}
                onEdit={isMine(a) ? onEdit : undefined}
                onOpenDoc={onOpenDoc}
                onRemoveDoc={isMine(a) ? onRemoveDoc : undefined}
              />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              icon="calendar"
              title="אין דיווחים"
              text={staff ? 'כשהורה ידווח על איחור או היעדרות זה יופיע כאן.' : 'יודעים מראש שלא תגיעו? סמנו את התאריכים והמאמן יראה אותם מיד.'}
            />
          </Card>
        )}
        {canReport && (
          <div className="ip-btn-row">
            <Button variant="primary" icon="plus" onClick={onAdd}>
              סימון תאריכים מראש
            </Button>
          </div>
        )}
      </section>
      {past.length > 0 && (
        <section>
          <SectionHeader title="השבוע האחרון" icon="clock" />
          <div className="ip-stack ip-stack--tight">
            {past.map((a) => (
              <AbsenceCard key={a.id} a={a} sessions={sessions} staff={staff} docs={docs.filter((d) => d.absence_id === a.id)} onOpenDoc={onOpenDoc} />
            ))}
          </div>
        </section>
      )}
      {!staff && (
        <p className="ip-footnote">
          הדיווחים גלויים רק לכם ולצוות המקצועי של הקבוצה. מסמך רפואי גלוי רק לכם ולמי שהמועדון הסמיך במפורש (הרשאת אישורים רפואיים).
        </p>
      )}
    </>
  );
}

function AbsenceCard({
  a,
  sessions,
  staff,
  docs = [],
  onDelete,
  onEdit,
  onOpenDoc,
  onRemoveDoc,
}: {
  a: Absence;
  sessions: TrainingSession[];
  staff: boolean;
  docs?: AbsenceDoc[];
  onDelete?: (a: Absence) => void;
  onEdit?: (a: Absence) => void;
  onOpenDoc?: (d: AbsenceDoc) => void;
  onRemoveDoc?: (d: AbsenceDoc) => void;
}) {
  const missed = sessions.filter((s) => !s.canceled && absenceCovers(a, s)).length;
  return (
    <Card className="ip-absence">
      <div className="ip-carpool-head">
        <strong>{a.player_name}</strong>
        <Tag tone={a.kind === 'late' ? 'warning' : 'navy'} icon={a.kind === 'late' ? 'clock' : 'close'}>
          {absenceTitle(a)}
        </Tag>
      </div>
      <MetaRow icon="calendar">
        {fmtRange(a)}
        {a.from_date !== a.to_date && missed > 0 && ` · ${missed} אימונים`}
      </MetaRow>
      <div className="ip-tag-row">
        <Tag>{reasonLabel[a.reason] ?? a.reason}</Tag>
        {!a.session_id && a.applies_to && a.applies_to !== 'all' && <Tag tone="blue">{scopeLabel[a.applies_to]}</Tag>}
      </div>
      {a.note && <p className="ip-coach-note">{a.note}</p>}
      {docs.map((d) => (
        <div key={d.id} className="ip-coach-mine">
          <button type="button" className="ip-link" onClick={() => onOpenDoc?.(d)}>
            <Icon name="shield" size={16} /> {d.mime === 'application/pdf' ? 'מסמך רפואי (PDF)' : 'מסמך רפואי (תמונה)'}
          </button>
          {onRemoveDoc && (
            <Button variant="ghost" size="sm" onClick={() => onRemoveDoc(d)}>
              הסרה
            </Button>
          )}
        </div>
      ))}
      {(staff && a.reported_by_name) || onDelete || onEdit ? (
        <div className="ip-absence-foot">
          <span className="ip-muted">{staff && a.reported_by_name ? `דווח ע״י ${a.reported_by_name} · ${ago(a.created_at)}` : ago(a.created_at)}</span>
          {onEdit && (
            <Button variant="ghost" size="sm" onClick={() => onEdit(a)}>
              עריכה
            </Button>
          )}
          {onDelete && (
            <Button variant="ghost" size="sm" onClick={() => onDelete(a)}>
              ביטול דיווח
            </Button>
          )}
        </div>
      ) : null}
    </Card>
  );
}

/* --------------------------------------------------------------- sheets */

const reasons: AbsenceReason[] = ['sick', 'injury', 'vacation', 'family_event', 'school', 'other'];
const scopes: AbsenceScope[] = ['all', 'training', 'match'];
const lateOptions = [5, 10, 15, 20, 30, 45, 60];

function ReportSheet({
  preset,
  sessions,
  players,
  withDocs,
  onClose,
  onSave,
}: {
  preset: ReportPreset | null;
  sessions: TrainingSession[];
  players: PlayerRef[];
  withDocs: boolean;
  onClose: () => void;
  onSave: (input: Parameters<CoachBackend['reportAbsence']>[0], file: File | null) => Promise<void>;
}) {
  const today = todayYmd();
  const [playerId, setPlayerId] = useState('');
  const [kind, setKind] = useState<AbsenceKind>('absent');
  const [mode, setMode] = useState<'session' | 'dates'>('session');
  const [sessionId, setSessionId] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState<AbsenceReason | null>(null);
  const [scope, setScope] = useState<AbsenceScope>('all');
  const [minutes, setMinutes] = useState(15);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edit = preset?.edit;

  // Reset the form each time the sheet opens.
  useEffect(() => {
    if (!preset) return;
    const e = preset.edit;
    const m = e ? (e.session_id ? 'session' : 'dates') : preset.mode === 'session' && sessions.length === 0 ? 'dates' : preset.mode;
    setPlayerId(e?.player_id ?? preset.playerId ?? players[0]?.id ?? '');
    setKind(e?.kind ?? (m === 'dates' ? 'absent' : (preset.kind ?? 'absent')));
    setMode(m);
    setSessionId(e?.session_id ?? preset.sessionId ?? sessions[0]?.id ?? '');
    setFrom(e?.from_date ?? today);
    setTo(e?.to_date ?? today);
    // a reason is required: nothing is preselected for a new report
    setReason(e?.reason ?? null);
    setScope(e?.applies_to ?? 'all');
    setMinutes(e?.minutes_late ?? 15);
    setNote(e?.note ?? '');
    setFile(null);
    setError(null);
  }, [preset, players, sessions, today]);

  const session = sessions.find((s) => s.id === sessionId);
  // editing an existing range: the start may already be in the past (shorten / extend)
  const minFrom = edit && edit.from_date < today ? edit.from_date : today;
  const datesValid = from >= minFrom && to >= from && daysBetween(from, to) <= 180;
  const valid = !!playerId && !!reason && (mode === 'session' ? !!session || !!edit?.session_id : datesValid);
  const medical = reason === 'injury' || reason === 'sick';

  function pickFile(f: File | null) {
    setError(null);
    if (f && !docTypes.includes(f.type)) return setError('אפשר לצרף תמונה (JPG / PNG / HEIC) או PDF.');
    if (f && f.size > MAX_DOC_BYTES) return setError('הקובץ גדול מ-10MB.');
    setFile(f);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || !reason) return;
    setBusy(true);
    setError(null);
    try {
      const d = session ? sessionDate(session) : (edit?.from_date ?? from);
      await onSave(
        {
          player_id: playerId,
          kind,
          from_date: mode === 'session' ? d : from,
          to_date: mode === 'session' ? d : to,
          session_id: mode === 'session' ? (session?.id ?? edit?.session_id ?? null) : null,
          reason,
          note,
          minutes_late: kind === 'late' ? minutes : null,
          ...(mode === 'dates' ? { applies_to: scope } : {}),
        },
        medical ? file : null,
      );
    } catch (err) {
      setError(calendarError(err) ?? friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const title = edit ? 'עריכת דיווח' : mode === 'dates' ? 'היעדרות לפי תאריכים' : 'דיווח איחור / אי־הגעה';
  return (
    <BottomSheet open={preset !== null} onClose={onClose} title={title}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        {players.length > 1 && !edit && (
          <Field label="עבור">
            <div className="ip-player-chips">
              {players.map((p) => (
                <button key={p.id} type="button" className={playerId === p.id ? 'is-on' : ''} aria-pressed={playerId === p.id} onClick={() => setPlayerId(p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
          </Field>
        )}

        {!edit && (
          <div className="ip-choice-row" role="group" aria-label="מתי">
            <button type="button" className={mode === 'session' ? 'is-on' : ''} disabled={!sessions.length} onClick={() => setMode('session')}>
              אימון מסוים
            </button>
            <button
              type="button"
              className={mode === 'dates' ? 'is-on' : ''}
              onClick={() => {
                setMode('dates');
                setKind('absent');
              }}
            >
              יום אחד או טווח תאריכים
            </button>
          </div>
        )}

        {mode === 'session' ? (
          <>
            {!edit && (
              <Field label="אימון">
                <select className="ip-input" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {fmtDay(sessionDate(s))} · {fmtTime(s.starts_at)} · {s.title}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="ip-rsvp ip-rsvp--flush" role="group" aria-label="סוג הדיווח">
              <button type="button" className={kind === 'absent' ? 'is-no' : ''} aria-pressed={kind === 'absent'} onClick={() => setKind('absent')}>
                <Icon name="close" size={18} /> לא מגיע/ה
              </button>
              <button type="button" className={kind === 'late' ? 'is-late' : ''} aria-pressed={kind === 'late'} onClick={() => setKind('late')}>
                <Icon name="clock" size={18} /> מאחר/ת
              </button>
            </div>
            {kind === 'late' && (
              <Field label="בערך כמה דקות?">
                <div className="ip-player-chips">
                  {lateOptions.map((m) => (
                    <button key={m} type="button" className={minutes === m ? 'is-on' : ''} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>
                      {m === 60 ? 'שעה' : `${m} דק׳`}
                    </button>
                  ))}
                </div>
              </Field>
            )}
          </>
        ) : (
          <>
            <div className="ip-field-row">
              <Field label="מתאריך">
                <input
                  type="date"
                  className="ip-input"
                  min={minFrom}
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    if (to < e.target.value) setTo(e.target.value);
                  }}
                  required
                />
              </Field>
              <Field label="עד תאריך">
                <input type="date" className="ip-input" min={from} value={to} onChange={(e) => setTo(e.target.value)} required />
              </Field>
            </div>
            <Field label="חל על">
              <div className="ip-player-chips">
                {scopes.map((s) => (
                  <button key={s} type="button" className={scope === s ? 'is-on' : ''} aria-pressed={scope === s} onClick={() => setScope(s)}>
                    {scopeLabel[s]}
                  </button>
                ))}
              </div>
            </Field>
            <p className="ip-footnote">אימונים ומשחקים שייקבעו בהמשך בתוך התקופה יסומנו אוטומטית.</p>
          </>
        )}

        <Field label="סיבה (חובה)">
          <div className="ip-player-chips">
            {reasons.map((r) => (
              <button key={r} type="button" className={reason === r ? 'is-on' : ''} aria-pressed={reason === r} onClick={() => setReason(r)}>
                {reasonLabel[r]}
              </button>
            ))}
          </div>
        </Field>
        {withDocs && medical && (
          <Field label="מסמך רפואי (לא חובה)">
            <input type="file" className="ip-input" accept={docTypes.join(',')} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </Field>
        )}
        {withDocs && medical && <p className="ip-footnote">המסמך נשמר באופן פרטי ומאובטח. רק אתם ומי שהמועדון הסמיך במפורש יכולים לפתוח אותו.</p>}
        <Field label="הערה למאמן">
          <input className="ip-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="לא חובה, למשל: חתונה של בן דוד" />
        </Field>
        {mode === 'dates' && !datesValid && <p className="ip-muted">בחרו תאריכים מהיום והלאה, עד חצי שנה.</p>}
        {!reason && <p className="ip-muted">בחרו סיבה.</p>}
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy || !valid}>
          {busy ? 'שולחים…' : edit ? 'שמירת השינויים' : 'שליחה למאמן'}
        </Button>
      </form>
    </BottomSheet>
  );
}

function daysBetween(a: string, b: string) {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86_400_000);
}

function NewsSheet({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (a: { title: string; body: string; pinned: boolean }) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setBody('');
      setPinned(false);
      setError(null);
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({ title, body, pinned });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="הודעה חדשה לקבוצה">
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="כותרת">
          <input className="ip-input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="למשל: האימון ביום שלישי עובר ל-18:00" required />
        </Field>
        <Field label="תוכן ההודעה">
          <textarea className="ip-input ip-textarea" value={body} maxLength={2000} rows={5} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <label className="ip-check">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          <span>נעיצה בראש הלוח</span>
        </label>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy || !title.trim()}>
          {busy ? 'מפרסמים…' : 'פרסום לקבוצה'}
        </Button>
      </form>
    </BottomSheet>
  );
}
