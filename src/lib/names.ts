/**
 * Names for climbers who never typed one: an adjective and an animal, short
 * enough for the 12-character seat name ("SwiftGecko", "BoldLynx").
 *
 * The old default was "climber" or "climber123", which filled the boards with
 * the same word. isPlaceholderName spots those so they can be replaced.
 */
const ADJ = [
  "Swift", "Bold", "Calm", "Wild", "Lucky", "Brave", "Sly", "Quick", "Keen", "Steady",
  "Fierce", "Sharp", "Grim", "Sunny", "Iron", "Gold", "Jade", "Ruby", "Frost", "Storm",
  "Neon", "Dusk", "Dawn", "Rogue", "Silent", "Royal", "Cosmic", "Lunar", "Solar", "Turbo",
];
const ANIMAL = [
  "Gecko", "Lynx", "Ibex", "Hawk", "Falcon", "Otter", "Fox", "Wolf", "Puma", "Raven",
  "Yak", "Goat", "Lemur", "Panda", "Tiger", "Eagle", "Viper", "Moose", "Bison", "Heron",
  "Koala", "Mole", "Crab", "Owl", "Shark", "Bear", "Hare", "Orca", "Jaguar", "Sloth",
];

const pick = <T,>(xs: T[], n: number) => xs[Math.abs(n) % xs.length];

/** A fresh random name. */
export function randomName() {
  const a = pick(ADJ, Math.floor(Math.random() * ADJ.length));
  const b = pick(ANIMAL, Math.floor(Math.random() * ANIMAL.length));
  return `${a}${b}`.slice(0, 12);
}

/** The same name every time for the same seed (a wallet, say). */
export function nameFor(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return `${pick(ADJ, h)}${pick(ANIMAL, h >>> 8)}`.slice(0, 12);
}

/** "climber", "Climber", "climber353": the old defaults. */
export const isPlaceholderName = (n: string | null | undefined) => !n || /^climber\d*$/i.test(n.trim());

/** The name to show for a player: theirs, or a stable stand-in for an old
 *  placeholder. Seeded by the db id, never the wallet (that is the playerKey). */
export const shownName = (p: { displayName: string; id: string }) => (isPlaceholderName(p.displayName) ? nameFor(p.id) : p.displayName);
