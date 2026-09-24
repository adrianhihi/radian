// Icons for the bottom tab bar (24-unit strokes, no fill).
const PATHS: Record<string, React.ReactNode> = {
  explore: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  portfolio: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 12V3.5A8.5 8.5 0 0 1 20.5 12z" />
    </>
  ),
  // a curve going up and out: the launch
  launch: <path d="M4 19c4-1 7-4 9-8l2-4M14 4h5v5M9 19l-1 2M15 17l1 2" />,
  learn: <path d="M4 5.5h6a2 2 0 0 1 2 2V19a2 2 0 0 0-2-1.8H4zM20 5.5h-6a2 2 0 0 0-2 2V19a2 2 0 0 1 2-1.8h6z" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </>
  ),
};

export function NavIcon({ name, size = 20 }: { name: string; size?: number }) {
  const body = PATHS[name];
  if (!body) return null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {body}
    </svg>
  );
}
