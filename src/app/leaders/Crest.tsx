/**
 * A league crest, drawn to sit next to the sticker-style climbers and
 * trophies: a chunky shield with a dark outline and a light sticker border,
 * coloured by league, with one more peak inside for every league climbed.
 */
const LOOK: Record<string, { a: string; b: string; ink: string; peaks: number }> = {
  base: { a: "#9b8a7a", b: "#5e5048", ink: "#f3e6d6", peaks: 1 },
  ledge: { a: "#e7a35f", b: "#9a5a2a", ink: "#fff0dc", peaks: 2 },
  ridge: { a: "#d9e3ee", b: "#7d8fa6", ink: "#ffffff", peaks: 3 },
  peak: { a: "#ffd75a", b: "#c58a12", ink: "#fff8dc", peaks: 4 },
  summit: { a: "#9ff3ff", b: "#7a5cff", ink: "#ffffff", peaks: 5 },
};

export const LEAGUE_ID: Record<string, string> = {
  "BASE CAMP": "base",
  LEDGE: "ledge",
  RIDGE: "ridge",
  PEAK: "peak",
  SUMMIT: "summit",
};

export function leagueColor(name: string) {
  return LOOK[LEAGUE_ID[name] ?? "base"].a;
}

export function Crest({ league, size = 64, dim = false }: { league: string; size?: number; dim?: boolean }) {
  const id = LEAGUE_ID[league] ?? league;
  const l = LOOK[id] ?? LOOK.base;
  const g = `crest-${id}`;
  // Peaks across the shield's lower half, the middle one tallest.
  const peaks = Array.from({ length: l.peaks }, (_, i) => {
    const n = l.peaks;
    const w = 44 / n;
    const x = 28 + i * w;
    const mid = (n - 1) / 2;
    const h = n === 1 ? 26 : 26 - (Math.abs(i - mid) / mid) * 11;
    return `M${x},${74} L${x + w / 2},${74 - h} L${x + w},${74} Z`;
  });
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label={`${league} league`} role="img" style={{ filter: dim ? "grayscale(1) opacity(0.45)" : undefined }}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={l.a} />
          <stop offset="1" stopColor={l.b} />
        </linearGradient>
      </defs>
      {/* sticker border, then the outlined shield */}
      <path d="M50 4 L88 16 L86 52 C84 74 68 88 50 96 C32 88 16 74 14 52 L12 16 Z" fill="#f6ead8" />
      <path d="M50 9 L83 19.5 L81.5 52 C80 71 66 83.5 50 90.5 C34 83.5 20 71 18.5 52 L17 19.5 Z" fill={`url(#${g})`} stroke="#2b1b12" strokeWidth="4" strokeLinejoin="round" />
      {/* highlight */}
      <path d="M50 15 L76 23.5 L75 40 C62 34 40 34 24 41 L23.5 23.5 Z" fill="#ffffff" opacity="0.22" />
      {peaks.map((d, i) => (
        <path key={i} d={d} fill={l.ink} stroke="#2b1b12" strokeWidth="3" strokeLinejoin="round" />
      ))}
      {/* the rope across the base */}
      <path d="M24 77 Q50 84 76 77" fill="none" stroke="#2b1b12" strokeWidth="7" strokeLinecap="round" />
      <path d="M24 77 Q50 84 76 77" fill="none" stroke="#e8893a" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="4 3" />
    </svg>
  );
}
