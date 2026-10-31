/**
 * iplays logo. The wordmark is always lowercase and always rendered from
 * vector paths (never typed text), so it looks identical everywhere.
 * The "i" dot is the motion symbol: a lime ball with blue speed trails.
 */
interface LogoProps {
  height?: number;
  tone?: 'navy' | 'white';
  className?: string;
}

export function Logo({ height = 28, tone = 'navy', className }: LogoProps) {
  const ink = tone === 'navy' ? 'var(--ip-navy)' : '#fff';
  return (
    <svg
      className={className}
      height={height}
      viewBox="-18 2 204 82"
      role="img"
      aria-label="iplays"
      style={{ direction: 'ltr', display: 'block' }}
    >
      <g fill="none" stroke={ink} strokeWidth={7.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 31v25" />
        <path d="M21.5 31v43" />
        <circle cx="34" cy="43.5" r="12.5" />
        <path d="M62 9v47" />
        <circle cx="90" cy="43.5" r="12.5" />
        <path d="M102.5 31v25" />
        <path d="M114 31v12.5a12.5 12.5 0 0 0 25 0V31" />
        <path d="M139 43.5V64a12 12 0 0 1-12 12h-6" />
        <path d="M176 34.5c-2.6-2.6-6.4-4-10.5-4-6 0-9.5 3-9.5 7 0 4.4 4.4 5.6 10 6.5 5.8.9 10.5 2.4 10.5 7.2 0 3.8-3.6 5.8-10.5 5.8-4.6 0-8.4-1.4-11-4" />
      </g>
      <path d="M-13 9h11M-7 17h5" stroke="var(--ip-blue)" strokeWidth={4} strokeLinecap="round" />
      <circle cx="6" cy="13" r="7" fill="var(--ip-lime)" />
    </svg>
  );
}

/** Square symbol (the "i" with the ball in motion) for avatars, splash, small spaces. */
export function LogoSymbol({ size = 40, variant = 'dark' }: { size?: number; variant?: 'dark' | 'light' }) {
  const dark = variant === 'dark';
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" role="img" aria-label="iplays">
      <rect width="1024" height="1024" rx="228" fill={dark ? 'var(--ip-navy)' : '#fff'} />
      <g transform="translate(36 0)">
        <path d="M512 470v300" stroke={dark ? '#fff' : 'var(--ip-navy)'} strokeWidth={112} strokeLinecap="round" />
        <path d="M250 268h150M318 380h82" stroke="var(--ip-blue)" strokeWidth={56} strokeLinecap="round" />
        <circle cx="530" cy="318" r="98" fill="var(--ip-lime)" />
      </g>
    </svg>
  );
}
