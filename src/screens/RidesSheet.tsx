/**
 * Carpools for one training or match: who drives, free seats, which children
 * still need a ride. A parent seats their own child, asks for a ride, or
 * offers one. Everything here is visible to the team's members only.
 */
import { useCallback, useEffect, useState } from 'react';
import { BottomSheet } from '../components/shell';
import { Button, MetaRow, Segmented, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { Icon } from '../components/Icon';
import { friendlyError } from '../lib/api';
import type { EventKind } from '../lib/matchApi';
import {
  cancelRide,
  directionLabel,
  getEventRides,
  joinRide,
  leaveRide,
  offerRide,
  rideError,
  setRideNeed,
  type EventRides,
  type Ride,
  type RideDirection,
} from '../lib/rideApi';

export interface RideEvent {
  kind: EventKind;
  id: string;
  title: string;
  /** e.g. "יום שלישי, 4.11 · 17:30" */
  when: string;
}

export interface MyKid {
  id: string;
  first_name: string;
}

const dirs: { id: RideDirection; label: string }[] = [
  { id: 'to', label: directionLabel.to },
  { id: 'from', label: directionLabel.from },
  { id: 'both', label: directionLabel.both },
];

const overlaps = (a: RideDirection, b: RideDirection) => a === b || a === 'both' || b === 'both';

export function RidesSheet({ event, me, myKids, onClose, onChanged }: { event: RideEvent | null; me: string; myKids: MyKid[]; onClose: () => void; onChanged?: () => void }) {
  const [data, setData] = useState<EventRides | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offering, setOffering] = useState(false);

  const load = useCallback(async () => {
    if (!event) return;
    try {
      setData(await getEventRides(event.kind, event.id));
    } catch (e) {
      setError(rideError(e) ?? friendlyError(e));
    }
  }, [event]);

  useEffect(() => {
    setData(null);
    setError(null);
    setOffering(false);
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged?.();
    } catch (e) {
      setError(rideError(e) ?? friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const mine = data?.rides.find((r) => r.driver_id === me) ?? null;
  const seatedIn = (kid: string) => data?.rides.filter((r) => r.passengers.some((p) => p.player_id === kid)) ?? [];
  const needOf = (kid: string) => data?.needs.find((n) => n.player_id === kid) ?? null;

  return (
    <BottomSheet open={event !== null} onClose={onClose} title={event ? `הסעות · ${event.title}` : 'הסעות'}>
      <div className="ip-form ip-form--sheet">
        {event && <p className="ip-muted">{event.when}</p>}
        <Err error={error} />
        {data === null ? (
          !error && <p className="ip-muted">טוען…</p>
        ) : (
          <>
            {myKids.length > 0 && (
              <section className="ip-stack ip-stack--tight">
                <strong>{myKids.length > 1 ? 'הילדים שלי' : myKids[0].first_name}</strong>
                {myKids.map((k) => {
                  const rides = seatedIn(k.id);
                  const need = needOf(k.id);
                  return (
                    <div key={k.id} className="ip-ride-kid">
                      {myKids.length > 1 && <span className="ip-ride-kid-name">{k.first_name}</span>}
                      {rides.map((r) => (
                        <p key={r.id} className="ip-muted">
                          <Icon name="car" size={16} /> עם {r.driver_name} ({directionLabel[r.direction]})
                        </p>
                      ))}
                      {need && (
                        <p className="ip-muted">
                          <Tag tone="warning">צריך הסעה · {directionLabel[need.direction]}</Tag>
                        </p>
                      )}
                      <div className="ip-att-marks" role="group" aria-label={`${k.first_name} צריך הסעה`}>
                        {dirs.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            disabled={busy}
                            className={need?.direction === d.id ? 'is-on' : ''}
                            onClick={() => void run(() => setRideNeed(event!.kind, event!.id, k.id, need?.direction === d.id ? null : d.id))}
                          >
                            צריך {d.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            <section className="ip-stack ip-stack--tight">
              <strong>{data.rides.length ? 'מי נוהג' : 'עוד אין הסעות'}</strong>
              {data.rides.map((r) => (
                <RideCard
                  key={r.id}
                  r={r}
                  me={me}
                  myKids={myKids}
                  busy={busy}
                  canSeat={(kid) => r.passengers.length < r.seats && !seatedIn(kid).some((o) => o.id !== r.id && overlaps(o.direction, r.direction))}
                  onJoin={(kid) => run(() => joinRide(r.id, kid))}
                  onLeave={(kid) => run(() => leaveRide(r.id, kid))}
                  onEdit={() => setOffering(true)}
                  onCancel={() => {
                    if (confirm('לבטל את ההסעה? הילדים שרשומים בה יסומנו שוב כצריכים הסעה.')) void run(() => cancelRide(r.id));
                  }}
                />
              ))}
            </section>

            {data.needs.length > 0 && (
              <section className="ip-stack ip-stack--tight">
                <strong>צריכים הסעה</strong>
                <ul className="ip-ride-needs">
                  {data.needs.map((n) => (
                    <li key={n.player_id}>
                      {n.first_name} · {directionLabel[n.direction]}
                      {n.note && <span className="ip-muted"> · {n.note}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {offering ? (
              <OfferForm
                existing={mine}
                busy={busy}
                onCancel={() => setOffering(false)}
                onSubmit={(v) =>
                  run(async () => {
                    await offerRide(event!.kind, event!.id, v);
                    setOffering(false);
                  })
                }
              />
            ) : (
              !mine && (
                <Button variant="primary" block icon="car" onClick={() => setOffering(true)} disabled={busy}>
                  אני יכול/ה להסיע
                </Button>
              )
            )}
            <p className="ip-footnote">רק חברי הקבוצה רואים את ההסעות. מהילדים מוצג רק השם הפרטי.</p>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

function RideCard({
  r,
  me,
  myKids,
  busy,
  canSeat,
  onJoin,
  onLeave,
  onEdit,
  onCancel,
}: {
  r: Ride;
  me: string;
  myKids: MyKid[];
  busy: boolean;
  canSeat: (kid: string) => boolean;
  onJoin: (kid: string) => void;
  onLeave: (kid: string) => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const isDriver = r.driver_id === me;
  const myIds = new Set(myKids.map((k) => k.id));
  const free = r.seats - r.passengers.length;
  return (
    <div className="ip-ride">
      <div className="ip-carpool-head">
        <strong>{isDriver ? 'אני נוהג/ת' : r.driver_name}</strong>
        <Tag tone={free > 0 ? 'lime' : 'neutral'}>{directionLabel[r.direction]}</Tag>
      </div>
      {(r.leaves_at || r.meet_point) && (
        <MetaRow icon="clock">{[r.leaves_at && `יציאה ${r.leaves_at}`, r.meet_point].filter(Boolean).join(' · ')}</MetaRow>
      )}
      {r.note && <MetaRow icon="chat">{r.note}</MetaRow>}
      {!isDriver && r.driver_phone && (
        <a className="ip-link" href={`tel:${r.driver_phone}`} dir="ltr">
          {r.driver_phone}
        </a>
      )}
      <div className="ip-seats" aria-label={`${r.passengers.length} מתוך ${r.seats} מקומות תפוסים`}>
        {Array.from({ length: r.seats }, (_, i) => {
          const p = r.passengers[i];
          return (
            <span key={i} className={`ip-seat ${p ? 'is-taken' : ''}`} title={p?.first_name}>
              {p ? p.first_name[0] : ''}
            </span>
          );
        })}
        <span className="ip-muted">{free > 0 ? `${free} פנויים` : 'מלא'}</span>
      </div>
      {r.passengers.length > 0 && (
        <ul className="ip-ride-pass">
          {r.passengers.map((p) => (
            <li key={p.player_id}>
              {p.first_name}
              {(isDriver || myIds.has(p.player_id)) && (
                <button type="button" className="ip-link" disabled={busy} onClick={() => onLeave(p.player_id)}>
                  הוצאה
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="ip-btn-row">
        {myKids
          .filter((k) => !r.passengers.some((p) => p.player_id === k.id) && canSeat(k.id))
          .map((k) => (
            <Button key={k.id} variant="secondary" size="sm" icon="plus" disabled={busy} onClick={() => onJoin(k.id)}>
              {myKids.length > 1 || !isDriver ? `להושיב את ${k.first_name}` : `${k.first_name} איתי`}
            </Button>
          ))}
        {isDriver && (
          <>
            <Button variant="secondary" size="sm" disabled={busy} onClick={onEdit}>
              עריכה
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
              ביטול ההסעה
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function OfferForm({
  existing,
  busy,
  onSubmit,
  onCancel,
}: {
  existing: Ride | null;
  busy: boolean;
  onSubmit: (v: { direction: RideDirection; seats: number; leavesAt: string | null; meetPoint: string; note: string }) => void;
  onCancel: () => void;
}) {
  const [direction, setDirection] = useState<RideDirection>(existing?.direction ?? 'both');
  const [seats, setSeats] = useState(existing?.seats ?? 3);
  const [leavesAt, setLeavesAt] = useState(existing?.leaves_at ?? '');
  const [meetPoint, setMeetPoint] = useState(existing?.meet_point ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const minSeats = Math.max(1, existing?.passengers.length ?? 0);
  return (
    <form
      className="ip-ride-offer ip-stack ip-stack--tight"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ direction, seats, leavesAt: leavesAt || null, meetPoint: meetPoint.trim(), note: note.trim() });
      }}
    >
      <strong>{existing ? 'עריכת ההסעה שלי' : 'הצעת הסעה'}</strong>
      <Segmented label="כיוון" items={dirs} value={direction} onChange={setDirection} />
      <Field label="מקומות פנויים לילדים">
        <select className="ip-input" value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
          {Array.from({ length: 8 }, (_, i) => i + 1)
            .filter((n) => n >= minSeats)
            .map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
        </select>
      </Field>
      <Field label="שעת יציאה (לא חובה)">
        <input className="ip-input" type="time" value={leavesAt} onChange={(e) => setLeavesAt(e.target.value)} />
      </Field>
      <Field label="נקודת איסוף (לא חובה)">
        <input className="ip-input" maxLength={80} value={meetPoint} onChange={(e) => setMeetPoint(e.target.value)} placeholder="למשל: ליד בית הספר" />
      </Field>
      <Field label="הערה (לא חובה)">
        <input className="ip-input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="ip-btn-row">
        <Button type="submit" variant="primary" icon="check" disabled={busy}>
          {existing ? 'שמירה' : 'פרסום ההסעה'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </form>
  );
}
