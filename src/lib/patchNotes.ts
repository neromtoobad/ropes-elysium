/**
 * What shipped, newest first. Written for players, not for git: one line per
 * thing they would notice. Add an entry with every release that changes
 * what a player sees or can do; fixes nobody could see can stay in git.
 */
export type PatchNote = { date: string; title: string; items: string[] };

export const PATCH_NOTES: PatchNote[] = [
  {
    date: "2026-10-30",
    title: "Points, invites, feedback and lessons",
    items: [
      "ROPES Points, Season 0. Every ranked seat scores: rounds survived, banked profits, the last one holding, your first seat of the day and weekly board finishes.",
      "Leagues from Base Camp to Summit, a last-24h table, and arrows showing how far you moved since yesterday.",
      "Put your X handle on the boards from the points page.",
      "Invite links. You earn 10% of the points the wallets you bring in earn.",
      "This feedback board, with points for bugs we confirm and ideas we ship.",
      "The learn hub: 13 two-minute lessons, from setting up a wallet to checking a round yourself, each with a quick check at the end.",
    ],
  },
  {
    date: "2026-10-29",
    title: "Ranked play and a new home",
    items: [
      "Ranked and practice seats. Ranked seats come from your own bankroll and count on the boards, up to 20 a wallet a day. Practice is free and never counts.",
      "Weekly boards: the Summit for net winnings and the Longest Climb for rounds survived, reset every Monday 00:00 UTC.",
      "ROPES moved to playropes.xyz. Old links still work.",
      "A new home page: the week's top climbers hang on the wall at the height of their best climb.",
      "The horizontal knot logo everywhere.",
      "Moved to the new market contract with the vault fix. Rounds carry on from 5,151.",
    ],
  },
  {
    date: "2026-10-28",
    title: "Fairer vault pricing",
    items: ["House vault deposits are priced at the best case for the vault and withdrawals at the worst, so nobody can time an entry or exit against the other depositors."],
  },
  {
    date: "2026-10-25",
    title: "A smoother bell",
    items: [
      "The countdown no longer jumps when a slow update arrives late.",
      "The settling label stops flickering through the last second.",
      "Your wallet switches to Elysium before every transaction, so a wrong-network popup can't eat a deposit.",
    ],
  },
  {
    date: "2026-10-21",
    title: "Docs, proof and $ROPES",
    items: [
      "Full docs, and a live transparency page where anyone can check settled rounds against the price source.",
      "Mainnet countdown and the $ROPES token page.",
      "Link previews for every page.",
      "Seats nobody is playing get retired, so an empty wall can go quiet instead of burning gas.",
    ],
  },
  {
    date: "2026-10-18",
    title: "ROPES on Elysium",
    items: [
      "The game launches on Elysium testnet: one minute of HYPE, up or down, priced from the live Hyperliquid mark.",
      "Every round starts and settles on Hyperliquid's own 1-minute candle open, and the audit checks it to the exact tick.",
      "BAIL works right up to the bell. Voided rounds refund.",
      "Idle mode: no new rounds when nobody is seated or watching.",
    ],
  },
];
