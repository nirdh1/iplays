import type { ReactNode } from 'react';

/** Labeled form field. Inputs use the .ip-input class. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ip-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Err({ error }: { error: string | null }) {
  return error ? (
    <p className="ip-error" role="alert">
      {error}
    </p>
  ) : null;
}
