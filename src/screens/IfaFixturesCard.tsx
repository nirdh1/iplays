/**
 * League fixtures from the IFA for the user's linked teams. Shown on Home
 * (next few) and Calendar (all upcoming). Renders nothing when no team is
 * linked.
 */
import { Card, SectionHeader } from '../components/ui';
import { useIfaFixtures } from '../lib/useIfaFixtures';
import { IfaFixture } from './IfaSection';

export const IFA_DISCLAIMER =
  'המועדים לפי הפרסום באתר ההתאחדות לכדורגל. בכל סתירה, הקובע הוא פרסום ההתאחדות והודעת המאמן. iplays עצמאית ואינה מטעם ההתאחדות.';

export function IfaFixturesCard({ limit, title = 'משחקי ליגה מההתאחדות' }: { limit?: number; title?: string }) {
  const { fixtures, results } = useIfaFixtures();
  const upcoming = limit ? fixtures.slice(0, limit) : fixtures;
  const last = results[0];
  if (!upcoming.length && !last) return null;
  const many = new Set(fixtures.map((f) => f.team.id)).size > 1;
  return (
    <section>
      <SectionHeader title={title} icon="shield" />
      <Card padded={false}>
        {upcoming.map(({ team, match }) => (
          <div key={`${team.id}-${match.id}`}>
            {many && <p className="ip-muted ip-ifa-team-label">{team.name}</p>}
            <IfaFixture m={match} ours={team.ifa_team_id!} />
          </div>
        ))}
        {!limit || !upcoming.length
          ? last && (
              <div>
                <p className="ip-muted ip-ifa-team-label">תוצאה אחרונה{many ? ` · ${last.team.name}` : ''}</p>
                <IfaFixture m={last.match} ours={last.team.ifa_team_id!} />
              </div>
            )
          : null}
      </Card>
      <p className="ip-footnote">{IFA_DISCLAIMER}</p>
    </section>
  );
}
