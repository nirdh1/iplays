/**
 * iplays icon set — 24px grid, 2px stroke, round caps/joins.
 * One consistent line style across the whole app. Icons that indicate
 * direction (chevrons, arrows) are mirrored automatically in RTL via CSS.
 */
const paths = {
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
  team: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.5 3.2-5.5 6.5-5.5s5.9 2 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.5 3.5 5.2',
  calendar: 'M5 5.5h14a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1zM4 10h16M8.5 3.5v4M15.5 3.5v4',
  career: 'M4 20V14M10 20V9M16 20v-8M21 5l-5 4-5-3-7 5',
  family: 'M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z',
  bell: 'M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5zM10 21h4',
  chevron: 'm9 6 6 6-6 6',
  chevronDown: 'm6 9 6 6 6-6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 6l-6 6 6 6',
  card: 'M8 3.5h8a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  navigate: 'M20 4 4 11l7 2 2 7z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  car: 'M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5M3.5 12h17M5 16.5h14v2.5h-2.5v-2.5M7.5 19v-2.5M7.5 14.3h.01M16.5 14.3h.01',
  whistle: 'M9 9a5 5 0 1 0 5 5V9h7V6H9zM9 14h.01',
  ball: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5l4 2.9-1.5 4.6h-5L8 10.4zM12 3v4.5M21 10.5l-5 0M16.5 19.5 14.5 15M7.5 19.5 9.5 15M3 10.5h5',
  chat: 'M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.4A8 8 0 1 1 20 12z',
  wallet: 'M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5v10A1.5 1.5 0 0 0 5.5 19H20V8H6.5A2.5 2.5 0 0 1 4 5.5M16 13.5h.01',
  shield: 'M12 3 5 6v5.5c0 4.3 3 7.9 7 9.5 4-1.6 7-5.2 7-9.5V6zM9 12l2 2 4-4',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6 6 18',
  live: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14',
  goal: 'M3 18V7h18v11M3 7l3 3h12l3-3M6 10v8M18 10v8M10.5 15.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0z',
  star: 'm12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z',
  bolt: 'M13 3 5 13.5h6L10 21l8-10.5h-6z',
  user: 'M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.8-4 3.8-6 7.5-6s6.7 2 7.5 6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  palette: 'M12 21a9 9 0 1 1 9-9c0 2.5-2 3.5-4 3.5h-1.5a1.8 1.8 0 0 0-1.3 3.1A1.5 1.5 0 0 1 12 21zM7.5 12h.01M9.5 7.5h.01M14.5 7.5h.01',
  photo: 'M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17.5M15.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  cloud: 'M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.3 1.6A4 4 0 0 1 17 18.5z',
  flag: 'M5 21V4M5 4.5h11l-2 4 2 4H5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  phone: 'M5 4h3.5l1.5 4.5-2 1.5a11 11 0 0 0 6 6l1.5-2 4.5 1.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
  whatsapp: 'M12 3.5a8.5 8.5 0 0 0-7.3 12.8L3.5 20.5l4.3-1.1A8.5 8.5 0 1 0 12 3.5zM9 8.5c.3 2.9 2.6 5.3 5.5 5.8l1-1.3-1.8-.9-.8.8a4 4 0 0 1-2.3-2.3l.8-.8-.9-1.8z',
  mail: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3.5 7l8.5 6 8.5-6',
  search: 'M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM15.5 15.5 20 20',
  lock: 'M6.5 11h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
} as const;

export type IconName = keyof typeof paths;

const mirrored: ReadonlySet<IconName> = new Set(['chevron', 'arrow', 'back']);

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
  title?: string;
}

export function Icon({ name, size = 24, className, strokeWidth = 2, title }: IconProps) {
  const cls = ['ip-icon', mirrored.has(name) ? 'ip-icon--mirror' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={paths[name]} />
    </svg>
  );
}
