/**
 * "גלריה" tab of the team page: albums parents share from their own cloud
 * (Google Photos / Drive, iCloud, OneDrive, Dropbox). iplays keeps only the
 * link: no upload, no thumbnails, no media through our servers. Cards show the
 * cloud service's icon instead of a preview image.
 * Server: supabase/migrations/20261103400000_team_gallery.sql
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/shell';
import { Button, Card, EmptyState, SectionHeader, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { friendlyError } from '../lib/api';
import { supabase } from '../lib/supabase';
import {
  CONSENT_CHECKBOX,
  CONSENT_PARAGRAPHS,
  CONSENT_TITLE,
  PROVIDERS,
  PUBLIC_LINK_WARNING,
  albumReports,
  categoryLabel,
  detectProvider,
  dismissAlbumReports,
  galleryError,
  isSafeLink,
  linkProblem,
  linkableEvents,
  providerLabel,
  providerOf,
  publishAlbum,
  removeAlbum,
  reportAlbum,
  reportReasonLabel,
  restoreAlbum,
  shortDate,
  teamGallery,
  updateAlbum,
  type Album,
  type AlbumCategory,
  type AlbumInput,
  type AlbumReport,
  type GalleryEvent,
  type ProviderId,
  type ReportReason,
} from '../lib/galleryApi';
import '../theme/career.css';
import '../theme/gallery.css';

type Filter = 'all' | AlbumCategory;
const filters: Filter[] = ['all', 'match', 'training', 'event', 'general'];

const errText = (e: unknown) => galleryError(e) ?? friendlyError(e);

async function can(fn: 'gallery_can_post' | 'gallery_can_moderate', teamId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc(fn, { p_team: teamId });
  return !error && data === true;
}

export function GallerySection({ teamId }: { teamId: string }) {
  const [albums, setAlbums] = useState<Album[] | null | undefined>(undefined);
  const [canPost, setCanPost] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Album | 'new' | null>(null);
  const [reporting, setReporting] = useState<{ album: Album; reason?: ReportReason } | null>(null);
  const [moderating, setModerating] = useState<Album | null>(null);
  const [events, setEvents] = useState<GalleryEvent[]>([]);

  const load = useCallback(async () => {
    try {
      setError(null);
      setAlbums(await teamGallery(teamId));
    } catch (e) {
      setError(errText(e));
      setAlbums([]);
    }
  }, [teamId]);

  useEffect(() => {
    void load();
    void can('gallery_can_post', teamId).then(setCanPost);
    void can('gallery_can_moderate', teamId).then(setCanModerate);
  }, [load, teamId]);

  const openEditor = (a: Album | 'new') => {
    setEditing(a);
    if (!events.length) void linkableEvents(teamId).then(setEvents).catch(() => setEvents([]));
  };

  const counts = useMemo(() => {
    const live = (albums ?? []).filter((a) => !a.removed_at);
    const c: Record<Filter, number> = { all: live.length, match: 0, training: 0, event: 0, general: 0 };
    live.forEach((a) => (c[a.category] += 1));
    return c;
  }, [albums]);

  if (albums === undefined) return <p className="ip-muted ip-pad">טוען את הגלריה…</p>;
  if (albums === null) {
    return <EmptyState icon="photo" title="הגלריה עוד לא הופעלה" text="הגלריה תפעל אחרי עדכון מסד הנתונים (קובץ ה־SQL של הגלריה)." />;
  }

  const shown = albums.filter((a) => filter === 'all' || a.category === filter);
  const live = shown.filter((a) => !a.removed_at);
  const removed = shown.filter((a) => a.removed_at);

  async function ownerRemove(a: Album) {
    if (!window.confirm(`להסיר את "${a.title}" מהגלריה?\nהקבצים בשירות הענן שלך לא יימחקו. אם תרצו, אפשר לבטל שם את השיתוף בקישור.`)) return;
    try {
      await removeAlbum(a.id);
      setNotice('האלבום הוסר מהגלריה. הקבצים נשארו בענן שלך.');
      await load();
    } catch (e) {
      setError(errText(e));
    }
  }

  return (
    <div className="ip-stack">
      <section>
        <SectionHeader title="גלריית הקבוצה" icon="photo" />
        <Card className="ip-gal-intro">
          <p>
            אלבומים של תמונות וסרטונים ממשחקים, אימונים ואירועים. כל הורה משתף אלבום מהענן האישי שלו, והאלבום נפתח ישירות בשירות הענן. iPlays שומרת רק את הקישור, ולא את התמונות.
          </p>
          {canPost && (
            <Button variant="primary" icon="plus" onClick={() => openEditor('new')}>
              הוסף אלבום
            </Button>
          )}
        </Card>
      </section>

      {error && <p className="ip-error" role="alert">{error}</p>}
      {notice && (
        <Card className="ip-gal-notice">
          <Tag tone="lime" icon="check">בוצע</Tag>
          <p>{notice}</p>
        </Card>
      )}

      <div className="ip-chip-row ip-gal-filters" role="tablist" aria-label="סוג האלבום">
        {filters.map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} className={`ip-chip ${filter === f ? 'is-on' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'הכל' : categoryLabel[f]}
            {counts[f] > 0 && <span className="ip-gal-count"> {counts[f]}</span>}
          </button>
        ))}
      </div>

      {live.length === 0 ? (
        <EmptyState
          icon="photo"
          title={filter === 'all' ? 'עוד אין אלבומים' : `אין אלבומים של ${categoryLabel[filter as AlbumCategory]}`}
          text={canPost ? 'צלמתם במשחק או באימון? שתפו אלבום מהענן שלכם בלחיצה על "הוסף אלבום".' : 'כשהורים בקבוצה ישתפו אלבומים, הם יופיעו כאן.'}
        />
      ) : (
        <ul className="ip-gal-list">
          {live.map((a) => (
            <AlbumCard
              key={a.id}
              album={a}
              canModerate={canModerate}
              onEdit={() => openEditor(a)}
              onRemove={() => void ownerRemove(a)}
              onReport={(reason) => setReporting({ album: a, reason })}
              onModerate={() => setModerating(a)}
            />
          ))}
        </ul>
      )}

      {live.length > 0 && (
        <p className="ip-footnote">
          האלבום נפתח בשירות הענן של ההורה שפרסם. אם מופיעה בקשת הרשאה או שהקישור לא נפתח, לחצו "הקישור לא נפתח?" וההורה יקבל הודעה לבדוק את הגדרות השיתוף. ההורדה נעשית מתוך שירות הענן, אם ההורה אפשר אותה.
        </p>
      )}

      {removed.length > 0 && (
        <section>
          <SectionHeader title="הוסרו מהגלריה" icon="close" />
          <ul className="ip-gal-list">
            {removed.map((a) => (
              <li key={a.id} className="ip-card ip-card--padded ip-gal-card is-removed">
                <div className="ip-gal-card-head">
                  <ProviderTile provider={a.provider} />
                  <span className="ip-list-row-text">
                    <span className="ip-list-row-title">{a.title}</span>
                    <span className="ip-list-row-sub">
                      {a.is_mine ? 'האלבום שלך הוסר על ידי צוות הקבוצה' : `פורסם על ידי ${a.publisher}`}
                      {a.removed_reason ? ` · ${a.removed_reason}` : ''}
                    </span>
                  </span>
                </div>
                <div className="ip-btn-row">
                  {canModerate && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="undo"
                      onClick={async () => {
                        try {
                          await restoreAlbum(a.id);
                          await load();
                        } catch (e) {
                          setError(errText(e));
                        }
                      }}
                    >
                      החזרה לגלריה
                    </Button>
                  )}
                  {a.is_mine && (
                    <Button variant="ghost" size="sm" onClick={() => void ownerRemove(a)}>
                      מחיקה סופית מ־iPlays
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AlbumSheet
        teamId={teamId}
        album={editing}
        events={events}
        onClose={() => setEditing(null)}
        onSaved={async (msg) => {
          setEditing(null);
          setNotice(msg);
          await load();
        }}
      />
      <ReportSheet
        target={reporting}
        onClose={() => setReporting(null)}
        onSent={async (msg) => {
          setReporting(null);
          setNotice(msg);
          await load();
        }}
      />
      <ModerateSheet
        album={moderating}
        onClose={() => setModerating(null)}
        onDone={async (msg) => {
          setModerating(null);
          setNotice(msg);
          await load();
        }}
      />
    </div>
  );
}

function ProviderTile({ provider }: { provider: ProviderId }) {
  return (
    <span className={`ip-gal-tile ip-gal-tile--${provider}`} aria-hidden>
      <Icon name={provider === 'google_photos' || provider === 'icloud' ? 'photo' : 'cloud'} size={24} />
    </span>
  );
}

function AlbumCard({
  album: a,
  canModerate,
  onEdit,
  onRemove,
  onReport,
  onModerate,
}: {
  album: Album;
  canModerate: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onReport: (reason?: ReportReason) => void;
  onModerate: () => void;
}) {
  const safe = isSafeLink(a.provider, a.url);
  const when = a.event_at ? shortDate(a.event_at) : a.event_date ? shortDate(a.event_date) : shortDate(a.created_at);
  return (
    <li className="ip-card ip-card--padded ip-gal-card">
      <div className="ip-gal-card-head">
        <ProviderTile provider={a.provider} />
        <span className="ip-list-row-text">
          <span className="ip-list-row-title">{a.title}</span>
          <span className="ip-list-row-sub">
            {a.publisher}
            {a.is_mine && ' (אני)'} · {when}
          </span>
        </span>
        {canModerate && a.open_reports > 0 && (
          <button type="button" className="ip-gal-flag" onClick={onModerate}>
            <Tag tone="warning" icon="flag">{a.open_reports === 1 ? 'דיווח' : `${a.open_reports} דיווחים`}</Tag>
          </button>
        )}
      </div>
      <div className="ip-gal-meta">
        <Tag tone="blue">{categoryLabel[a.category]}</Tag>
        {a.event_label && <Tag tone="neutral" icon={a.match_id ? 'ball' : 'calendar'}>{a.event_label}</Tag>}
        <Tag tone="neutral" icon="cloud">{providerLabel(a.provider)}</Tag>
      </div>
      {safe ? (
        <a className="ip-btn ip-btn--primary ip-btn--block ip-gal-open" href={a.url} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer">
          <Icon name="external" size={18} />
          צפה באלבום
        </a>
      ) : (
        <p className="ip-error">הקישור של האלבום לא תקין ולכן לא ניתן לפתוח אותו.</p>
      )}
      <div className="ip-gal-actions">
        {a.is_mine ? (
          <>
            <Button variant="ghost" size="sm" icon="edit" onClick={onEdit}>
              עריכה
            </Button>
            <Button variant="ghost" size="sm" icon="close" onClick={onRemove}>
              הסרה
            </Button>
          </>
        ) : a.my_report ? (
          <span className="ip-muted ip-gal-reported">דיווחת על האלבום · ממתין לבדיקה</span>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => onReport('broken_link')}>
              הקישור לא נפתח?
            </Button>
            <Button variant="ghost" size="sm" icon="flag" onClick={() => onReport()}>
              דיווח
            </Button>
          </>
        )}
        {canModerate && !a.is_mine && (
          <Button variant="ghost" size="sm" icon="shield" onClick={onModerate}>
            ניהול
          </Button>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------ add / edit */

