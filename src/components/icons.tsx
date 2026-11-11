import type { SVGProps } from 'react';

// Map-legend symbols for POI categories (24px grid, stroke icons).
const CATEGORY: Record<string, string> = {
  桥: 'M3 17c3-6 15-6 18 0M2 17h20M7 13.5V17M17 13.5V17',
  堤: 'M2 9c2.5-1.6 5-1.6 7.5 0s5 1.6 7.5 0 3.5-1.2 5-0.6M2 14h20M2 18h20',
  湖: 'M3 9c2-1.4 4-1.4 6 0s4 1.4 6 0 4-1.4 6 0M3 14c2-1.4 4-1.4 6 0s4 1.4 6 0 4-1.4 6 0M3 19c2-1.4 4-1.4 6 0s4 1.4 6 0 4-1.4 6 0',
  山: 'M2 19l6.5-10 3.5 5 2.5-3.5L22 19z',
  塔: 'M12 2.5V5M8.5 5h7l-1.5 3h-4zM8 11h8l-1.5 3h-5zM9.5 8v3M14.5 8v3M10 14v7h4v-7M6 21h12',
  寺: 'M3 10c4-1 6.5-3 9-6 2.5 3 5 5 9 6M5 10v10h14V10M10 20v-5h4v5M3 20h18',
  亭: 'M3 9c3-1 6-3 9-6 3 3 6 5 9 6M6 9v11M18 9v11M4 20h16M9 9v3h6V9',
  园: 'M12 21v-7M12 14c-3.5 0-6-2.4-6-5.5S8.5 3 12 3s6 2.4 6 5.5S15.5 14 12 14zM7 21h10',
  岛: 'M5 14c1.5-4 4-6 7-6s5.5 2 7 6M2 17c2-1.3 4-1.3 6 0s4 1.3 6 0 4-1.3 6 0M2 20.5c2-1.3 4-1.3 6 0s4 1.3 6 0 4-1.3 6 0',
  村: 'M3 11l5-4 5 4M4.5 10v9h7v-9M13 13l4-3 4 3M14 12.5V19h6v-6.5M2 19h20',
  景: 'M6 21V4M6 4h11l-2.5 4L17 12H6',
  街区: 'M3 21V10h6v11M9 21V4h8v17M17 21v-8h4v8M2 21h20M12 8h2M12 12h2M12 16h2',
  建筑: 'M5 21V6l7-3 7 3v15M9 9h2M13 9h2M9 13h2M13 13h2M9 17h2M13 17h2M3 21h18',
  美术馆: 'M3 9l9-5 9 5M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 20h18',
  海岸: 'M3 15c2-1.4 4-1.4 6 0s4 1.4 6 0 4-1.4 6 0M3 19c2-1.4 4-1.4 6 0s4 1.4 6 0 4-1.4 6 0M8 10a4 4 0 0 1 8 0',
  店: 'M4 10h16l-1.5-5h-13zM5 10v10h14V10M10 20v-5h4v5',
  道路: 'M8 3 5 21M16 3l3 18M12 4v2M12 9v2M12 14v2M12 19v1'
};

export function CategoryIcon({
  category,
  size = 16,
  ...rest
}: { category: string | null | undefined; size?: number } & SVGProps<SVGSVGElement>) {
  const d = (category && CATEGORY[category]) || CATEGORY['景'];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}

// UI icons.
const UI = {
  play: { d: 'M8 5v14l11-7z', fill: true },
  pause: { d: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z', fill: true },
  upload: { d: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4' },
  camera: {
    d: 'M4 8h3l1.6-2.5h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'
  },
  flip: { d: 'M20 7v4h-4M4 17v-4h4M5.6 9.5A7 7 0 0 1 18.4 8L20 11M18.4 14.5A7 7 0 0 1 5.6 16L4 13' },
  close: { d: 'M6 6l12 12M18 6 6 18' },
  left: { d: 'M15 5l-7 7 7 7' },
  right: { d: 'M9 5l7 7-7 7' },
  down: { d: 'M5 9l7 7 7-7' },
  arrow: { d: 'M5 12h14M13 6l6 6-6 6' },
  sliders: { d: 'M3 6h11M18 6h3M3 12h5M12 12h9M3 18h13M20 18h1M14 4v4M8 10v4M16 16v4' },
  search: { d: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4' },
  plus: { d: 'M12 5v14M5 12h14' },
  edit: { d: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4' },
  trash: { d: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13' },
  pin: { d: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z' },
  note: { d: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5' },
  book: { d: 'M4 5a2 2 0 0 1 2-2h6v17H6a2 2 0 0 0-2 2zM20 5a2 2 0 0 0-2-2h-6v17h6a2 2 0 0 1 2 2z' },
  map: { d: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14' },
  check: { d: 'm5 12 5 5 9-10' },
  star: { d: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z' },
  expand: { d: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7' },
  user: { d: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0' },
  grip: { d: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01' },
  more: { d: 'M5 12h.01M12 12h.01M19 12h.01' }
} as const;
export type IconName = keyof typeof UI;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  const icon = UI[name];
  const filled = 'fill' in icon && icon.fill;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={name === 'grip' || name === 'more' ? 3 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={icon.d} />
    </svg>
  );
}
