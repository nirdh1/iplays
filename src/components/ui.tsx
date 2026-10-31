/**
 * iplays reusable UI primitives. Every screen is assembled from these so
 * spacing, type and color stay consistent. Styles live in theme/components.css.
 */
import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

/* ---------- Card ---------- */
interface CardProps {
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'navy' | 'live';
  padded?: boolean;
  as?: 'section' | 'div' | 'article';
  'aria-label'?: string;
}
export function Card({ children, className, tone = 'default', padded = true, as: Tag = 'div', ...rest }: CardProps) {
  const cls = ['ip-card', `ip-card--${tone}`, padded ? 'ip-card--padded' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <Tag className={cls} {...rest}>
      {children}
    </Tag>
  );
}

/* ---------- Section header ---------- */
export function SectionHeader({ title, icon, action, onAction }: { title: string; icon?: IconName; action?: string; onAction?: () => void }) {
  return (
    <div className="ip-section-header">
      <h2 className="ip-section-title">
        {icon && <Icon name={icon} size={20} className="ip-section-icon" />}
        {title}
      </h2>
      {action && (
        <button type="button" className="ip-link" onClick={onAction}>
          {action}
          <Icon name="chevron" size={16} />
        </button>
      )}
    </div>
  );
}

/* ---------- Buttons ---------- */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'lime';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: IconName;
  block?: boolean;
  size?: 'md' | 'sm';
}
export function Button({ variant = 'primary', icon, block, size = 'md', className, children, ...rest }: ButtonProps) {
  const cls = ['ip-btn', `ip-btn--${variant}`, `ip-btn--${size}`, block ? 'ip-btn--block' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 18 : 20} />}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({ icon, label, badge, onClick, tone = 'plain' }: { icon: IconName; label: string; badge?: number; onClick?: () => void; tone?: 'plain' | 'soft' }) {
  return (
    <button type="button" className={`ip-icon-btn ip-icon-btn--${tone}`} aria-label={badge ? `${label} (${badge} חדשות)` : label} onClick={onClick}>
      <Icon name={icon} />
      {badge ? <span className="ip-dot-badge">{badge}</span> : null}
    </button>
  );
}

/* ---------- Tags ---------- */
export function Tag({ children, tone = 'neutral', icon }: { children: ReactNode; tone?: 'neutral' | 'blue' | 'lime' | 'navy' | 'warning' | 'live'; icon?: IconName }) {
  return (
    <span className={`ip-tag ip-tag--${tone}`}>
      {icon && <Icon name={icon} size={14} strokeWidth={2.2} />}
      {children}
    </span>
  );
}

export function LiveBadge({ label = 'LIVE' }: { label?: string }) {
  return (
    <span className="ip-live-badge">
      <span className="ip-live-dot" aria-hidden />
      {label}
    </span>
  );
}

/* ---------- Data display ---------- */
export function StatTile({ value, label, accent }: { value: ReactNode; label: string; accent?: boolean }) {
  return (
    <div className={`ip-stat ${accent ? 'ip-stat--accent' : ''}`}>
      <span className="ip-stat-value">{value}</span>
      <span className="ip-stat-label">{label}</span>
    </div>
  );
}

export function ProgressBar({ value, label, delta }: { value: number; label: string; delta?: number }) {
  return (
    <div className="ip-progress">
      <div className="ip-progress-row">
        <span className="ip-progress-label">{label}</span>
        <span className="ip-progress-value">
          {value}
          {delta ? <span className="ip-progress-delta">+{delta}</span> : null}
        </span>
      </div>
      <div className="ip-progress-track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="ip-progress-fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function MetaRow({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="ip-meta-row">
      <Icon name={icon} size={18} />
      <span>{children}</span>
    </div>
  );
}

/** Tappable row used in lists: icon tile + title/subtitle + trailing chevron. */
export function ListRow({ icon, iconTone = 'blue', title, subtitle, trailing, onClick }: { icon: IconName; iconTone?: 'blue' | 'lime' | 'navy' | 'live'; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className="ip-list-row" onClick={onClick}>
      <span className={`ip-icon-tile ip-icon-tile--${iconTone}`}>
        <Icon name={icon} size={20} />
      </span>
      <span className="ip-list-row-text">
        <span className="ip-list-row-title">{title}</span>
        {subtitle && <span className="ip-list-row-sub">{subtitle}</span>}
      </span>
      {trailing ?? <Icon name="chevron" size={18} className="ip-muted" />}
    </button>
  );
}

/** Simple club crest built from the team's initial — swap for real crest images. */
export function TeamCrest({ name, tone = 'navy', size = 48 }: { name: string; tone?: 'navy' | 'blue' | 'lime' | 'neutral'; size?: number }) {
  return (
    <span className={`ip-crest ip-crest--${tone}`} style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden>
      {name.trim()[0]}
    </span>
  );
}

export function EmptyState({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div className="ip-empty">
      <span className="ip-icon-tile ip-icon-tile--blue ip-icon-tile--lg">
        <Icon name={icon} size={26} />
      </span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
