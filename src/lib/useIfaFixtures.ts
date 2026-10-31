/**
 * Upcoming IFA fixtures for every team the signed-in user belongs to that is
 * linked to an IFA team. Used by Home and Calendar. Empty when signed out or
 * when no team is linked, so the demo screens stay as they are.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { getIfaMatches, type IfaMatch, type MyTeam } from './api';

export interface TeamFixture {
  team: MyTeam;
  match: IfaMatch;
}

export function useIfaFixtures() {
  const { teams } = useAuth();
  const [fixtures, setFixtures] = useState<TeamFixture[]>([]);
  const [results, setResults] = useState<TeamFixture[]>([]);
  const key = teams.map((t) => `${t.id}:${t.ifa_team_id ?? ''}`).join(',');

  useEffect(() => {
    let alive = true;
    const linked = teams.filter((t) => t.ifa_team_id);
    if (!linked.length) {
      setFixtures([]);
      setResults([]);
      return;
    }
    Promise.all(linked.map(async (team) => (await getIfaMatches(team.ifa_team_id!)).map((match) => ({ team, match }))))
      .then((lists) => {
        if (!alive) return;
        const all = lists.flat();
        const now = Date.now() - 3 * 60 * 60 * 1000; // keep a match visible for 3h after kickoff
        const time = (f: TeamFixture) => (f.match.kickoff ? Date.parse(f.match.kickoff) : Infinity);
        setFixtures(
          all.filter((f) => f.match.status !== 'played' && f.match.status !== 'cancelled' && time(f) >= now).sort((a, b) => time(a) - time(b)),
        );
        setResults(all.filter((f) => f.match.status === 'played').sort((a, b) => time(b) - time(a)));
      })
      .catch(() => {
        // The IFA block is an extra; a failure here must not break the screen.
        if (alive) {
          setFixtures([]);
          setResults([]);
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { fixtures, results };
}
