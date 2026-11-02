/**
 * A player's confidential professional file inside one club (spec section 9).
 * Notes belong to the club: they stay when the coach leaves, are visible to
 * club staff with "pro_notes" access, never to the player's parents, and
 * never to another club. The database decides who sees what.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/shell';
import { Button, EmptyState, Tag } from '../components/ui';
import { Icon } from '../components/Icon';
import { Err, Field } from '../components/form';
import { useAuth } from '../auth/AuthContext';
import { friendlyError } from '../lib/api';
import {
  addProNote,
  archiveProNote,
  clubError,
  listProNotes,
  proNoteKindLabel,
  proNotesLevel,
  updateProNote,
  type ProNote,
  type ProNoteKind,
} from '../lib/clubApi';

const errText = (e: unknown) => clubError(e) ?? friendlyError(e);
const kinds = Object.keys(proNoteKindLabel) as ProNoteKind[];

export function ProNotesSheet({
  clubId,
  clubName,
  player,
  teamId,
  onClose,
}: {
  clubId: string;
  clubName: string;
  player: { id: string; name: string };
  teamId?: string | null;
  onClose: () => void;
}) {
  const { session } = useAuth();
  const me = session?.user.id;
  const [level, setLevel] = useState<number | null>(null);
  const [notes, setNotes] = useState<ProNote[]>([]);
  const [kind, setKind] = useState<ProNoteKind>('note');
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<ProNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const l = await proNotesLevel(clubId, player.id);
      setLevel(l);
      setNotes(l > 0 ? await listProNotes(clubId, player.id) : []);
    } catch (e) {
      setError(errText(e));
    }
  }, [clubId, player.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    void run(async () => {
      if (editing) await updateProNote(editing.id, kind, body);
      else await addProNote({ clubId, playerId: player.id, kind, body, teamId });
      setBody('');
      setKind('note');
      setEditing(null);
    });
  };

  const canEdit = (n: ProNote) => (level ?? 0) >= 3 || ((level ?? 0) >= 2 && n.author_id === me);
  const canArchive = (n: ProNote) => (level ?? 0) >= 4 || ((level ?? 0) >= 2 && n.author_id === me);

  return (
    <BottomSheet open onClose={onClose} title={`תיק מקצועי · ${player.name}`}>
      <div className="ip-stack ip-stack--tight">
        <p className="ip-muted ip-club-hint">
          <Icon name="shield" size={14} /> פנימי ל{clubName}. לא מוצג להורים או לשחקן באפליקציה, ונשאר במועדון גם אם המאמן עוזב. לא עובר למועדון אחר.
        </p>
        <Err error={error} />
        {level === null ? (
          <p className="ip-muted">טוען…</p>
        ) : level === 0 ? (
          <EmptyState icon="shield" title="אין גישה" text="אין לך הרשאה להערות המקצועיות של השחקן הזה." />
        ) : (
          <>
            {level >= 2 && (
              <form className="ip-stack ip-stack--tight" onSubmit={submit}>
                <Field label="סוג">
                  <select className="ip-input" value={kind} onChange={(e) => setKind(e.target.value as ProNoteKind)}>
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {proNoteKindLabel[k]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={editing ? 'עריכת הערה' : 'הערה חדשה'}>
                  <textarea className="ip-input" rows={4} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
                </Field>
                <Button type="submit" variant="primary" disabled={busy || !body.trim()}>
                  {editing ? 'שמירת שינוי' : 'הוספה'}
                </Button>
                {editing && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditing(null);
                      setBody('');
                    }}
                  >
                    ביטול עריכה
                  </Button>
                )}
              </form>
            )}
            {notes.length === 0 ? (
              <EmptyState icon="chat" title="עוד אין הערות" text="הערות מקצועיות, נקודות לשיפור וסיכומי אימונים יופיעו כאן." />
            ) : (
              <ul className="ip-club-notes">
                {notes.map((n) => (
                  <li key={n.id}>
                    <div className="ip-club-tags">
                      <Tag tone="navy">{proNoteKindLabel[n.kind]}</Tag>
                      <span className="ip-list-row-sub">
                        {n.author_name} · {new Date(n.created_at).toLocaleDateString('he-IL')}
                        {n.updated_at ? ' · נערך' : ''}
                      </span>
                    </div>
                    <p className="ip-club-note-body">{n.body}</p>
                    <div className="ip-club-tags">
                      {canEdit(n) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(n);
                            setKind(n.kind);
                            setBody(n.body);
                          }}
                        >
                          עריכה
                        </Button>
                      )}
                      {canArchive(n) && (
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => archiveProNote(n.id))}>
                          העברה לארכיון
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
