/**
 * The parent fills in the child's shirt number in this team (not in the IFA
 * data, and it can change) and the child's kit: how many summer / winter /
 * home / away sets, socks, and sizes.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/shell';
import { Button } from '../components/ui';
import { Err, Field } from '../components/form';
import { friendlyError, type Player } from '../lib/api';
import { emptyKit, getKit, joinError, setKit, setShirtNumber, type Kit } from '../lib/joinApi';

const counts: { key: keyof Kit; label: string }[] = [
  { key: 'summer_sets', label: 'סטים קיץ' },
  { key: 'winter_sets', label: 'סטים חורף' },
  { key: 'home_sets', label: 'סטים בית' },
  { key: 'away_sets', label: 'סטים חוץ' },
  { key: 'socks', label: 'זוגות גרביים' },
];

export function ChildDetailsSheet({
  player,
  teamId,
  onClose,
  onSaved,
}: {
  player: Player | null;
  teamId: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [shirt, setShirt] = useState('');
  const [kit, setK] = useState<Kit>(emptyKit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!player) return;
    setError(null);
    setShirt(player.shirt_number != null ? String(player.shirt_number) : '');
    setK(emptyKit);
    getKit(player.id)
      .then((k) => k && setK(k))
      .catch(() => undefined);
  }, [player]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!player) return;
    setBusy(true);
    setError(null);
    try {
      const n = shirt === '' ? null : Number(shirt);
      if (n !== player.shirt_number) await setShirtNumber(player.id, teamId, n);
      await setKit(player.id, kit);
      await onSaved();
      onClose();
    } catch (err) {
      setError(joinError(err) ?? friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const step = (key: keyof Kit, d: number) => setK((k) => ({ ...k, [key]: Math.max(0, Math.min(20, (k[key] as number) + d)) }));

  return (
    <BottomSheet open={player !== null} onClose={onClose} title={player ? `${player.first_name}: חולצה וציוד` : 'חולצה וציוד'}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="מספר חולצה בקבוצה הזו">
          <input id="kit-shirt" className="ip-input" inputMode="numeric" dir="ltr" value={shirt} onChange={(e) => setShirt(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="לדוגמה: 10" />
        </Field>
        <p className="ip-footnote">מספר החולצה לא מגיע מההתאחדות. אפשר לשנות אותו בכל זמן.</p>

        <h3 className="ip-club-h3">ציוד שיש לילד</h3>
        <div className="ip-kit-grid">
          {counts.map((c) => (
            <div key={c.key} className="ip-kit-count">
              <span>{c.label}</span>
              <span className="ip-kit-stepper">
                <button type="button" aria-label={`פחות ${c.label}`} onClick={() => step(c.key, -1)}>
                  −
                </button>
                <strong>{kit[c.key] as number}</strong>
                <button type="button" aria-label={`עוד ${c.label}`} onClick={() => step(c.key, 1)}>
                  +
                </button>
              </span>
            </div>
          ))}
        </div>

        <h3 className="ip-club-h3">מידות</h3>
        <div className="ip-field-row">
          <Field label="חולצה">
            <input id="kit-shirt-size" className="ip-input" dir="ltr" value={kit.shirt_size} onChange={(e) => setK({ ...kit, shirt_size: e.target.value.slice(0, 10) })} placeholder="10 / S / M" />
          </Field>
          <Field label="מכנס">
            <input id="kit-pants-size" className="ip-input" dir="ltr" value={kit.pants_size} onChange={(e) => setK({ ...kit, pants_size: e.target.value.slice(0, 10) })} placeholder="10 / S / M" />
          </Field>
          <Field label="נעליים">
            <input id="kit-shoe-size" className="ip-input" dir="ltr" value={kit.shoe_size} onChange={(e) => setK({ ...kit, shoe_size: e.target.value.slice(0, 10) })} placeholder="33" />
          </Field>
        </div>
        <Field label="הערות">
          <input id="kit-notes" className="ip-input" value={kit.notes} onChange={(e) => setK({ ...kit, notes: e.target.value.slice(0, 200) })} placeholder="לא חובה" />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}
