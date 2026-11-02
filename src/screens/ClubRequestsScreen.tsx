/**
 * #clubrequests — requests to manage a club or join its staff, for the people
 * who approve them (club owner / admins; platform admins for clubs with no
 * admin yet). Platform admins also build the club catalog from IFA teams here.
 */
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Button, Card, EmptyState, SectionHeader, Tag } from '../components/ui';
import { Err } from '../components/form';
import { friendlyError } from '../lib/api';
import { isPlatformAdmin } from '../lib/ifaApi';
import {
  catalogClubTeams,
  clubError,
  clubStatusLabel,
  ifaClubSuggestions,
  pendingClubAccessRequests,
  reviewClubAccess,
  teamRoleLabel,
  type AccessRequest,
  type IfaClubSuggestion,
} from '../lib/clubApi';
import '../theme/club.css';

const errText = (e: unknown) => clubError(e) ?? friendlyError(e);

export function ClubRequestsScreen({ onBack }: { onBack: () => void }) {
  const [requests, setRequests] = useState<AccessRequest[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRequests(await pendingClubAccessRequests());
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    void load();
    void isPlatformAdmin().then(setAdmin);
  }, [load]);

  const review = async (r: AccessRequest, approve: boolean) => {
    const note = approve ? '' : window.prompt('סיבה (לא חובה, תישלח למבקש/ת):') ?? '';
    setError(null);
    try {
      await reviewClubAccess(r.id, approve, note);
      await load();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div className="ip-stack ip-club">
      <div className="ip-backbar">
        <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
          <Icon name="back" size={20} />
        </button>
        <h1>בקשות מועדונים</h1>
        <span />
      </div>
      <Err error={error} />
      <SectionHeader title={requests ? `ממתינות לאישור · ${requests.length}` : 'ממתינות לאישור'} icon="shield" />
      {requests === null ? (
        <p className="ip-muted">טוען…</p>
      ) : requests.length === 0 ? (
        <Card>
          <EmptyState icon="check" title="אין בקשות ממתינות" text="בקשות לנהל מועדון או להצטרף לצוות יופיעו כאן." />
        </Card>
      ) : (
        <Card padded={false}>
          {requests.map((r) => (
            <div key={r.id} className="ip-club-row ip-club-request">
              <span className="ip-list-row-text">
                <span className="ip-list-row-title">
                  {r.requester} · {r.kind === 'club_admin' ? 'רוצה לנהל את ' : `${teamRoleLabel[r.team_role]} ב`}
                  {r.club_name}
                </span>
                <span className="ip-club-tags">
                  {r.club_city && <span className="ip-list-row-sub">{r.club_city}</span>}
                  {!r.managed && <Tag tone="warning">{clubStatusLabel.catalog}</Tag>}
                  {r.role_title && <Tag tone="navy">{r.role_title}</Tag>}
                  {r.teams.map((t) => (
                    <Tag key={t.id}>{t.name}</Tag>
                  ))}
                </span>
                {r.message && <span className="ip-list-row-sub">“{r.message}”</span>}
                {r.contact_phone && (
                  <a className="ip-list-row-sub" href={`tel:${r.contact_phone}`} dir="ltr">
                    {r.contact_phone}
                  </a>
                )}
                {!r.managed && r.kind === 'club_admin' && (
                  <span className="ip-list-row-sub">למועדון אין עדיין מנהל: אמתו את הזהות (למשל בטלפון) לפני האישור. המאשר הראשון הופך לבעלים.</span>
                )}
              </span>
              <Button variant="primary" size="sm" onClick={() => review(r, true)}>
                אישור
              </Button>
              <Button variant="ghost" size="sm" onClick={() => review(r, false)}>
                דחייה
              </Button>
            </div>
          ))}
        </Card>
      )}
      {admin && <IfaCatalog />}
    </div>
  );
}

/** Platform admin: turn imported IFA teams into catalog clubs (no owner until a request is approved). */
function IfaCatalog() {
  const [rows, setRows] = useState<IfaClubSuggestion[] | null>(null);
  const [edits, setEdits] = useState<Record<string, { name: string; city: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await ifaClubSuggestions());
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) {
    return (
      <Button variant="secondary" icon="grid" onClick={() => setOpen(true)}>
        מאגר מועדונים מנתוני ההתאחדות
      </Button>
    );
  }

  const value = (r: IfaClubSuggestion) => edits[r.base_name] ?? { name: r.base_name, city: (r.venue_hint ?? '').split(/[\s-]/)[0] ?? '' };

  return (
    <section className="ip-stack">
      <SectionHeader title={rows ? `קבוצות התאחדות בלי מועדון · ${rows.length}` : 'קבוצות התאחדות בלי מועדון'} icon="grid" />
      <p className="ip-muted ip-club-hint">
        הקבוצות קובצו לפי שם המועדון (בלי תגית החסות). בדקו שם ועיר ולחצו "הוספה למאגר". המועדון נוצר בלי בעלים, ומופיע בחיפוש לפי עיר עד שמישהו יאושר לנהל אותו.
      </p>
      <Err error={error} />
      {rows === null ? (
        <p className="ip-muted">טוען…</p>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon="check" title="הכול משויך" text="כל קבוצות ההתאחדות שיובאו כבר שייכות למועדון." />
        </Card>
      ) : (
        <Card padded={false}>
          {rows.map((r) => {
            const v = value(r);
            return (
              <div key={r.base_name} className="ip-club-row">
                <span className="ip-list-row-text">
                  <span className="ip-club-grid">
                    <input
                      className="ip-input"
                      value={v.name}
                      maxLength={80}
                      aria-label="שם המועדון"
                      onChange={(e) => setEdits((x) => ({ ...x, [r.base_name]: { ...v, name: e.target.value } }))}
                    />
                    <input
                      className="ip-input"
                      value={v.city}
                      maxLength={60}
                      aria-label="עיר"
                      placeholder="עיר"
                      onChange={(e) => setEdits((x) => ({ ...x, [r.base_name]: { ...v, city: e.target.value } }))}
                    />
                  </span>
                  <span className="ip-list-row-sub">
                    {r.team_names.join(' · ')}
                    {r.venue_hint ? ` · מגרש בית: ${r.venue_hint}` : ''}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!v.name.trim() || !v.city.trim()}
                  onClick={() =>
                    catalogClubTeams({ clubId: r.existing_club, name: v.name, city: v.city, teamIds: r.team_ids })
                      .then(load)
                      .catch((e) => setError(errText(e)))
                  }
                >
                  {r.existing_club ? 'צירוף למועדון הקיים' : 'הוספה למאגר'}
                </Button>
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}
