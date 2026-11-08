import { modules } from './modules';
import { StatusBadge } from './StateView';

/** "What works": the same status board the daily report uses. */
export function StatusScreen() {
  return (
    <section className="os-card">
      <p className="os-muted">כל מסך מסומן לפי המצב האמיתי שלו. מסך "עוד לא מומש" לא מציג נתונים, ונתוני דמו מהעיצובים לא מוצגים בשום מקום.</p>
      <table className="os-table">
        <thead>
          <tr>
            <th>מסך</th>
            <th>מצב</th>
            <th>יום</th>
            <th>מה כולל / מה חסר</th>
          </tr>
        </thead>
        <tbody>
          {modules.map((m) => (
            <tr key={m.id}>
              <td>{m.label}</td>
              <td>
                <StatusBadge status={m.status} />
              </td>
              <td>{m.day}</td>
              <td>
                {m.summary}
                {m.missing && m.missing.length > 0 && <span className="os-muted"> חסר: {m.missing.join(', ')}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
