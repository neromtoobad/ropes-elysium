"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { TableState } from "@/lib/state";
import { useSmoothed } from "./useSmoothed";
import { bigClock, fmtMark, fmtMove } from "./shared";
import { LedgeProp } from "./LedgeProps";

/**
 * ROPES — solo.
 *
 * One climber, and the camera follows THEM: the character holds the middle of
 * the screen and the wall scrolls past. Nothing sells climbing like the world
 * moving under you — a fixed wall with a moving dot reads as a chart wearing a
 * costume, which is exactly what this replaced.
 *
 * Height is the run's CUMULATIVE multiple (free cash plus the live-marked
 * position, over the seat price), pushed through the same measured tanh curve
 * as ever, so a doubling and a halving are equal distances of wall.
 *
 * The wall itself is annotated with milestone ledges at fixed multiples.
 * Because the camera moves and they don't, you climb PAST them — each one is a
 * discrete, chime-worthy event, which is what a lone climber has instead of
 * overtaking.
 */

/**
 * The run's live cumulative multiple: free cash plus the position marked to the
 * live book, over the seat price. THE number — the wall, the bail bar and the
 * altitude readout must all say the same thing, so they all call this.
 */
export function liveMultipleOf(
  seat: TableState["seats"][number] | null | undefined,
  price: TableState["price"],
) {
  if (!seat || seat.buyIn <= 0) return 1;
  // Mark at what a BAIL would actually be PAID: the bid for your side. The
  // prices on the table are what each side costs to BUY (the ask), and an UP
  // share sells for one minus what DOWN costs — so marking at the ask
  // overstated every KEEP number by the whole spread.
  const live =
    seat.pick === "UP" ? (price.down != null ? 1 - price.down : null)
    : seat.pick === "DOWN" ? (price.up != null ? 1 - price.up : null)
    : null;
  const positionLive =
    seat.inRound && seat.fillPrice && live
      ? seat.costInRound * (live / seat.fillPrice)
      : seat.costInRound;
  return (seat.stack - seat.costInRound + positionLive) / seat.buyIn;
}

/**
 * Screen-space height is the pure log of the multiple.
 *
 * The old tanh curve (measured for per-round motion near 1×) SATURATED on
 * cumulative multiples: at 3× a 10% move slid the wall fifteen times less
 * than at 1× — the game went visually still exactly when the stakes were
 * highest. Log mapping makes equal RELATIVE moves equal screen distance at
 * every altitude: a 1% tick is always ~6px, a double is always most of a
 * screen, whether it is your first round or your fifth.
 */
export function heightOfMultiple(m: number) {
  return Math.log(Math.max(m, 0.05));
}

/** % of viewport height per ln-unit. 120 ⇒ a +10% move ≈ 12% of the wall. */
const SPREAD = 120;

/** The ledges carved into the wall, as multiples of the seat price. */
const MILESTONES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5, 8, 12, 20];

/** The win burst: fixed angles and distances, so every bell looks the same. */
const SPARKS = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 + 0.2;
  const d = i % 2 ? 62 : 96;
  return { dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.8, gold: i % 3 !== 0 };
});
/** The snapped rope's fibres, flung out from the cut. */
const FIBRES = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return { dx: Math.cos(a) * 34, dy: Math.sin(a) * 26, rot: (a * 180) / Math.PI + 90 };
});

/** Below this the climber is barely holding on. */
const HANGING = 0.35;

type Pose = "climb" | "slip" | "leap" | "fall" | "cheer";

export const CAST = [
  { id: "green", code: "VRD-01", label: "VERDANT" },
  { id: "red", code: "CRM-02", label: "CRIMSON" },
  { id: "gold", code: "AUR-03", label: "AURUM" },
  { id: "blue", code: "AZR-04", label: "AZURE" },
  { id: "violet", code: "VLT-05", label: "VESPER" },
  { id: "orange", code: "EMB-06", label: "EMBER" },
  { id: "teal", code: "TDL-07", label: "TIDAL" },
  { id: "pink", code: "NEO-08", label: "NEON" },
] as const;
export type ClimberId = (typeof CAST)[number]["id"];

/** Who has a cut 6-frame climb cycle in public/climbers/<id>/cycle/. */
const CYCLE_READY = new Set<ClimberId>([
  "green", "red", "gold", "blue", "violet", "orange", "teal", "pink",
]);

