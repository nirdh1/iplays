/**
 * IFA roster review for team staff. A newer saved roster page from the IFA
 * site only proposes changes; the roster stays as it is until staff accept a
 * change. "Keep" leaves the roster as it is and is not asked again.
 */
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Button, Card, SectionHeader } from '../components/ui';
import { friendlyError } from '../lib/api';
import { decideRosterChanges, myRosterReviewCounts, teamRosterReview, type RosterReviewRow } from '../lib/ifaApi';

const KIND_LABEL: Record<RosterReviewRow['kind'], string> = {
  added: 'שחקן חדש בסגל ההתאחדות',
  missing: 'לא מופיע בסגל ההתאחדות',
  returned: 'חזר לסגל ההתאחדות',
  renamed: 'שם שונה באתר ההתאחדות',
};

function rowTitle(r: RosterReviewRow): string {
  if (r.kind === 'renamed') return `${r.old_value ?? ''} ← ${r.new_value ?? ''}`;
  return r.player_name || r.new_value || r.old_value || 'שחקן';
}

function rowHint(r: RosterReviewRow): string {
  switch (r.kind) {
    case 'added':
      return 'אישור יוסיף אותו לסגל';
    case 'missing':
      return 'ייתכן שעזב, וייתכן שהאתר עוד לא עודכן. אישור יוציא אותו מהסגל, וההיסטוריה שלו נשמרת';
    case 'returned':
      return 'אישור יחזיר אותו לסגל';
    case 'renamed':
      return 'אישור יעדכן את השם, אלא אם ההורה כבר ערך אותו';
  }
}

/** Home screen: one line per team with differences waiting. */
export function RosterReviewHomeCard() {
  const [rows, setRows] = useState<{ team_id: string; team_name: string; pending: number }[]>([]);
  useEffect(() => {
    void myRosterReviewCounts().then(setRows);
  }, []);
  if (!rows.length) return null;
  return (
    <>
      {rows.map((t) => (
        <button
          key={t.team_id}
          type="button"
          className="ip-card ip-card--padded ip-coach-entry"
          onClick={() => (window.location.hash = `myteam/${t.team_id}`)}
        >
          <span className="ip-icon-tile ip-icon-tile--lime">
            <Icon name="team" size={20} />
          </span>
          <span className="ip-list-row-text">
            <span className="ip-list-row-title">
              עדכוני סגל מההתאחדות · {t.pending}
            </span>
            <span className="ip-list-row-sub">{t.team_name} · ממתינים לאישורך</span>
          </span>
          <Icon name="chevron" size={18} className="ip-muted" />
        </button>
      ))}
    </>
  );
}

/** Team screen (staff): the differences, each with accept / keep, plus bulk. */
export function RosterReviewSection({ teamId, onChanged }: { teamId: string; onChanged: () => void }) {
  const [rows, setRows] = useState<RosterReviewRow[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await teamRosterReview(teamId);
    setRows(r);
    setPicked(new Set(r.map((x) => x.id)));
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!rows.length) return null;

  async function decide(ids: number[], accept: boolean) {
    if (!ids.length) return;
    setBusy(true);
    setError(null);
    try {
      await decideRosterChanges(ids, accept);
      await load();
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const chosen = rows.filter((r) => picked.has(r.id)).map((r) => r.id);

  return (
    <section>
      <SectionHeader title={`עדכוני סגל מההתאחדות · ${rows.length}`} icon="bell" />
      <Card padded={false}>
        <p className="ip-muted ip-pad">נמצאו הבדלים בין דף הסגל באתר ההתאחדות לבין הסגל כאן. עד שתאשר, הסגל נשאר כמו שהוא.</p>
        {rows.map((r) => (
          <div key={r.id} className="ip-member ip-request">
            <label className="ip-check" style={{ flex: 1, minWidth: 0 }}>
              <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} disabled={busy} />
              <span className="ip-list-row-text">
                <span className="ip-list-row-title">
                  {rowTitle(r)}
                  {r.shirt_number != null && ` · ${r.shirt_number}`}
                </span>
                <span className="ip-list-row-sub">
                  {KIND_LABEL[r.kind]} · {rowHint(r)}
                </span>
              </span>
            </label>
            <span className="ip-find-actions">
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void decide([r.id], true)}>
                אשר
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void decide([r.id], false)}>
                השאר
              </Button>
            </span>
          </div>
        ))}
        {error && <p className="ip-error ip-pad" role="alert">{error}</p>}
        {rows.length > 1 && (
          <div className="ip-btn-row ip-pad">
            <Button variant="primary" icon="check" disabled={busy || !chosen.length} onClick={() => void decide(chosen, true)}>
              אשר נבחרים ({chosen.length})
            </Button>
            <Button variant="secondary" disabled={busy || !chosen.length} onClick={() => void decide(chosen, false)}>
              השאר את הקיים לנבחרים
            </Button>
          </div>
        )}
      </Card>
    </section>
  );
}
