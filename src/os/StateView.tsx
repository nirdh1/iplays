import type { ReactNode } from 'react';
import { statusLabel, type ModuleStatus, type OsModule } from './modules';

/** Small pill: פעיל / חלקי / עוד לא מומש. */
export function StatusBadge({ status }: { status: ModuleStatus }) {
  return <span className={`os-badge os-badge--${status}`}>{statusLabel[status]}</span>;
}

export type DataSource = 'db' | 'coach' | 'parent' | 'self' | 'ifa' | 'synthetic';
const sourceLabel: Record<DataSource, string> = {
  db: 'מהמסד',
  coach: 'דיווח מאמן',
  parent: 'דיווח הורה',
  self: 'דיווח עצמי',
  ifa: 'IFA',
  synthetic: 'נתון בדוי (Staging)',
};

/** Where a number came from. Every number on a Club OS screen carries one. */
export function SourceTag({ source }: { source: DataSource }) {
  return <span className={`os-source os-source--${source}`}>{sourceLabel[source]}</span>;
}

/** A whole screen that is not built yet: says so, shows no numbers. */
export function NotBuilt({ module }: { module: OsModule }) {
  return (
    <section className="os-state os-state--planned" aria-live="polite">
      <StatusBadge status="planned" />
      <h2>{module.label}</h2>
      <p>{module.summary}</p>
      <p className="os-muted">המסך הזה עוד לא מומש (מתוכנן ליום {module.day} של ה-MVP). אין כאן נתונים, ולכן לא מוצג שום מספר.</p>
    </section>
  );
}

/** A real query that returned nothing useful. Never shows 0 in place of "unknown". */
export function NoData({ children }: { children?: ReactNode }) {
  return <p className="os-state os-state--empty">{children ?? 'אין מספיק נתונים'}</p>;
}

export function Loading() {
  return <p className="os-state os-muted" aria-busy="true">טוען…</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="os-state os-state--error" role="alert">
      {message}
    </p>
  );
}
