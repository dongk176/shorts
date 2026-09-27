import type { CSSProperties } from "react";
const paths: Record<string, React.ReactNode> = {
  arrow: (
    <>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </>
  ),
  back: (
    <>
      <path d="M19 12H5m6-6-6 6 6 6" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  spark: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      <path d="M20 2v4m-2-2h4" />
    </>
  ),
  bag: (
    <>
      <rect x="5" y="7" width="14" height="14" rx="3" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  book: (
    <>
      <path d="M12 5v15M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2V4Z" />
    </>
  ),
  cup: (
    <>
      <path d="M5 8h11v8a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8ZM16 9h2a3 3 0 0 1 0 6h-2M8 3v2m5-2v2" />
    </>
  ),
  game: (
    <>
      <path d="M8 7h8c4 0 7 12 3 12-2 0-3-3-4-3H9c-1 0-2 3-4 3-4 0-1-12 3-12Z" />
      <path d="M8 10v4m-2-2h4m5 0h.1m3 1h.1" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 11v1a7 7 0 0 0 14 0v-1m-7 8v3m-4 0h8" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m16 8-2 6-6 2 2-6 6-2Z" />
    </>
  ),
  play: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="4" />
      <path d="m10 9 5 3-5 3V9Z" />
    </>
  ),
  store: (
    <>
      <path d="M4 10v11h16V10M3 4h18l1 6c-2 3-4 2-5 0-1 2-4 2-5 0-1 2-4 2-5 0-1 2-3 3-5 0l1-6ZM9 21v-7h6v7" />
    </>
  ),
  seed: (
    <>
      <path d="M12 21v-9M12 14C3 15 3 6 3 6s9-1 9 8ZM12 10c0-8 8-8 8-8s1 9-8 8Z" />
    </>
  ),
  chart: (
    <>
      <path d="M4 3v18h17M8 15l4-5 4 2 5-7" />
    </>
  ),
  film: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 3v18M16 3v18M4 8h4m-4 8h4M16 8h4m-4 8h4" />
    </>
  ),
  camera: (
    <>
      <path d="m8 6 2-3h4l2 3h4v15H4V6h4Z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14c2 3 6 3 8 0M8 9h.1M16 9h.1" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M7 2v6m10-6v6M3 11h18M8 15h2m4 0h2m-8 3h2" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="3" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
};
export function Icon({
  name,
  size = 22,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name] || paths.spark}
    </svg>
  );
}