export function Cliff({
  seats,
  price,
  secondsLeft,
  clockUrgent,
  stalled,
  settling = false,
  intervalSec,
  myRunId,
  falling,
  leaping,
  cheering = [],
  bellKey = null,
  bells,
  mark,
  record,
  climber,
  onMilestone,
}: {
  seats: TableState["seats"];
  price: TableState["price"];
  secondsLeft: number;
  /** Last ten seconds / clock lost: the wall draws the clock below lg. */
  clockUrgent: boolean;
  stalled: boolean;
  /** The bell has rung and the next round is a few seconds away. */
  settling?: boolean;
  /** The window's full length, so the drain bar empties over the real round. */
  intervalSec: number;
  myRunId: string | null;
  /** Run ids mid-death-fall / mid-bail-leap. Ids, not names — names collide. */
  falling: string[];
  leaping: string[];
  /** Runs this bell paid, with what it paid them — they get the gold finish. */
  cheering?: { runId: string; gain: number }[];
  /** The bell's round index, so each bell's finish plays from the start. */
  bellKey?: number | null;
  /** The last settled windows, oldest → newest — the wall's own memory. */
  bells: TableState["bells"];
  mark: TableState["mark"];
  record: TableState["wallRecord"];
  /** Which of the eight climbers the player chose in the rail. */
  climber: ClimberId;
  /** Fired when the climber crosses a milestone ledge going UP. */
  onMilestone?: (multiple: number) => void;
}) {
  // YOUR run or nobody. The old `?? seats[0]` fallback put a stranger's climber
  // — their name, their altitude, their money — on the wall of anyone who had
  // not joined yet, which reads as your own session and is not.
  const liveSeat = seats.find((s) => s.runId === myRunId) ?? null;
  /*
   * A run the bell kills leaves `seats` in the very frame that carries the
   * bell, so the fall below never had a body to play on — the climber just
   * vanished. Keep the last seat on screen while it is falling.
   */
  const lastSeat = useRef(liveSeat);
  if (liveSeat) lastSeat.current = liveSeat;
  const seat =
    liveSeat ?? (lastSeat.current && falling.includes(lastSeat.current.runId) ? lastSeat.current : null);

  // The live mark: the tag, the altitude readout and BAIL all say this.
  const multiple = useSmoothed(liveMultipleOf(seat, price), 340, 3);
  // The camera anchors to the SETTLED stack, not the live mark. When it
  // chased the live value, a DOWN bettor watching BTC fall saw the ledges
  // slide down ("climbing") while the body dropped — two motions saying
  // opposite things. During the ride the only thing that moves the climber
  // is the market itself; the bell glides the anchor to the new altitude.
  const anchorTarget = seat && seat.buyIn > 0 ? seat.stack / seat.buyIn : 1;
  const anchor = useSmoothed(anchorTarget, 340, 3);
  const meH = heightOfMultiple(anchor);

  /**
   * The wall's own size, so the climber can be scaled and clamped to it.
   *
   * The wall is anywhere from ~240px (a phone) to ~600px (a big desktop)
   * tall. A fixed figure with fixed travel fits only one of those: on a
   * phone it stood on the nameplate, on a short laptop window it climbed off
   * the top. So on every screen the figure scales with the wall's height and
   * its travel is clamped to the band between the top HUD and the bottom
   * edge — the whole character is always on the wall.
   */
  const MAX_OFFSET = 34; // % of wall, the most travel either way
  const wallRef = useRef<HTMLDivElement>(null);
  const [wallBox, setWallBox] = useState({ w: 1024, h: 600, lg: true });
  useEffect(() => {
    const el = wallRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      const lg = window.innerWidth >= 1024;
      setWallBox((b) =>
        Math.abs(b.w - width) < 1 && Math.abs(b.h - height) < 1 && b.lg === lg ? b : { w: width, h: height, lg },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const small = wallBox.w < 640;
  /**
   * Height of a cycle frame (the rope-carrying sprite), in px — from the
   * wall's HEIGHT on every screen. The desktop used to be a fixed 225px with
   * ±34% of travel, which only fits a tall wall: a 1000×650 window gives the
   * wall ~330px, so a climber in profit rose until half of them was cut off
   * by the top edge.
   */
  const ropeH = Math.round(
    small
      ? Math.min(150, Math.max(104, wallBox.h * 0.42))
      : Math.min(225, Math.max(140, wallBox.h * 0.42)),
  );
  /** The gold tag hugs the head: a cycle frame's top 22% is bare rope, and a
   *  tag stacked above all of it wasted a fifth of the wall. */
  const tagOverlap = Math.round(ropeH * 0.18);
  /**
   * Travel, so the WHOLE climber — tag, figure and the status line under it —
   * stays on the wall at either extreme. Top: below lg the clock owns 64px;
   * on lg only the bell ribbon (~22px). Bottom: the phone's slim nameplate is
   * 30px; from sm the plate sits off-centre. The block (16px status line,
   * the frame less the tag overlap, a 22px tag) rests centred in that band
   * and travels the same distance either way.
   */
  const topReserve = wallBox.lg ? 22 : 64;
  const bottomReserve = small ? 30 : 12;
  const band = wallBox.h - topReserve - bottomReserve;
  const block = 16 + ropeH - tagOverlap + 22;
  const room = Math.max(0, (band - block) / 2);
  /** How far the block's bottom edge sits below the anchor line. */
  const bodyOff = Math.round(wallBox.h / 2 - (bottomReserve + room));
  /** Where the rope tile tucks in: behind the body, inside the frame's own rope. */
  const ropeJoin = Math.round(16 + ropeH * 0.62) - bodyOff;
  /** Symmetric, in % of wall height, so a rise and a fall of the same size
   *  travel the same way. */
  const travel = Math.min(MAX_OFFSET, (room / wallBox.h) * 100);

  // BTC's last move, held for a beat so a tick reads as motion, not a blink.
  // The feed repeats the same number across polls (see the chart gotcha), so
  // direction only updates on an actual change.
  const markRef = useRef<{ last: number | null; dir: number; at: number }>({
    last: null,
    dir: 0,
    at: 0,
  });
  if (mark.price !== null) {
    const b = markRef.current;
    if (b.last !== null && mark.price !== b.last) {
      b.dir = Math.sign(mark.price - b.last);
      b.at = Date.now();
    }
    b.last = mark.price;
  }
  const btcDir = Date.now() - markRef.current.at < 3000 ? markRef.current.dir : 0;

  // Every BTC tick lands in the body: a reach up on an up-tick, a sag on a
  // down-tick — RAW, never inverted. The character IS the market; a DOWN bettor
  // wants to watch their climber dive. A nudge is cosmetic lean, never
  // altitude — the tag and BAIL don't move.
  const [nudge, setNudge] = useState(0);

  /**
   * The rope sways. The rope and the climber hang from one pivot at the top
   * of the wall and swing as a pendulum: a slow wind all the time, a jolt on
   * every tick, a tug on every hand-over-hand reach, a big swing at a winning
   * bell. A damped spring, run in its own frame loop and written straight to
   * the DOM — re-rendering the wall at 60fps for a two-degree swing would
   * cost more than everything else on it.
   */
  const swayRef = useRef<HTMLDivElement>(null);
  const sway = useRef({ a: 0, v: 0, taut: false });
  const kick = (degPerSec: number) => {
    sway.current.v += degPerSec;
  };
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = 0;
    const step = (now: number) => {
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      const st = sway.current;
      // ω ≈ 2.2 rad/s: a ~3 s period, the swing of a long rope.
      st.v += (-5 * st.a - 0.9 * st.v) * dt;
      st.a = Math.max(-5, Math.min(5, st.a + st.v * dt));
      const wind = Math.sin(now / 520) * (st.taut ? 0.12 : 0.5);
      if (swayRef.current) swayRef.current.style.transform = `rotate(${(st.a + wind).toFixed(3)}deg)`;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    if (mark.price === null || markRef.current.dir === 0) return;
    setNudge(-markRef.current.dir * 12);
    kick((Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random()));
    const t = setTimeout(() => setNudge(0), 380);
    return () => clearTimeout(t);
    // Keyed on the price on purpose: a repeated value is not a tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mark.price]);

  /**
   * The climber's position on screen IS the mark against the line: center is
   * the strike, above is UP winning, below is DOWN winning. A DOWN bettor
   * cheers the dive. Money never leaves the numbers — tag, altitude and BAIL
   * keep the honest mark — but the BODY belongs to the market.
   *
   * The cumulative altitude (ledges, records) is the camera's anchor; the
   * bell settles the round and the anchor glides to the new height.
   *
   * THE SCALE. This was a flat 1.1% of wall per DOLLAR off the line, hard
   * clamped. Measured against the live feed over five consecutive windows,
   * that is stagnant at both ends: |price − line| has a median of $2 and a
   * p75 of $7.83, so half the time the climber moved under 13px in a whole
   * minute — while the occasional $28 excursion slammed into the clamp and
   * then sat there. Both read as "it isn't moving".
   *
   * So: a FRACTION of the line rather than dollars, which keeps the feel at
   * any BTC price; √cadence, because a 5m window wanders about 2.2× as far
   * as a 1m one; and tanh instead of a clamp, so a big move keeps creeping
   * instead of hitting a wall. One basis point of BTC (~$7.70 at $77k) is
   * 76% of the way to the top.
   */
  //
  // Tuned on BTC; HYPE moves roughly three times as far in a minute, so its
  // rope is three times longer per dollar or the climber would sit pinned
  // against the tanh ceiling for half of every round.
  const REF_FRACTION = mark.asset === "BTC" ? 0.0001 : 0.0003;
  const ref = Math.max(mark.strike ?? 0, 1) * REF_FRACTION * Math.sqrt(intervalSec / 60);
  /*
   * Not gated on holding a position any more. Entries fill late on these
   * books and rounds overlap, so a player spends much of the minute with
   * `inRound` false — and the gate pinned them dead centre for all of it.
   * The line is real whether or not their money is on it yet.
   */
  const rawOffset =
    mark.price !== null && mark.strike !== null
      ? travel * Math.tanh((mark.price - mark.strike) / ref)
      : 0;
  const offset = useSmoothed(rawOffset, 300, 200);

  // Direction of travel, in screen truth: the BTC offset while it moves, the
  // anchor glide while it settles, the last tick when both are quiet.
  const glideUp = heightOfMultiple(anchorTarget) > meH + 0.0015;
  const glideDown = heightOfMultiple(anchorTarget) < meH - 0.0015;
  const offUp = rawOffset > offset + 0.4;
  const offDown = rawOffset < offset - 0.4;
  const rising = offUp || (!offDown && glideUp) || (!offDown && !glideDown && btcDir > 0);
  const sinking = offDown || (!offUp && glideDown) || (!offUp && !glideUp && btcDir < 0);

  // Milestone crossings, upward only. The chime belongs to gains.
  const lastMult = useRef(anchor);
  useEffect(() => {
    const was = lastMult.current;
    lastMult.current = anchor;
    if (!seat) return;
    for (const m of MILESTONES) {
      if (m > 1 && was < m && anchor >= m) onMilestone?.(m);
    }
  }, [anchor, seat, onMilestone]);

  const dead = seat ? falling.includes(seat.runId) : false;
  const bailed = seat ? leaping.includes(seat.runId) : false;
  const hanging = multiple < HANGING && (seat?.inRound ?? false);
  // A climber hanging on by the fingertips pulls the rope taut.
  sway.current.taut = hanging;
  const cheer = seat && !dead && !bailed ? cheering.find((c) => c.runId === seat.runId) ?? null : null;
  // Where the rope was when it snapped: the offset keeps gliding toward the
  // next round's line, the cut does not.
  const snapOffset = useRef(0);

  const pose: Pose = bailed
    ? "leap"
    : dead
      ? "fall"
      : hanging || sinking
        ? "slip"
        : rising
          ? "climb"
          : "climb";

  // How the hands work the rope. Off the rope entirely when falling or leaping.
  const grip =
    dead || bailed
      ? ""
      : hanging
        ? "hanging"
        : rising
          ? "climbing"
          : sinking
            ? "sliding"
            : "dangling";

  const art = climber;
  const cast = CAST.find((c) => c.id === climber) ?? CAST[0];

  // On the rope = showing a cycle frame (the rope is baked into them).
  // Off the rope (falling, leaping) = the pose sprites, which have none.
  const hasCycle = CYCLE_READY.has(art);
  const onRope = hasCycle && !dead && !bailed;
  // Pose sprites have no rope above or below the figure, so they render at
  // ~61% of a cycle frame to keep the CHARACTER the same size.
  const spriteH = onRope ? ropeH : Math.round(ropeH * 0.61);
  const [frame, setFrame] = useState(0);
  const cycleActive = onRope && !hanging && (rising || sinking);
  useEffect(() => {
    if (!cycleActive) return;
    // Rising plays the cycle forward, sinking plays it backward (hand under
    // hand). The slide is slower — losing ground drags.
    const ms = rising ? 130 : 190;
    const id = setInterval(() => setFrame((f) => (f + (rising ? 1 : 5)) % 6), ms);
    return () => clearInterval(id);
  }, [cycleActive, rising]);
  // Each reach tugs the rope: one hand left, the other right.
  useEffect(() => {
    if (cycleActive && (frame === 0 || frame === 3)) kick(frame === 0 ? 0.8 : -0.8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);
  useEffect(() => {
    if (cheer) kick(8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bellKey, Boolean(cheer)]);
  if (!dead) snapOffset.current = offset;
  const cutOffset = dead ? snapOffset.current : offset;
  useEffect(() => {
    if (!hasCycle) return;
    for (let i = 0; i < 6; i++) {
      const im = new window.Image();
      im.src = `/climbers/${art}/cycle/${i}.webp`;
    }
  }, [hasCycle, art]);
  const finale = secondsLeft > 0 && secondsLeft <= 5 && (seat?.inRound ?? false);
  const urgent = secondsLeft > 0 && secondsLeft < 10;

  /** A wall feature at height h, in viewport terms. The camera does the work. */
  const bottomOf = (h: number) => 50 + (h - meH) * SPREAD;
  const visible = (b: number) => b > -10 && b < 112;

  const myBest = seat?.best ?? null;
  const bestBeaten = myBest !== null && multiple > myBest;

  // How deep into space the run has climbed: 0 at break-even, 1 at 12×.
  const spaceT = Math.max(0, Math.min(1, Math.log(Math.max(anchor, 1)) / Math.log(12)));

  // On lg the wall fills its wrapper EXACTLY — the height floor lives on the
  // wrapper in play/page.tsx. A min-height here made the wall taller than its
  // flex slot on short viewports, sliding it under the phase strip with the
  // nameplate floating on top.
  return (
    <div
      ref={wallRef}
      /* Below lg the wall is the viewport minus `--chrome-h` — the MEASURED
         header, rail and dock from play/page.tsx — so the stage ends exactly
         where the docked controls begin. */
      className="ticks relative h-[calc(100dvh-var(--chrome-h,420px))] min-h-[240px] overflow-hidden rounded-2xl border lg:h-full lg:min-h-0"
      style={{
        borderColor: urgent ? "#3d1220" : "var(--edge)",
        background:
          hanging && !dead
            ? "linear-gradient(180deg, #251029 0%, #150b1a 50%, #0b0814 100%)"
            : "linear-gradient(180deg, #1c1738 0%, #131028 45%, #0b0917 100%)",
        boxShadow: "inset 0 2px 24px #000000cc",
        transition: "background 900ms",
      }}
    >
      {/* the sky: two star layers parallaxing with altitude (near moves
          faster than far — depth you can feel every time you climb) and
          nebulas breathing in the corners. This is what makes the wall a
          PLACE instead of a panel.

          And the sky REACTS to altitude: spaceT runs 0 at break-even to 1
          at 12× — the higher the run, the deeper into space it climbs.
          The wall darkens toward void, stars sharpen, nebulas bloom, and
          the neon ground fades away far below. Altitude you can feel. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(180deg, #040210 0%, #0b0426 60%, #0d0620 100%)",
            opacity: spaceT * 0.8,
          }}
        />
        <div
          className="stars-far absolute inset-0"
          style={{
            backgroundPositionY: `${meH * SPREAD * 1.6}px`,
            opacity: 0.55 + 0.45 * spaceT,
          }}
        />
        <div
          className="stars-near absolute inset-0"
          style={{
            backgroundPositionY: `${meH * SPREAD * 3.4}px`,
            opacity: 0.6 + 0.4 * spaceT,
          }}
        />
        <div className="absolute inset-0" style={{ opacity: 0.7 + 0.3 * spaceT }}>
          <div className="nebula absolute inset-0" />
        </div>
        <div
          className="grid-floor absolute inset-x-[-15%] bottom-0 h-[42%]"
          style={{ opacity: 1 - spaceT * 0.85 }}
        />
      </div>

      {/* the stage: everything that zooms in the finale */}
      <div
        className="absolute inset-0"
        style={{
          transform: finale ? "scale(1.25)" : "scale(1)",
          transformOrigin: "50% 50%",
          transition: "transform 1600ms cubic-bezier(0.25, 0.8, 0.25, 1)",
        }}
      >
        {/* milestone ledges — fixed on the wall, so the camera slides them past */}
        {MILESTONES.map((m, i) => {
          const b = bottomOf(heightOfMultiple(m));
          if (!visible(b)) return null;
          const isEven = m === 1;
          // Alternate sides, clear of the rope and of the HUD corners.
          const propSide = i % 2 ? { right: "21%" } : { left: "21%" };
          return (
            <div
              key={m}
              className="pointer-events-none absolute inset-x-0"
              style={{ bottom: `${b}%` }}
            >
              <div
                className="h-[2px] w-full"
                style={{
                  background: isEven
                    ? "repeating-linear-gradient(90deg, var(--gold) 0 10px, transparent 10px 20px)"
                    : "repeating-linear-gradient(90deg, #ffffff 0 6px, transparent 6px 16px)",
                  opacity: isEven ? 0.7 : m > 1 ? 0.16 : 0.1,
                  boxShadow: isEven ? "0 0 14px var(--gold-glow)" : "none",
                }}
              />
              {b > 6 && b < 80 && (
                <div className="absolute bottom-[2px]" style={propSide}>
                  <LedgeProp m={m} lit={m >= 1 && anchor >= m - 1e-6} />
                </div>
              )}
              {/* The BTC readout owns the top-right corner; a ledge label that
                  drifts up there would print straight through it. */}
              {b < 78 && (
                <span
                  className={`tabular absolute right-3 -top-4 text-[9px] font-black tracking-[0.2em] ${
                    isEven ? "glow-gold" : "text-[var(--dim)]"
                  }`}
                  style={{ opacity: isEven ? 1 : 0.75 }}
                >
                  {isEven ? "BREAK EVEN" : `${m}×`}
                </span>
              )}
            </div>
          );
        })}

        {/* the all-time record — a flag planted in the wall */}
        {record &&
          record.multiple > 1 &&
          visible(bottomOf(heightOfMultiple(record.multiple))) && (
            <div
              className="pointer-events-none absolute inset-x-0"
              style={{
                bottom: `${bottomOf(heightOfMultiple(record.multiple))}%`,
              }}
            >
              <div
                className="h-px w-full"
                style={{
                  background:
                    "repeating-linear-gradient(90deg, var(--gold) 0 4px, transparent 4px 12px)",
                  opacity: 0.55,
                }}
              />
              {/* the altitude readout owns the top-left, the nameplate the
                  bottom-left; a flag drifting into either printed through it */}
              {(() => {
                const b = bottomOf(heightOfMultiple(record.multiple));
                return b < 78 && b > 12;
              })() && (
                <span className="absolute left-3 -top-4 text-[9px] font-black tracking-[0.2em] text-[var(--gold)] opacity-90">
                  ⚑ {record.name.toUpperCase()} · {record.multiple.toFixed(2)}×
                </span>
              )}
            </div>
          )}

        {/* your own best — brightens the moment you pass it */}
        {myBest !== null && myBest > 1 && visible(bottomOf(heightOfMultiple(myBest))) && (
          <div
            className="pointer-events-none absolute inset-x-0"
            style={{
              bottom: `${bottomOf(heightOfMultiple(myBest))}%`,
            }}
          >
            <div
              className="h-px w-full"
              style={{
                background:
                  "repeating-linear-gradient(90deg, var(--text) 0 4px, transparent 4px 12px)",
                opacity: bestBeaten ? 0.7 : 0.22,
                boxShadow: bestBeaten ? "0 0 12px var(--gold-glow)" : "none",
              }}
            />
            {(() => {
              const b = bottomOf(heightOfMultiple(myBest));
              return b < 78 && b > 12;
            })() && (
              <span
                className="absolute left-3 -top-4 text-[9px] font-black tracking-[0.2em]"
                style={{ color: bestBeaten ? "var(--gold)" : "var(--dim)" }}
              >
                {bestBeaten ? "★ NEW BEST" : `YOUR BEST · ${myBest.toFixed(2)}×`}
              </span>
            )}
          </div>
        )}

        {/* the rope above: THE ACTUAL ROPE. A tile cut from this character's
            own frames (scripts/ropealign.ts) repeats from above the summit
            down into the grip — same pixels, same twist, and the frames are
            re-centered on the rope so the strand never jumps sideways. It
            tucks into the sprite so the join hides behind the body. */}
        {/* rope and climber hang from one pivot and sway together */}
        <div ref={swayRef} className="pointer-events-none absolute inset-0 z-10" style={{ transformOrigin: "50% -5%" }}>
        {seat && !bailed && (
          <div
            // A losing bell SNAPS the rope: the upper piece recoils and
            // whips; a winning one runs gold up its length.
            key={dead ? "snapped" : `rope-${cheer ? bellKey : "x"}`}
            className={`pointer-events-none absolute left-1/2 z-10 w-[8px] -translate-x-1/2 ${dead ? "rope-snap" : cheer ? "rope-gold" : ""}`}
            style={{
              top: "-5%",
              bottom: `calc(${50 + cutOffset}% + ${ropeJoin}px)`,
              backgroundImage: `url(/climbers/${art}/rope.webp)`,
              backgroundRepeat: "repeat-y",
              backgroundSize: "100% auto",
            }}
          />
        )}

        {/* the finish at the bell */}
        {seat && dead && (
          <div
            key={`snap-${bellKey}`}
            className="pointer-events-none absolute left-1/2 z-30"
            style={{ bottom: `calc(${50 + cutOffset}% + ${ropeJoin}px)` }}
          >
            <span className="snap-flash absolute -left-6 -top-6 h-12 w-12 rounded-full" style={{ background: "radial-gradient(circle, #fff 0%, #ffe6b0 30%, transparent 70%)" }} />
            {FIBRES.map((f, i) => (
              <span
                key={i}
                className="spark absolute -left-px -top-1 h-2.5 w-[2px] rounded-full"
                style={{ background: "#c79a62", rotate: `${f.rot}deg`, ["--dx" as string]: `${f.dx}px`, ["--dy" as string]: `${f.dy}px` }}
              />
            ))}
          </div>
        )}
        {seat && dead && (
          <div key={`puff-${bellKey}`} className="pointer-events-none absolute bottom-0 left-1/2 z-30 -translate-x-1/2">
            {[-26, 0, 26].map((x) => (
              <span
                key={x}
                className="dust-puff absolute bottom-0 h-10 w-10 rounded-full"
                style={{ left: x - 20, background: "radial-gradient(circle, #8f86b8aa 0%, transparent 70%)" }}
              />
            ))}
          </div>
        )}
        {cheer && (
          <>
            <span
              key={`zip-${bellKey}`}
              className="rope-zip pointer-events-none absolute left-1/2 z-10 h-[70px] w-[14px] rounded-full"
              style={{
                marginLeft: -7,
                bottom: `calc(${50 + offset}% + ${ropeJoin}px)`,
                background: "radial-gradient(ellipse at center, #fff6c8 0%, var(--gold) 35%, transparent 72%)",
              }}
            />
            <div
              key={`burst-${bellKey}`}
              className="pointer-events-none absolute left-1/2 z-30"
              style={{ bottom: `calc(${50 + offset}% - ${bodyOff}px + ${16 + Math.round(ropeH * 0.5)}px)` }}
            >
              {SPARKS.map((p, i) => (
                <span
                  key={i}
                  className="spark absolute -left-1 -top-1 h-2 w-2 rounded-full"
                  style={{
                    background: p.gold ? "var(--gold)" : "#fff",
                    boxShadow: `0 0 8px ${p.gold ? "var(--gold-glow)" : "#ffffffaa"}`,
                    ["--dx" as string]: `${p.dx}px`,
                    ["--dy" as string]: `${p.dy}px`,
                  }}
                />
              ))}
            </div>
            <div
              key={`gain-${bellKey}`}
              className="gain-rise display pointer-events-none absolute left-1/2 z-30 -ml-20 w-40 text-center text-2xl sm:text-3xl"
              style={{
                bottom: `calc(${50 + offset}% - ${bodyOff}px + ${16 + ropeH - tagOverlap + 26}px)`,
                color: "var(--gold)",
                textShadow: "0 0 24px var(--gold-glow), 0 2px 0 #000",
              }}
            >
              +${cheer.gain.toFixed(2)}
            </div>
          </>
        )}

        {/* the climber — pinned to the middle while the world moves. The rope
            lives INSIDE the cycle frames now: every character carries their
            own strand, so there is no separate background rope to disagree
            with the grip. */}
        {seat && (
          <div
            className="absolute left-1/2 flex flex-col items-center"
            style={{
              bottom: bailed ? "118%" : dead ? "-30%" : `calc(${50 + offset}% - ${bodyOff}px)`,
              transform: bailed
                ? "translateX(-50%) translateX(90px)"
                : dead
                  ? "translateX(-50%) rotate(-24deg)"
                  : `translateX(-50%) translateY(${nudge}px)`,
              opacity: bailed ? 0 : 1,
              transition: bailed
                ? "bottom 700ms cubic-bezier(0.2, 0.9, 0.3, 1), transform 700ms ease-out, opacity 700ms ease-in 300ms"
                : dead
                  ? "bottom 1100ms cubic-bezier(0.5, 0, 0.9, 0.4) 120ms, transform 1100ms ease-in 120ms"
                  : "transform 380ms cubic-bezier(0.34, 1.3, 0.5, 1)",
              zIndex: 20,
            }}
          >
            <div key={`hop-${cheer ? bellKey : "x"}`} className={`flex flex-col items-center ${cheer ? "climber-hop" : ""}`}>
            <div
              className="tabular relative z-[1] whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-black"
              style={{
                background: "var(--gold)",
                color: "#000",
                marginBottom: onRope ? -tagOverlap : 4,
                // the tag lets go as the body drops
                opacity: dead ? 0 : 1,
                transition: "opacity 450ms ease-out",
              }}
            >
              {seat.name} {multiple.toFixed(2)}×
            </div>
            <Image
              src={onRope ? `/climbers/${art}/cycle/${frame}.webp` : `/climbers/${art}/${pose}.webp`}
              alt=""
              width={96}
              height={onRope ? 300 : 140}
              priority
              unoptimized
              // Cycle frames carry their own rope above and below the figure,
              // so they render taller to keep the CHARACTER the same size.
              // While moving, the frames ARE the animation; holding still
              // gets the dangle sway, barely-alive gets the scrabble.
              className={`w-auto ${onRope ? "h-[150px] sm:h-[225px]" : "h-[92px] sm:h-[140px]"} ${
                cycleActive ? "" : onRope ? (hanging ? "hanging" : "dangling") : grip
              }`}
              style={{
                // measured, not breakpointed: the figure scales with the
                // wall it is on (see wallBox above)
                height: spriteH,
                filter: "drop-shadow(0 0 16px var(--gold-glow))",
                transform: !onRope && pose === "slip" ? "scaleX(-1)" : undefined,
              }}
            />
            {seat.inRound && !dead && !bailed && (
              <span
                className="mt-1 text-[9px] font-black tracking-[0.25em]"
                style={{ color: hanging ? "var(--down)" : "var(--dim)" }}
              >
                {hanging ? "HANGING ON" : seat.pick === "UP" ? "▲ RIDING UP" : "▼ RIDING DOWN"}
              </span>
            )}
            {seat && !seat.inRound && !dead && !bailed && (
              <span className="mt-1 text-[9px] font-black tracking-[0.25em] text-[var(--dim)]">
                WAITING FOR THE ROUND
              </span>
            )}
            </div>
          </div>
        )}
        </div>
      </div>

      {!seat && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center">
          <Image
            src={`/climbers/${art}/cheer.webp`}
            alt=""
            width={96}
            height={140}
            priority
            unoptimized
            className="h-[110px] w-auto opacity-60 sm:h-[130px]"
            style={{ filter: "grayscale(0.4)" }}
          />
          <span className="mt-2 text-[10px] font-black tracking-[0.3em] text-[var(--dim)]">
            THE WALL IS WAITING — TAKE A SEAT
          </span>
        </div>
      )}

      {/* the Hyperliquid mark against the line — the market that moves the wall */}
      {mark.price !== null && mark.strike !== null && (
        <div className="pointer-events-none absolute right-4 top-3 text-right">
          <p
            className="display tabular text-xl leading-none sm:text-3xl"
            style={{
              color: mark.price >= mark.strike ? "var(--up)" : "var(--down)",
              textShadow: `0 0 36px ${mark.price >= mark.strike ? "var(--up-glow)" : "var(--down-glow)"}`,
            }}
          >
            ${fmtMark(mark.price)}
          </p>
          <p
            className="tabular text-[10px] font-black tracking-widest"
            style={{ color: mark.price >= mark.strike ? "var(--up)" : "var(--down)" }}
          >
            {mark.price >= mark.strike ? "▲ +$" : "▼ −$"}
            {fmtMove(mark.price - mark.strike, mark.strike)}
          </p>
          <p className="tabular mt-0.5 text-[9px] font-bold tracking-widest text-[var(--dim)]">
            TO BEAT ${fmtMark(mark.strike)}
          </p>
        </div>
      )}

      {/* the wall remembers: how the last windows closed, oldest fading out
          on the left, the newest bell at full strength on the right */}
      {bells.length > 0 && (
        <div className="absolute inset-x-0 top-[62px] z-10 hidden justify-center gap-[5px] sm:flex lg:top-2">
          {bells.map((b, i) => (
            <span
              key={b.index}
              title={`RND ${b.index}${
                b.closedBy != null
                  ? ` · closed ${b.closedBy >= 0 ? "+$" : "−$"}${fmtMove(b.closedBy, mark.strike ?? 100)}`
                  : ""
              }${b.voided ? " · VOID — push" : ""}`}
              className="text-[10px] font-black leading-none"
              style={{
                color: b.voided ? "var(--dim)" : b.winner === "UP" ? "var(--up)" : "var(--down)",
                opacity: 0.4 + (0.6 * (i + 1)) / bells.length,
              }}
            >
              {b.voided ? "○" : b.winner === "UP" ? "▲" : "▼"}
            </span>
          ))}
        </div>
      )}

      {/* the nameplate — a character, not a cursor. On a phone the 3xl
          plate was a third of the wall's width and the climber stood on it;
          there it is one slim line along the bottom edge instead. */}
      {seat && (
        <div className="pointer-events-none absolute bottom-2.5 left-3 z-10 flex items-center gap-1.5 sm:hidden">
          <span className="display text-[11px] tracking-[0.06em]" style={{ color: "#eeecf5" }}>
            {cast.label}
          </span>
          <span className="text-[9px] font-black tracking-[0.2em] text-[var(--accent)]">
            {seat.name.toUpperCase()}
          </span>
          <span
            className="rounded-sm px-1 py-[1px] text-[8px] font-black tracking-[0.2em]"
            style={seat.paid
              ? { background: "var(--gold)", color: "#000" }
              : { border: "1px solid var(--edge)", color: "var(--dim)" }}
          >
            {seat.paid ? "REAL" : "FREE"}
          </span>
        </div>
      )}
      {seat && (
        <div className="pointer-events-none absolute bottom-5 left-4 z-10 hidden sm:block">
          <p className="text-[9px] font-black tracking-[0.35em] text-[var(--dim)]">{cast.code}</p>
          <p className="plate-name display text-3xl leading-none tracking-[0.06em] sm:text-5xl" style={{ color: "#eeecf5", textShadow: "0 0 34px #00000088" }}>
            {cast.label}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="hatch inline-block h-[8px] w-16" />
            <span className="text-[10px] font-black tracking-[0.25em] text-[var(--accent)]">
              {seat.name.toUpperCase()}
            </span>
            <span
              className="rounded-sm px-1.5 py-[1px] text-[8px] font-black tracking-[0.2em]"
              style={seat.paid
                ? { background: "var(--gold)", color: "#000" }
                : { border: "1px solid var(--edge)", color: "var(--dim)" }}
            >
              {seat.paid ? "RANKED" : "PRACTICE"}
            </span>
          </div>
        </div>
      )}

      {/* the clock, top-centre, below lg: the number that matters lives on
          the stage. From lg the header's outlined 7xl numeral carries it. */}
      <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 text-center lg:hidden">
        <div
          className={`display tabular outline-num text-4xl leading-none sm:text-5xl ${clockUrgent && !stalled ? "clock-urgent" : ""}`}
          style={stalled ? { color: "var(--dim)" } : settling ? { color: "var(--gold)" } : undefined}
        >
          {stalled || settling ? "··" : bigClock(secondsLeft)}
        </div>
        <p className="mt-0.5 text-[8px] font-bold tracking-[0.3em] text-[var(--dim)]">
          {stalled ? "CLOCK PAUSED" : settling ? "SETTLING · NEXT ROPE" : "TO THE BELL"}
        </p>
      </div>

      {/* your money, top-left, below lg: the stat panel and the money bar
          carry this on desktop. Dollars big, the multiple and the run's
          delta small — what a player actually checks between glances. */}
      {seat && (() => {
        const dollars = multiple * seat.buyIn;
        const delta = dollars - seat.buyIn;
        const c = delta >= 0 ? "var(--up)" : "var(--down)";
        return (
          <div className="pointer-events-none absolute left-3 top-2.5 lg:hidden">
            <p className="text-[8px] font-black tracking-[0.25em] text-[var(--dim)]">ON THE WALL</p>
            <p className="display tabular text-2xl leading-none sm:text-3xl" style={{ color: c, textShadow: `0 0 24px ${c}55` }}>
              {dollars.toFixed(2)}
            </p>
            <p className="tabular mt-0.5 text-[9px] font-black tracking-[0.15em]" style={{ color: c }}>
              {multiple.toFixed(2)}× · {delta >= 0 ? "+" : "−"}{Math.abs(delta).toFixed(2)}
            </p>
          </div>
        );
      })()}

      {/* time, draining */}
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-[#ffffff0a]">
        <div
          className="h-full transition-[width] duration-1000 ease-linear"
          style={{
            width: `${Math.max(0, Math.min(100, (secondsLeft / intervalSec) * 100))}%`,
            background: secondsLeft < 10 ? "var(--down)" : "var(--gold)",
            boxShadow: `0 0 16px ${secondsLeft < 10 ? "var(--down)" : "var(--gold)"}`,
          }}
        />
      </div>
    </div>
  );
}
