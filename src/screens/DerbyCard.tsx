/**
 * "Derby" card on the parent / player home (user 2026-11-09): the child's birth
 * year in the sister clubs of the house (north / south / center) side by side,
 * to push kids to train more, personal trainings included. Team averages only:
 * team_derby() never returns a child's own numbers.
 */
import { useCallback, useEffect, useState } from 'react';
import { Card, SectionHeader } from '../components/ui';
import { supabase } from '../lib/supabase';
import type { MyTeam, Player } from '../lib/api';
import { AddTrainingButton } from './CalendarExtras';

export interface DerbyArea {
  area: string;
  teams: number;
  enough: boolean;
  kids: number | null;
  team_per_week: number | null;
  personal_per_kid_week: number | null;
  pct_kids_personal: number | null;
  personal_total: number | null;
}
export interface Derby {
  birth_year: number;
  weeks: number;
  our_area: string;
  areas: DerbyArea[];
  /** the caller's own children in this team only */
  mine?: { player_id: string; first_name: string; personal: number }[];
}

/** Trainings per kid per week: team trainings held + personal ones logged. */
export const totalPerWeek = (a: DerbyArea) => (a.team_per_week === null || a.personal_per_kid_week === null ? null : a.team_per_week + a.personal_per_kid_week);

/** The headline that pushes: who leads and by how much, from our side. */
export function derbyHeadline(d: Derby): string {
  const ours = d.areas.find((a) => a.area === d.our_area);
  const others = d.areas.filter((a) => a.area !== d.our_area && a.enough);
  if (!ours?.enough || !others.length) return '';
  const best = [...others].sort((a, b) => (b.personal_per_kid_week ?? 0) - (a.personal_per_kid_week ?? 0))[0];
  const diff = (best.personal_per_kid_week ?? 0) - (ours.personal_per_kid_week ?? 0);
  const perMonth = Math.round(Math.abs(diff) * 4 * 10) / 10;
  if (perMonth < 0.5) return `צמוד! ${d.our_area} ו${best.area} מתאמנים אישית כמעט אותו דבר. אימון אחד נוסף השבוע יכריע.`;
  if (diff > 0) return `ילדי ${best.area} עשו בממוצע ${perMonth} אימונים אישיים יותר בחודש מילדי ${d.our_area}. הגיע הזמן לסגור את הפער!`;
  return `${d.our_area} מובילים! ילדי ${d.our_area} עשו בממוצע ${perMonth} אימונים אישיים יותר בחודש מילדי ${best.area}. שומרים על היתרון?`;
}

const fmt = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits));

export function DerbyHomeCard({ team, kids }: { team: MyTeam; kids: (Player & { team: MyTeam })[] }) {
  const [d, setD] = useState<Derby | null | undefined>(undefined);
  const load = useCallback(() => {
    if (!supabase) return setD(null);
    supabase
      .rpc('team_derby', { p_team: team.id, p_weeks: 4 })
      .then(({ data, error }) => setD(error || !data ? null : (data as Derby)));
  }, [team.id]);
  useEffect(load, [load]);
  if (!d) return null;
  const shown = d.areas.filter((a) => a.enough);
  if (shown.length < 2) return null;
  const maxTotal = Math.max(...shown.map((a) => totalPerWeek(a) ?? 0), 1);
  const headline = derbyHeadline(d);
  const myKids = kids.filter((k) => k.team.id === team.id);
  return (
    <section>
      <SectionHeader title={`הדרבי של שנתון ${d.birth_year}: ${shown.map((a) => a.area).join(' מול ')}`} icon="trophy" />
      <Card className="ip-derby">
        {headline && <p className="ip-derby-headline">{headline}</p>}
        <div className="ip-derby-areas">
          {shown.map((a) => {
            const total = totalPerWeek(a) ?? 0;
            const teamW = ((a.team_per_week ?? 0) / maxTotal) * 100;
            const persW = ((a.personal_per_kid_week ?? 0) / maxTotal) * 100;
            return (
              <div key={a.area} className={`ip-derby-area${a.area === d.our_area ? ' is-us' : ''}`}>
                <div className="ip-derby-row">
                  <strong>
                    {a.area}
                    {a.area === d.our_area ? ' (אנחנו)' : ''}
                  </strong>
                  <span className="ip-derby-total">{fmt(total)} אימונים לילד בשבוע</span>
                </div>
                <div className="ip-derby-bar" aria-hidden="true">
                  <span className="ip-derby-bar-team" style={{ inlineSize: `${teamW}%` }} />
                  <span className="ip-derby-bar-personal" style={{ inlineSize: `${persW}%` }} />
                </div>
                <div className="ip-derby-sub">
                  <span>קבוצתיים {fmt(a.team_per_week)}</span>
                  <span>אישיים {fmt(a.personal_per_kid_week)}</span>
                  <span>{a.pct_kids_personal ?? 0}% מהילדים מתאמנים גם אישית</span>
                  <span>סה״כ {a.personal_total ?? 0} אימונים אישיים</span>
                </div>
              </div>
            );
          })}
        </div>
        <ul className="ip-derby-legend">
          <li className="is-team">אימון קבוצתי</li>
          <li className="is-personal">אימון אישי</li>
        </ul>
        {(d.mine ?? []).map((k) => (
          <p key={k.player_id} className="ip-derby-mine">
            {k.personal > 0
              ? `${k.first_name}: ${k.personal} אימונים אישיים ב־${d.weeks} השבועות האחרונים, וכולם נספרים ל${d.our_area}. כל אימון נוסף מקרב את ${d.our_area} לניצחון.`
              : `${k.first_name}: עוד אין אימון אישי ב־${d.weeks} השבועות האחרונים. כל אימון אישי שתוסיפו נספר ל${d.our_area}.`}
          </p>
        ))}
        {myKids.length > 0 && (
          <AddTrainingButton teams={[team]} kids={myKids} onAdded={load} label="עשיתי אימון אישי? להוסיף כאן" variant="primary" logDone />
        )}
        <p className="ip-muted ip-derby-note">
          ממוצעים של כל השנתון ב־{d.weeks} השבועות האחרונים. אימונים אישיים נספרים כשהמשפחה מוסיפה אותם ליומן. אף ילד לא מוצג בשמו, ופרטי האימון האישי נשארים אצלכם.
        </p>
      </Card>
    </section>
  );
}
