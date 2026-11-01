/**
 * App shell components: header, child switcher, bottom sheet, bottom navigation.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';
import { Avatar, InitialsAvatar } from './Avatar';
import { IconButton } from './ui';
import type { Child } from '../data/demo';

/* ---------- Bottom sheet ---------- */
export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div className={`ip-sheet ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <div className="ip-sheet-scrim" onClick={onClose} />
      <div className="ip-sheet-panel" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panelRef}>
        <span className="ip-sheet-handle" aria-hidden />
        <div className="ip-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="סגירה" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- Header ---------- */
export function AppHeader({ parentName, unread, child, onOpenSwitcher }: { parentName: string; unread: number; child?: Child; onOpenSwitcher: () => void }) {
  return (
    <header className="ip-header">
      <div className="ip-header-row">
        <Logo height={32} />
        <div className="ip-header-actions">
          {child && <ChildSwitcherPill child={child} onClick={onOpenSwitcher} compact />}
          <IconButton icon="bell" label="התראות" badge={unread} />
          <button type="button" className="ip-parent-btn" aria-label={`פרופיל הורה: ${parentName}`}>
            <InitialsAvatar name={parentName} size={40} />
          </button>
        </div>
      </div>
    </header>
  );
}

/* ---------- Child switcher ---------- */
export function ChildSwitcherPill({ child, onClick, compact }: { child: Child; onClick: () => void; compact?: boolean }) {
  return (
    <button type="button" className={`ip-child-pill ${compact ? 'ip-child-pill--compact' : ''}`} onClick={onClick} aria-haspopup="dialog" aria-label={`מוצג כעת: ${child.firstName}. החלפת ילד`}>
      <Avatar size={32} name={child.firstName} jersey={child.jersey} hair={child.hair} hairStyle={child.hairStyle} />
      <span className="ip-child-pill-name">{child.firstName}</span>
      {!compact && (
        <span className="ip-child-pill-meta">
          {child.sport} · {child.team}
        </span>
      )}
      <Icon name="chevronDown" size={18} />
    </button>
  );
}

export function ChildSwitcherSheet({ open, onClose, items, selectedId, onSelect }: { open: boolean; onClose: () => void; items: Child[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="הילדים שלי">
      <ul className="ip-child-list" role="radiogroup" aria-label="בחירת ילד">
        {items.map((c) => {
          const selected = c.id === selectedId;
          const hasLive = c.live?.status === 'live';
          return (
            <li key={c.id}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                className={`ip-child-option ${selected ? 'is-selected' : ''}`}
                onClick={() => {
                  onSelect(c.id);
                  onClose();
                }}
              >
                <Avatar size={52} name={c.firstName} jersey={c.jersey} hair={c.hair} hairStyle={c.hairStyle} ring={selected} />
                <span className="ip-child-option-text">
                  <strong>
                    {c.firstName} {c.lastName}
                    {hasLive && <span className="ip-live-dot ip-live-dot--inline" aria-label="משחק חי עכשיו" />}
                  </strong>
                  <span>
                    {c.club} · {c.team}
                  </span>
                  <span className="ip-muted">
                    {c.sport} · גיל {c.age}
                  </span>
                </span>
                <span className={`ip-radio ${selected ? 'is-on' : ''}`} aria-hidden>
                  {selected && <Icon name="check" size={16} strokeWidth={3} />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="ip-add-row">
        <span className="ip-icon-tile ip-icon-tile--lime">
          <Icon name="plus" size={20} />
        </span>
        הוספת ילד או הצטרפות לקבוצה
      </button>
    </BottomSheet>
  );
}

/* ---------- Bottom navigation ---------- */
export type TabId = 'home' | 'team' | 'calendar' | 'career' | 'family';
export const tabs: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'home', label: 'בית', icon: 'home' },
  { id: 'team', label: 'קבוצה', icon: 'team' },
  { id: 'calendar', label: 'יומן', icon: 'calendar' },
  { id: 'career', label: 'קריירה', icon: 'career' },
  { id: 'family', label: 'משפחה', icon: 'family' },
];

export function BottomNav({ active, onChange }: { active: TabId; onChange: (id: TabId) => void }) {
  return (
    <nav className="ip-bottom-nav" aria-label="ניווט ראשי">
      {tabs.map((t) => (
        <button key={t.id} type="button" className={`ip-tab ${active === t.id ? 'is-active' : ''}`} aria-current={active === t.id ? 'page' : undefined} onClick={() => onChange(t.id)}>
          <span className="ip-tab-icon">
            <Icon name={t.icon} size={24} strokeWidth={active === t.id ? 2.4 : 2} />
          </span>
          <span className="ip-tab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** Simple top bar for secondary screens. */
export function ScreenTitle({ title, subtitle, trailing }: { title: string; subtitle?: string; trailing?: ReactNode }) {
  return (
    <div className="ip-screen-title">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {trailing}
    </div>
  );
}
