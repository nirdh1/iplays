import { useId } from 'react';
import type { Child } from '../data/demo';

/**
 * Profile photo slot. Pass `src` for a real photo; without one we draw a
 * friendly illustrated placeholder in the child's jersey color, so demo
 * content never uses photos of real children.
 */
interface AvatarProps {
  size?: number;
  src?: string;
  name: string;
  jersey?: string;
  hair?: string;
  hairStyle?: Child['hairStyle'];
  ring?: boolean;
  className?: string;
}

export function Avatar({ size = 48, src, name, jersey = '#3DA5FF', hair = '#3b2a1e', hairStyle = 'short', ring, className }: AvatarProps) {
  const uid = useId().replace(/:/g, '');
  const cls = ['ip-avatar', ring ? 'ip-avatar--ring' : '', className ?? ''].filter(Boolean).join(' ');
  if (src) {
    return <img className={cls} src={src} alt={name} width={size} height={size} />;
  }
  return (
    <svg className={cls} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={name}>
      <defs>
        <linearGradient id={`bg-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E9F1FB" />
          <stop offset="1" stopColor="#D5E3F4" />
        </linearGradient>
        <clipPath id={`clip-${uid}`}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clipPath={`url(#clip-${uid})`}>
        <rect width="64" height="64" fill={`url(#bg-${uid})`} />
        {hairStyle === 'long' && <path d="M17 28c0-11 6.5-17 15-17s15 6 15 17v20H17z" fill={hair} />}
        <path d="M10 64c1-11 9.5-17 22-17s21 6 22 17z" fill={jersey} />
        <path d="M27 47h10l-5 6z" fill="#fff" opacity=".85" />
        <rect x="28" y="38" width="8" height="10" rx="3" fill="#E9B48F" />
        <circle cx="32" cy="29" r="11" fill="#F2C29F" />
        {hairStyle === 'short' && <path d="M21 28c-.5-8 4.5-12.5 11-12.5S43.5 20 43 28c-2-4-6-6-11-6s-9 2-11 6z" fill={hair} />}
        {hairStyle === 'long' && <path d="M21 28c0-7.5 5-12 11-12s11 4.5 11 12c-3-3.5-7-5.5-11-5.5S24 24.5 21 28z" fill={hair} />}
        {hairStyle === 'curly' && (
          <g fill={hair}>
            <circle cx="24" cy="22" r="5" />
            <circle cx="31" cy="18.5" r="5.5" />
            <circle cx="38.5" cy="20.5" r="5" />
            <circle cx="42" cy="26" r="3.5" />
            <circle cx="21.5" cy="27" r="3.5" />
          </g>
        )}
        <circle cx="28" cy="30" r="1.3" fill="#0B1F3B" />
        <circle cx="36" cy="30" r="1.3" fill="#0B1F3B" />
        <path d="M28.5 34.5c2 1.6 5 1.6 7 0" stroke="#0B1F3B" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Initials avatar for adults (parents, coaches). */
export function InitialsAvatar({ name, size = 40, tone = 'navy' }: { name: string; size?: number; tone?: 'navy' | 'blue' | 'lime' }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('');
  return (
    <span className={`ip-initials ip-initials--${tone}`} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-label={name} role="img">
      {initials}
    </span>
  );
}
