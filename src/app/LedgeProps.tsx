/**
 * Little props standing on the milestone ledges, so the wall reads as a
 * mountain with places on it rather than a ruler.
 *
 * Above break-even they are the climb's rewards — base camp, a piton, a
 * pennant, a campfire, a cairn, the summit and on into space — dim until the
 * run's banked altitude reaches them, then lit. Below it they are hazards,
 * always at half strength: a broken ladder, a warning sign, a skull.
 *
 * Every prop is drawn in a 40×40 box whose bottom edge sits ON the ledge.
 */
const ROCK = "#2e2850";
const ROCK_HI = "#463d73";
const METAL = "#c9c4dc";
const WOOD = "#8a5a36";

function Shelf() {
  return <path d="M3 40 L7 36 H33 L37 40 Z" fill={ROCK} />;
}

function Art({ m }: { m: number }) {
  switch (m) {
    case 0.25: // a skull, where runs go to die
      return (
        <>
          <Shelf />
          <path d="M12 30 a8 8 0 1 1 16 0 v3 h-3 v3 h-10 v-3 h-3 z" fill="#d9d4e8" />
          <circle cx="16.5" cy="29" r="2.2" fill="#140f24" />
          <circle cx="23.5" cy="29" r="2.2" fill="#140f24" />
          <path d="M19 33 h2 v2 h-2 z" fill="#140f24" />
        </>
      );
    case 0.5: // a warning sign on a post
      return (
        <>
          <Shelf />
          <rect x="19" y="20" width="2.5" height="16" fill={WOOD} />
          <path d="M20.2 8 L31 26 H9.5 Z" fill="var(--down)" />
          <rect x="19.2" y="13" width="2" height="7" fill="#140f24" />
          <rect x="19.2" y="21.5" width="2" height="2" fill="#140f24" />
        </>
      );
    case 0.75: // a broken ladder, one rail snapped
      return (
        <>
          <Shelf />
          <rect x="11" y="10" width="2.5" height="26" fill={WOOD} />
          <rect x="25" y="22" width="2.5" height="14" fill={WOOD} />
          <rect x="27" y="11" width="2.5" height="9" fill={WOOD} transform="rotate(24 28 16)" />
          <rect x="11" y="30" width="16" height="2" fill={WOOD} />
          <rect x="11" y="24" width="16" height="2" fill={WOOD} />
          <rect x="11" y="17" width="9" height="2" fill={WOOD} transform="rotate(-14 11 18)" />
        </>
      );
    case 1: // base camp, on Elysium
      return (
        <>
          <Shelf />
          <path d="M7 36 L20 15 L33 36 Z" fill="var(--gold)" />
          <path d="M20 15 L33 36 H26 Z" fill="#000" opacity="0.22" />
          <path d="M16.5 36 L20 28 L23.5 36 Z" fill="#1a1530" />
          <rect x="19.3" y="2" width="1.4" height="14" fill={METAL} />
          {/* base camp flies the flag of the chain it stands on */}
          <circle cx="26" cy="7" r="5.6" fill="#fff" />
          <image href="/elysium/badge-96.webp" x="20.9" y="1.9" width="10.2" height="10.2" />
        </>
      );
    case 1.25: // a piton in a boulder, carabiner hanging
      return (
        <>
          <path d="M5 40 Q7 24 19 22 Q32 22 35 40 Z" fill={ROCK} />
          <path d="M9 31 Q12 25 19 24" stroke={ROCK_HI} strokeWidth="1.5" fill="none" />
          <rect x="15" y="27" width="11" height="2.6" fill={METAL} />
          <ellipse cx="27" cy="33" rx="2.8" ry="4.2" fill="none" stroke="var(--gold)" strokeWidth="1.6" />
        </>
      );
    case 1.5: // a pennant
      return (
        <>
          <Shelf />
          <rect x="12" y="8" width="2" height="28" fill={METAL} />
          <path className="ledge-wave" d="M14 9 L32 14 L14 19 Z" fill="var(--up)" />
        </>
      );
    case 2: // a campfire
      return (
        <>
          <Shelf />
          <rect x="9" y="32" width="22" height="3" rx="1.5" fill={WOOD} transform="rotate(12 20 33)" />
          <rect x="9" y="32" width="22" height="3" rx="1.5" fill="#6d4426" transform="rotate(-12 20 33)" />
          <path className="ledge-flicker" d="M20 12 C26 20 27 25 24 31 H16 C13 25 15 20 20 12 Z" fill="#ff8a2b" />
          <path className="ledge-flicker-b" d="M20 19 C23 24 23 27 22 31 H18 C17 27 17 24 20 19 Z" fill="#ffd36b" />
        </>
      );
    case 3: // a cairn
      return (
        <>
          <Shelf />
          <ellipse cx="20" cy="33" rx="11" ry="3.6" fill={ROCK_HI} />
          <ellipse cx="20" cy="27" rx="8" ry="3.2" fill="#5a5088" />
          <ellipse cx="20" cy="21.5" rx="5.5" ry="2.8" fill={ROCK_HI} />
          <ellipse cx="20" cy="17" rx="3.4" ry="2.3" fill="#6f64a3" />
        </>
      );
    case 5: // the summit
      return (
        <>
          <path d="M3 40 L20 12 L37 40 Z" fill={ROCK_HI} />
          <path d="M14 22 L20 12 L26 22 L23 20 L20 23 L17 20 Z" fill="#eeecf5" />
          <rect x="19.3" y="2" width="1.4" height="11" fill={METAL} />
          <path d="M20.7 2.5 L28 5 L20.7 7.5 Z" fill="var(--gold)" />
        </>
      );
    case 8: // a beacon, past the weather
      return (
        <>
          <Shelf />
          <path d="M14 36 L20 14 L26 36" stroke={METAL} strokeWidth="1.8" fill="none" />
          <path d="M16 29 H24 M17.5 23 H22.5" stroke={METAL} strokeWidth="1.4" />
          <circle className="ledge-blink" cx="20" cy="12" r="3" fill="var(--down)" />
        </>
      );
    case 12: // a flag on a moon rock
      return (
        <>
          <path d="M4 40 Q8 30 20 29 Q32 30 36 40 Z" fill="#8f8aa8" />
          <circle cx="13" cy="35" r="2" fill="#6f6a88" />
          <circle cx="27" cy="34" r="1.5" fill="#6f6a88" />
          <rect x="19" y="8" width="1.6" height="22" fill={METAL} />
          <rect x="20.6" y="8.5" width="12" height="8" fill="var(--up)" />
          <path d="M26.6 10 l1 2 h2 l-1.6 1.3 .6 2 -2-1.2 -2 1.2 .6-2 -1.6-1.3 h2 z" fill="#fff" />
        </>
      );
    case 20: // the crown
      return (
        <>
          <Shelf />
          <path d="M8 34 L6 16 L14 24 L20 12 L26 24 L34 16 L32 34 Z" fill="var(--gold)" />
          <circle cx="20" cy="27" r="2.4" fill="var(--down)" />
          <circle cx="12.5" cy="29" r="1.6" fill="var(--up)" />
          <circle cx="27.5" cy="29" r="1.6" fill="var(--up)" />
        </>
      );
    default:
      return null;
  }
}

/** The prop for ledge `m`, lit once the run's banked altitude reaches it. */
export function LedgeProp({ m, lit }: { m: number; lit: boolean }) {
  const hazard = m < 1;
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden="true"
      className="h-9 w-9 sm:h-14 sm:w-14"
      style={{
        opacity: hazard ? 0.55 : lit ? 1 : 0.32,
        filter: lit && !hazard ? "drop-shadow(0 0 8px var(--gold-glow))" : hazard ? "none" : "grayscale(0.7)",
        transition: "opacity 700ms, filter 700ms",
      }}
    >
      <Art m={m} />
    </svg>
  );
}