type Step = 1 | 2 | 3;
const emptyInput = (): AlbumInput => ({ title: '', provider: 'google_photos', url: '', category: 'general', trainingId: null, matchId: null, eventDate: null, consent: false });

function AlbumSheet({
  teamId,
  album,
  events,
  onClose,
  onSaved,
}: {
  teamId: string;
  album: Album | 'new' | null;
  events: GalleryEvent[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const isNew = album === 'new';
  const existing = album && album !== 'new' ? album : null;
  const [step, setStep] = useState<Step>(1);
  const [f, setF] = useState<AlbumInput>(emptyInput);
  const [providerNote, setProviderNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!album) return;
    setError(null);
    setProviderNote(null);
    if (album === 'new') {
      setF(emptyInput());
      setStep(1);
    } else {
      setF({
        title: album.title,
        provider: album.provider,
        url: album.url,
        category: album.category,
        trainingId: album.training_id,
        matchId: album.match_id,
        eventDate: album.event_date,
        consent: false,
      });
      setStep(2);
    }
  }, [album]);

  const linkChanged = !existing || existing.url !== f.url.trim() || existing.provider !== f.provider;
  const problem = linkProblem(f.provider, f.url);
  const provider = providerOf(f.provider)!;
  const eventKind = f.category === 'match' ? 'match' : f.category === 'training' ? 'training' : null;
  const eventOptions = events.filter((e) => e.kind === eventKind);
  const eventValue = f.category === 'match' ? f.matchId ?? '' : f.category === 'training' ? f.trainingId ?? '' : '';
  const detailsOk = !problem && f.title.trim().length > 0 && f.title.trim().length <= 80;

  function onLink(value: string) {
    const detected = detectProvider(value);
    if (detected && detected !== f.provider) {
      setProviderNote(`זיהינו קישור של ${providerLabel(detected)}, ולכן שירות הענן עודכן.`);
      setF({ ...f, url: value, provider: detected });
    } else setF({ ...f, url: value });
  }

  function onCategory(c: AlbumCategory) {
    setF({ ...f, category: c, trainingId: null, matchId: null, eventDate: c === 'event' ? f.eventDate : null });
  }

  function onEvent(id: string) {
    const ev = events.find((e) => e.id === id);
    const title = !f.title.trim() && ev ? `${ev.label} · ${shortDate(ev.starts_at)}` : f.title;
    setF({ ...f, title, trainingId: f.category === 'training' ? id || null : null, matchId: f.category === 'match' ? id || null : null });
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (problem || !detailsOk) return;
    if (linkChanged && !f.consent) {
      setStep(3);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (existing) {
        await updateAlbum(existing.id, f);
        await onSaved('השינויים באלבום נשמרו.');
      } else {
        await publishAlbum(teamId, f);
        await onSaved('האלבום פורסם בגלריה, וחברי הקבוצה קיבלו הודעה.');
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const title = isNew ? 'הוספת אלבום' : 'עריכת אלבום';
  return (
    <BottomSheet open={album !== null} onClose={onClose} title={title}>
      <form className="ip-form ip-form--sheet ip-gal-form" onSubmit={save}>
        {isNew && (
          <ol className="ip-gal-steps" aria-label="שלבים">
            {['שירות הענן', 'קישור ופרטים', 'אישור ופרסום'].map((s, i) => (
              <li key={s} className={step === i + 1 ? 'is-on' : step > i + 1 ? 'is-done' : ''}>
                <span>{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        )}

        {step === 1 && (
          <>
            <p>איפה שמורות התמונות? בוחרים את שירות הענן שלכם. iPlays לא מבקשת גישה לחשבון שלכם ולא מעלה אליה קבצים.</p>
            <div className="ip-gal-providers" role="radiogroup" aria-label="שירות הענן">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={f.provider === p.id}
                  className={`ip-gal-provider ${f.provider === p.id ? 'is-on' : ''}`}
                  onClick={() => setF({ ...f, provider: p.id })}
                >
                  <ProviderTile provider={p.id} />
                  {p.label}
                </button>
              ))}
            </div>
            <Card className="ip-gal-howto">
              <strong>איך יוצרים קישור ב־{provider.label}</strong>
              <ol>
                {provider.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <a className="ip-btn ip-btn--secondary ip-btn--sm" href={provider.createUrl} target="_blank" rel="noopener noreferrer">
                <Icon name="external" size={16} />
                פתיחת {provider.label}
              </a>
            </Card>
            <p className="ip-footnote">חשוב: בהגדרות השיתוף בענן מאפשרים צפייה (והורדה, אם רוצים) לכל מי שמקבל את הקישור. אחרת חברי הקבוצה יתבקשו לבקש ממך הרשאה.</p>
            <Button type="button" variant="primary" block onClick={() => setStep(2)}>
              יצרתי אלבום והעתקתי את הקישור
            </Button>
          </>
        )}

        {step === 2 && (
          <>
            <Field label={`קישור השיתוף מ־${provider.label}`}>
              <input
                id="gal-url"
                className="ip-input"
                dir="ltr"
                inputMode="url"
                autoComplete="off"
                value={f.url}
                placeholder={provider.example}
                onChange={(e) => onLink(e.target.value)}
              />
            </Field>
            {providerNote && <p className="ip-footnote">{providerNote}</p>}
            {f.url.trim() && problem && <p className="ip-error">{problem}</p>}

            <Field label="שם האלבום">
              <input id="gal-title" className="ip-input" value={f.title} maxLength={80} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="לדוגמה: משחק חוץ מול הפועל" />
            </Field>

            <div className="ip-field">
              <span>סוג האלבום</span>
              <div className="ip-chip-row">
                {(['match', 'training', 'event', 'general'] as AlbumCategory[]).map((c) => (
                  <button key={c} type="button" className={`ip-chip ${f.category === c ? 'is-on' : ''}`} onClick={() => onCategory(c)}>
                    {c === 'match' ? 'משחק' : c === 'training' ? 'אימון' : c === 'event' ? 'אירוע קבוצתי' : 'כללי'}
                  </button>
                ))}
              </div>
            </div>

            {eventKind && (
              <Field label={eventKind === 'match' ? 'המשחק ביומן (לא חובה)' : 'האימון ביומן (לא חובה)'}>
                <select id="gal-event" className="ip-input" value={eventValue} onChange={(e) => onEvent(e.target.value)}>
                  <option value="">בלי שיוך לאירוע ביומן</option>
                  {eventOptions.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.label} · {shortDate(ev.starts_at)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {f.category === 'event' && (
              <Field label="תאריך האירוע (לא חובה)">
                <input id="gal-date" className="ip-input" type="date" value={f.eventDate ?? ''} onChange={(e) => setF({ ...f, eventDate: e.target.value || null })} />
              </Field>
            )}

            {existing && linkChanged && <p className="ip-footnote">שיניתם את הקישור, ולכן צריך לאשר שוב את תנאי השיתוף.</p>}
            <Err error={error} />
            <div className="ip-btn-row">
              {isNew && (
                <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                  חזרה
                </Button>
              )}
              <Button type="button" variant="primary" disabled={!detailsOk || busy} onClick={() => (linkChanged ? setStep(3) : void save())}>
                {linkChanged ? 'המשך' : busy ? 'שומרים…' : 'שמירה'}
              </Button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <Card className="ip-gal-consent">
              <strong>{CONSENT_TITLE}</strong>
              {CONSENT_PARAGRAPHS.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </Card>
            <Card className="ip-gal-warning">
              <Tag tone="warning" icon="shield">הקישור בענן</Tag>
              <p>{PUBLIC_LINK_WARNING}</p>
            </Card>
            <label className="ip-gal-check">
              <input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />
              <span>{CONSENT_CHECKBOX}</span>
            </label>
            <Err error={error} />
            <div className="ip-btn-row">
              <Button type="button" variant="ghost" onClick={() => setStep(2)}>
                חזרה
              </Button>
              <Button type="submit" variant="primary" disabled={!f.consent || busy || !detailsOk}>
                {busy ? 'מפרסמים…' : existing ? 'שמירה' : 'פרסום האלבום'}
              </Button>
            </div>
          </>
        )}
      </form>
    </BottomSheet>
  );
}

/* ------------------------------------------------------------ report */

function ReportSheet({
  target,
  onClose,
  onSent,
}: {
  target: { album: Album; reason?: ReportReason } | null;
  onClose: () => void;
  onSent: (message: string) => Promise<void>;
}) {
  const [reason, setReason] = useState<ReportReason>('minor');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setReason(target.reason ?? 'minor');
      setNote('');
      setError(null);
    }
  }, [target]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await reportAlbum(target.album.id, reason, note);
      await onSent(
        reason === 'broken_link'
          ? 'ההורה שפרסם קיבל הודעה לבדוק את הגדרות השיתוף בענן.'
          : 'הדיווח נשלח לצוות הקבוצה, וההורה שפרסם קיבל הודעה (בלי השם שלך).',
      );
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={target !== null} onClose={onClose} title="דיווח על אלבום">
      <form className="ip-form ip-form--sheet ip-gal-form" onSubmit={submit}>
        {target && <p className="ip-muted">{target.album.title}</p>}
        <div className="ip-gal-reasons" role="radiogroup" aria-label="סיבת הדיווח">
          {(Object.keys(reportReasonLabel) as ReportReason[]).map((r) => (
            <label key={r} className={`ip-gal-reason ${reason === r ? 'is-on' : ''}`}>
              <input type="radio" name="gal-reason" checked={reason === r} onChange={() => setReason(r)} />
              <span>{reportReasonLabel[r]}</span>
            </label>
          ))}
        </div>
        <Field label="פרטים (לא חובה)">
          <input id="gal-note" className="ip-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={reason === 'broken_link' ? 'לדוגמה: מבקש ממני לבקש גישה' : ''} />
        </Field>
        <p className="ip-footnote">
          {reason === 'broken_link'
            ? 'ההורה שפרסם יקבל הודעה לבדוק שהקישור פתוח לכל מי שמחזיק בו.'
            : 'צוות הקבוצה יקבל את הדיווח ויכול להסיר את האלבום מהגלריה. דיווח על תמונות של ילדים מטופל קודם.'}
        </p>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שולחים…' : 'שליחת דיווח'}
        </Button>
      </form>
    </BottomSheet>
  );
}

/* ------------------------------------------------------------ moderation (team staff) */

function ModerateSheet({ album, onClose, onDone }: { album: Album | null; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [reports, setReports] = useState<AlbumReport[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!album) return;
    setReason('');
    setError(null);
    setReports([]);
    void albumReports(album.id).then(setReports).catch(() => setReports([]));
  }, [album]);

  async function run(fn: () => Promise<void>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onDone(message);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={album !== null} onClose={onClose} title="ניהול אלבום">
      <div className="ip-form ip-form--sheet ip-gal-form">
        {album && (
          <p className="ip-muted">
            {album.title} · פורסם על ידי {album.publisher}
          </p>
        )}
        {reports.length > 0 ? (
          <Card padded={false}>
            {reports.map((r) => (
              <div key={r.id} className="ip-member">
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">{reportReasonLabel[r.reason]}</span>
                  <span className="ip-list-row-sub">
                    {r.reporter} · {shortDate(r.created_at)}
                    {r.note ? ` · ${r.note}` : ''}
                  </span>
                </span>
              </div>
            ))}
          </Card>
        ) : (
          <p className="ip-muted">אין דיווחים פתוחים על האלבום.</p>
        )}
        <Field label="סיבת ההסרה (תוצג להורה שפרסם)">
          <input id="gal-remove-reason" className="ip-input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="לדוגמה: בקשת הורה מטעמי פרטיות" />
        </Field>
        <p className="ip-footnote">הסרה מסתירה את האלבום מהגלריה בלבד. הקבצים נשארים בענן של ההורה, וההורה מקבל הודעה.</p>
        <Err error={error} />
        <div className="ip-btn-row">
          <Button variant="primary" icon="close" disabled={busy || !album} onClick={() => void run(() => removeAlbum(album!.id, reason), 'האלבום הוסר מהגלריה וההורה שפרסם קיבל הודעה.')}>
            הסרה מהגלריה
          </Button>
          {reports.length > 0 && (
            <Button variant="ghost" disabled={busy || !album} onClick={() => void run(() => dismissAlbumReports(album!.id), 'הדיווחים נסגרו, והאלבום נשאר בגלריה.')}>
              להשאיר ולסגור דיווחים
            </Button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
