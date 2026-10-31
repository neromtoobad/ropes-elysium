/**
 * Elysium, the chain ROPES runs on, drawn into the game rather than pasted
 * on: its badge where the game says "on-chain", and its mountains — the
 * chevron peaks of the Elysium mark — as the range on the wall's horizon.
 * You start the climb at the foot of Elysium; climb high enough and it
 * sinks away below you.
 */

/** The round Elysium badge (public/elysium, cut from the official mark). */
export function ElysiumBadge({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={size > 48 ? "/elysium/badge.webp" : "/elysium/badge-96.webp"}
      alt="Elysium"
      width={size}
      height={size}
      className={`inline-block shrink-0 rounded-full ${className}`}
    />
  );
}

const SLOPE = 0.62;

/** One peak of the mark: the gradient chevron band, the ground beneath it
 *  (so a nearer row hides the one behind), and three nested stripes. */
function Peak({ cx, y0, w }: { cx: number; y0: number; w: number }) {
  const t = w * 0.17;
  const drop = w * SLOPE;
  const band = `${cx - w},${y0 + drop} ${cx},${y0} ${cx + w},${y0 + drop} ${cx + w},${y0 + drop + t} ${cx},${y0 + t} ${cx - w},${y0 + drop + t}`;
  return (
    <g>
      <polygon points={`${cx - w},${y0 + drop} ${cx},${y0} ${cx + w},${y0 + drop} ${cx + w},400 ${cx - w},400`} fill="#0c0a1c" />
      <polygon points={band} fill="url(#ely-range)" />
      {[0, 1, 2].map((k) => {
        const y = y0 + t + w * 0.09 + k * w * 0.1;
        return (
          <polyline
            key={k}
            points={`${cx - w},${y + drop} ${cx},${y} ${cx + w},${y + drop}`}
            fill="none"
            stroke="#cfeef3"
            strokeOpacity={0.32 - k * 0.07}
            strokeWidth={w * 0.03}
          />
        );
      })}
    </g>
  );
}

/** The Elysium range: staggered rows of the mark's peaks, navy behind to
 *  cyan in front, tiled across whatever width the wall has. */
export function ElysiumRange({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  const W = 150;
  const rows = [
    { y0: 30, start: 0 },
    { y0: 95, start: W },
    { y0: 160, start: 0 },
  ];
  return (
    <svg
      viewBox="0 0 1200 240"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <defs>
        <linearGradient id="ely-range" gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="0" y2="240">
          <stop offset="0" stopColor="#173352" />
          <stop offset="0.55" stopColor="#1f6f8f" />
          <stop offset="1" stopColor="#4cc3d3" />
        </linearGradient>
      </defs>
      {rows.map((r) =>
        Array.from({ length: 6 }, (_, i) => (
          <Peak key={`${r.y0}-${i}`} cx={r.start + i * W * 2 - W} y0={r.y0} w={W} />
        )),
      )}
    </svg>
  );
}
