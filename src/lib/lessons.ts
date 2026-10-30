/**
 * The learn hub: short lessons, two or three minutes each, in the order a new
 * player needs them. The docs are the reference; these are the walk-through.
 * Every number here is the game's real rule — when a rule changes, change it
 * in the docs AND here.
 *
 * Text supports **bold** and nothing else, on purpose: a lesson that needs
 * more formatting than that is too long.
 */
export type Lesson = {
  slug: string;
  group: string;
  title: string;
  minutes: number;
  /** One line under the title, and on the hub card. */
  sub: string;
  sections: { h: string; p?: string[]; list?: string[]; steps?: string[]; table?: [string, string][] }[];
  /** One question to check it landed. `answer` is the index into `options`. */
  check: { q: string; options: string[]; answer: number; why: string };
  /** Where to go to use it. */
  cta: { label: string; href: string };
};

export const GROUPS = ["Start here", "Playing a round", "Compete", "Stay safe"] as const;

export const LESSONS: Lesson[] = [
  {
    slug: "what-is-ropes",
    group: "Start here",
    title: "What ROPES is",
    minutes: 2,
    sub: "One minute of HYPE, up or down, on a rope.",
    sections: [
      {
        h: "The game in one breath",
        p: [
          "Every minute a new round opens on the **HYPE** price. You pick **UP** or **DOWN**. Your climber's height on the wall is what your position is worth, second by second.",
          "Right at the bell and your stack multiplies, then rides straight into the next minute. Wrong and you fall. Or **BAIL** at any second and keep what the market pays right now.",
        ],
      },
      {
        h: "Why it's different",
        list: [
          "There's no order book. The contract itself quotes every trade from the live Hyperliquid price, so you're in from the first second and you can always get out.",
          "Rounds start and settle on Hyperliquid's own 1-minute candle, and anyone can check them.",
          "It runs on **Elysium**, Kinetiq's Hyperliquid L2, where blocks are fast and gas is close to free. That's what makes a one-minute market possible.",
        ],
      },
      {
        h: "Right now",
        p: ["ROPES is on **Elysium testnet**. You play with test dollars (tUSDC) that have no value, so this is the time to learn it, climb the boards and break things."],
      },
    ],
    check: {
      q: "Your pick is right at the bell. What happens to your stack?",
      options: ["It's paid out and your run ends", "It multiplies and rides into the next minute", "It's split with the other side"],
      answer: 1,
      why: "A surviving stack rolls straight into the next round. That's how a run compounds: 10, then about 19.5, then about 38.",
    },
    cta: { label: "Watch a round live", href: "/play" },
  },
  {
    slug: "set-up",
    group: "Start here",
    title: "Set up on Elysium testnet",
    minutes: 3,
    sub: "Wallet, gas and test dollars, in about three minutes.",
    sections: [
      {
        h: "You can skip this",
        p: ["Practice seats need no wallet at all. Do this part when you want **ranked** seats, the ones that count on the boards and score points."],
      },
      {
        h: "1. Add the network",
        p: ["In MetaMask, Rabby or any EVM wallet, add a network:"],
        table: [
          ["Network name", "Elysium Testnet"],
          ["RPC", "https://testnet-rpc.elysium.kinetiq.xyz"],
          ["Chain ID", "99801"],
          ["Currency", "HYPE"],
          ["Explorer", "https://elysium.kinetiq.xyz/testnet-explorer"],
        ],
      },
      {
        h: "2. Get gas, then test dollars",
        steps: [
          "Claim a little testnet HYPE from the Elysium faucet. A transaction costs about 0.00001 HYPE, so a tiny amount lasts.",
          "On the ROPES **Wallet** page, tap **GET TEST tUSDC**. Your own wallet mints 10,000 test dollars. Free.",
          "**Deposit** what you want to play with. That's one transfer plus one plain-text signature that proves the deposit is yours.",
        ],
      },
      {
        h: "After that",
        p: ["Seats come out of your bankroll with no wallet popups. Winnings land back in it straight away. **WITHDRAW ALL** sends everything back to the wallet that made your first deposit."],
      },
    ],
    check: {
      q: "What do you need testnet HYPE for?",
      options: ["To buy seats", "Gas for the mint and deposit transactions", "Nothing, it's optional"],
      answer: 1,
      why: "Seats are paid in tUSDC from your bankroll. HYPE is only gas, and you need very little.",
    },
    cta: { label: "Open the wallet page", href: "/wallet" },
  },
  {
    slug: "first-seat",
    group: "Start here",
    title: "Your first seat",
    minutes: 2,
    sub: "Practice or ranked, pick a side, ride or bail.",
    sections: [
      {
        h: "Two kinds of seat",
        table: [
          ["Practice", "Free. The house stakes 10 tUSDC for you. Same market, but it never counts and winnings don't credit a balance."],
          ["Ranked", "10 tUSDC from your own bankroll. Counts on the weekly boards and scores points. 20 a wallet a day."],
        ],
      },
      {
        h: "Playing it",
        steps: [
          "Choose a climber and a name.",
          "Tap **PRACTICE** or **RANKED**.",
          "When the clock says **BETS OPEN**, tap **▲ UP** or **▼ DOWN**. Picks close 35 seconds into the minute.",
          "Watch your climber. **BAIL** at any second to keep what it's worth now, or ride to the bell.",
        ],
      },
      {
        h: "Good to know",
        list: [
          "You can never lose more than your seat.",
          "Pick while you're already riding and it queues for the next round, so there's no dead time.",
          "No pick means you sit the round out and your stack is untouched.",
        ],
      },
    ],
    check: {
      q: "Which seats count on the weekly boards?",
      options: ["Both kinds", "Only practice", "Only ranked"],
      answer: 2,
      why: "A free seat costs nothing, so it proves nothing. Only seats paid from your own bankroll count.",
    },
    cta: { label: "Take a practice seat", href: "/play?seat=1" },
  },
  {
    slug: "a-round",
    group: "Playing a round",
    title: "One minute, start to bell",
    minutes: 3,
    sub: "What happens at each second of a round.",
    sections: [
      {
        h: "The timeline",
        table: [
          ["0:00", "The round opens, struck at the open of Hyperliquid's 1-minute HYPE candle."],
          ["0:00 to 0:35", "Picks. Each one fills at the contract's live quote."],
          ["Any second", "BAIL. The contract buys your position back at the live price."],
          ["0:55 to 1:00", "No new buying in the last 5 seconds. Bailing stays open."],
          ["1:00", "The bell. The round settles on the next candle's open, which is also the next round's strike."],
        ],
      },
      {
        h: "Winning and losing",
        list: [
          "A winning share pays **1 tUSDC**. Buy UP at 0.51 and each share pays 1, about **1.96×** your stake.",
          "A losing share pays nothing.",
          "If HYPE closes exactly on the strike, nobody beat the line and the round voids: everyone is refunded.",
        ],
      },
      {
        h: "Compounding",
        p: ["Survive and your whole stack rides the next round: 10, about 19.5, about 38. That's the climb, and it's why knowing when to get off matters."],
      },
    ],
    check: {
      q: "It's 0:57 into the round. What can you still do?",
      options: ["Pick a side", "Bail", "Nothing until the bell"],
      answer: 1,
      why: "Buying stops 5 seconds before the bell, but selling stays open right up to it.",
    },
    cta: { label: "Watch a round", href: "/play" },
  },
  {
    slug: "reading-the-wall",
    group: "Playing a round",
    title: "Reading the wall",
    minutes: 2,
    sub: "Your climber's height is your money.",
    sections: [
      {
        h: "Height is value",
        p: [
          "Your climber's height is the live value of your position against what you put in. Above the **BREAK EVEN** line you're up; below it you're down.",
          "The wall uses a log scale, so doubling and halving are the same distance. A climber at 2× is as far above break even as one at 0.5× is below it.",
        ],
      },
      {
        h: "The number that matters",
        p: ["The **KEEP** number on the BAIL button is exactly what a sale pays right now: the price the contract will buy your side back at, not the price to buy it. If you bail, that's what you get."],
      },
      {
        h: "The clock",
        list: [
          "The big number counts down to the bell.",
          "**SETTLING** means the bell rang and the result is landing on-chain. It takes a few seconds.",
          "**ROPING UP** means a table is filling before it seals.",
        ],
      },
    ],
    check: {
      q: "What does the KEEP number on the BAIL button tell you?",
      options: ["What a bail pays right now", "What you'd win at the bell", "What you paid for the seat"],
      answer: 0,
      why: "It's the live sell price for your side. Bail and that's what lands in your stack.",
    },
    cta: { label: "Watch the wall", href: "/play" },
  },
  {
    slug: "bail",
    group: "Playing a round",
    title: "When to bail",
    minutes: 3,
    sub: "Selling back at any second, and setting a target.",
    sections: [
      {
        h: "BAIL always fills",
        p: [
          "There's no order book to wait on. **BAIL** sells your whole position back to the contract at the live price for your side, any second up to the bell.",
          "The leap animation plays the moment you tap. The sale lands on the game's next tick, about a second later.",
        ],
      },
      {
        h: "Two good reasons to bail",
        list: [
          "**Lock in a climb.** You're at 3× and the next minute is a coin flip. Riding risks all of it to double it.",
          "**Save a bad round.** HYPE moved against you mid-minute. Bailing at 0.94× keeps 9.40 of your 10 instead of riding to zero. That's a real testnet bail.",
        ],
      },
      {
        h: "Auto-bail",
        p: ["Set a target multiple and the game bails for you the moment your position's sellable value crosses it. It's a trigger, not a promised price: the sale still goes through at the live price."],
      },
    ],
    check: {
      q: "You set auto-bail at 2×. What does that guarantee?",
      options: ["You get exactly 2×", "The game sells for you when your value crosses 2×", "You can't lose the round"],
      answer: 1,
      why: "Auto-bail is a trigger. When your sellable value crosses the target, it sells at the live price, which can be a touch different.",
    },
    cta: { label: "Try it in practice", href: "/play?seat=1" },
  },
  {
    slug: "pricing",
    group: "Playing a round",
    title: "Why a coin flip pays about 1.96×",
    minutes: 3,
    sub: "How the contract prices UP and DOWN.",
    sections: [
      {
        h: "The contract is the market maker",
        p: ["ROPES doesn't match buyers with sellers. On every trade, the contract works out the **fair price** of each side: the chance HYPE finishes above the strike, given where it is now and how much time is left."],
      },
      {
        h: "Reading a price",
        list: [
          "At the start of a round, HYPE is right on the strike, so UP and DOWN are each worth about **0.50**.",
          "You buy at fair value plus a **1%** spread, so about 0.51. A winning share pays 1, so that's about 1.96×.",
          "As HYPE moves, the price moves with it. Late in the round a small move swings the price a lot.",
          "The spread doubles in the last 10 seconds, when prices swing fastest.",
        ],
      },
      {
        h: "One guardrail",
        p: ["The game won't put you into a side priced above **0.90**. At that price you'd risk your whole stack to make 11%."],
      },
    ],
    check: {
      q: "HYPE is well above the strike with 10 seconds left. What's UP worth?",
      options: ["About 0.50", "Close to 1", "Close to 0"],
      answer: 1,
      why: "With little time left and HYPE well above the strike, UP is very likely to win, so it's priced near 1 and pays very little.",
    },
    cta: { label: "Read the full pricing doc", href: "/docs/pricing" },
  },
  {
    slug: "voids",
    group: "Playing a round",
    title: "Ties, voids and refunds",
    minutes: 2,
    sub: "When a round can't settle fairly, nobody wins or loses on it.",
    sections: [
      {
        h: "A round voids when",
        list: [
          "**There's no price at the bell.** The close has to come from within 8 seconds of the bell. A late price can't settle it.",
          "**It's a tie.** HYPE closes exactly on the strike.",
          "**It's abandoned.** Still unsettled 120 seconds after the bell, anyone can void it, so a stuck keeper can never freeze money.",
        ],
      },
      {
        h: "What you get back",
        p: [
          "Every holder gets back **exactly what they paid** for the shares they still hold.",
          "If you bailed part of a position first, the refund covers what's left.",
        ],
      },
    ],
    check: {
      q: "HYPE closes exactly on the strike. What happens?",
      options: ["UP wins", "DOWN wins", "The round voids and everyone is refunded"],
      answer: 2,
      why: "Nobody beat the line, so nobody wins or loses: every holder gets back what they paid.",
    },
    cta: { label: "Read about voids", href: "/docs/voids" },
  },
  {
    slug: "ranked-and-boards",
    group: "Compete",
    title: "Ranked and the weekly boards",
    minutes: 2,
    sub: "What counts, how the weeks run, who's on top.",
    sections: [
      {
        h: "Ranked seats",
        list: [
          "Paid from your own tUSDC bankroll, so they need a wallet and a deposit.",
          "**20 ranked seats a wallet a day**, reset at 00:00 UTC.",
          "Your wallet is your identity on the boards: two browsers on one wallet are one climber.",
        ],
      },
      {
        h: "The two weekly boards",
        table: [
          ["The Summit", "Net winnings this week: what your ranked runs paid out, minus what they cost."],
          ["Longest Climb", "The most rounds one ranked run survived this week."],
        ],
      },
      {
        h: "The week",
        p: ["Boards reset every **Monday 00:00 UTC**. A run counts in the week its last bell rang. The all-time ranked board sits underneath."],
      },
    ],
    check: {
      q: "When do the weekly boards reset?",
      options: ["Every day at 00:00 UTC", "Monday 00:00 UTC", "When the season ends"],
      answer: 1,
      why: "Weeks run Monday to Monday, UTC. Ranked seats per day reset daily; the boards reset weekly.",
    },
    cta: { label: "See this week's boards", href: "/leaders" },
  },
  {
    slug: "points",
    group: "Compete",
    title: "Points, leagues and invites",
    minutes: 2,
    sub: "How ROPES Points score, and how to climb the leagues.",
    sections: [
      {
        h: "What scores",
        table: [
          ["Every ranked seat", "+10"],
          ["Every round it survives", "+5"],
          ["Banking a profit", "+20 per 1× above the buy-in, up to +200"],
          ["Last one holding at the table", "+100"],
          ["First ranked seat of the day", "+25"],
          ["Weekly board finishes", "up to +500"],
          ["Your invites", "10% of what they earn"],
        ],
      },
      {
        h: "Leagues",
        p: ["Base Camp, Ledge (250), Ridge (1,000), Peak (2,500), Summit (6,000). The table updates live, with arrows showing how far each climber moved since yesterday."],
      },
      {
        h: "Your card",
        p: ["On the points page, put your **X handle** on the boards and grab your **invite link**. Invites count for new wallets. Season 0 is testnet: points are your standing, not a token."],
      },
    ],
    check: {
      q: "Do practice seats score points?",
      options: ["Yes, half points", "No, only ranked seats score", "Only on weekends"],
      answer: 1,
      why: "Points follow the same rule as the boards: only seats paid from your own bankroll count.",
    },
    cta: { label: "Open your points card", href: "/points" },
  },
  {
    slug: "tables",
    group: "Compete",
    title: "Tables and the last one holding",
    minutes: 2,
    sub: "Who you're climbing against, and how a run ends.",
    sections: [
      {
        h: "Tables",
        p: [
          "Seats are grouped into tables of up to **8**. A table fills for 15 seconds, then seals, and plays until one run is left standing. A table of one is a solo climb.",
          "The last run holding is the table's champion. That's worth **+100 points**.",
        ],
      },
      {
        h: "Every way a run ends",
        table: [
          ["You bail", "You keep your stack."],
          ["You fall", "Your side was wrong at the bell."],
          ["The sweep", "A stack under 1 tUSDC can't climb back, so it's cashed out."],
          ["You walk away", "No pick for 10 rounds and the seat is banked for you. You keep all of it."],
        ],
      },
    ],
    check: {
      q: "You stop picking for 10 rounds. What happens to your stack?",
      options: ["It's lost", "It's banked and you keep all of it", "The house takes a fee"],
      answer: 1,
      why: "An idle seat is banked automatically. Its stack is cash, so it all comes back to you.",
    },
    cta: { label: "Read the full rules", href: "/docs/game-rules" },
  },
  {
    slug: "staying-safe",
    group: "Stay safe",
    title: "Staying safe",
    minutes: 2,
    sub: "The real site, what you'll be asked to sign, and the usual scams.",
    sections: [
      {
        h: "The real places",
        list: [
          "The game is only at **playropes.xyz**. The only X account is **@PlayRopes**.",
          "Nobody from ROPES will DM you first, ask for your seed phrase, or ask you to send funds to get something back.",
        ],
      },
      {
        h: "What ROPES asks your wallet for",
        list: [
          "**Mint**: GET TEST tUSDC, from your own wallet.",
          "**Transfer**: your deposit, a plain tUSDC transfer to the house.",
          "**A plain-text signature** naming that deposit's transaction, so it credits to you.",
          "**A network switch** to Elysium Testnet before each of those.",
          "That's all. ROPES never asks for token approvals, and nothing during play needs your wallet.",
        ],
      },
      {
        h: "Scams to ignore",
        list: [
          "Anyone selling tUSDC. It's free and has no value.",
          "\"Claim your ROPES airdrop\" links. $ROPES hasn't launched. Its page on playropes.xyz will say when it does.",
          "\"Support\" accounts in replies. Use the feedback board instead.",
        ],
      },
    ],
    check: {
      q: "A site asks you to approve unlimited spending of your tokens to play ROPES. What do you do?",
      options: ["Approve it, it's needed to play", "Refuse. ROPES never asks for approvals", "Approve a small amount"],
      answer: 1,
      why: "ROPES only ever asks for a mint, a plain transfer and a text signature. An approval request means it isn't ROPES.",
    },
    cta: { label: "Report something odd", href: "/feedback" },
  },
  {
    slug: "check-it-yourself",
    group: "Stay safe",
    title: "Check a round yourself",
    minutes: 2,
    sub: "Don't trust the game. Check it.",
    sections: [
      {
        h: "The price is public",
        p: [
          "Every round is struck at the open of Hyperliquid's own 1-minute HYPE candle and settled on the next one. Those candles are public, so anyone can compare.",
          "The **transparency page** does it live: the latest rounds next to Hyperliquid's candles, the rules the contract enforces, and what each key can do.",
        ],
      },
      {
        h: "The money is on-chain",
        list: [
          "Every buy, bail and settle is a transaction on the Elysium explorer.",
          "The pricing formula is a public function on the contract, so anyone can recompute a quote.",
          "Voided rounds show as refunded.",
        ],
      },
      {
        h: "What's still trusted on testnet",
        p: ["Players' stakes sit in one pooled house wallet with a ledger of who owns what, and a keeper relays the Hyperliquid price. Per-player custody and reading Hyperliquid directly both come before real money. The trust model doc spells out every key."],
      },
    ],
    check: {
      q: "Where does a round's strike price come from?",
      options: ["The ROPES team sets it", "The open of Hyperliquid's 1-minute HYPE candle", "The average of players' picks"],
      answer: 1,
      why: "Strike and close are Hyperliquid's own published candle opens, which is what makes every round checkable.",
    },
    cta: { label: "Open the transparency page", href: "/transparency" },
  },
];

export const lessonBySlug = (slug: string) => LESSONS.find((l) => l.slug === slug) ?? null;
