/**
 * The docs' table of contents. Each page is src/docs/<slug>.md; the first line
 * of each file is its # title, the second its one-line description.
 */
export interface DocPage {
  slug: string;
  title: string;
}
export interface DocSection {
  title: string;
  pages: DocPage[];
}

export const NAV: DocSection[] = [
  {
    title: "Start here",
    pages: [
      { slug: "overview", title: "Overview" },
      { slug: "quickstart", title: "Quickstart" },
      { slug: "how-a-round-works", title: "How a round works" },
    ],
  },
  {
    title: "The market",
    pages: [
      { slug: "pricing", title: "Pricing" },
      { slug: "bail", title: "BAIL" },
      { slug: "the-bell", title: "The bell & settlement" },
      { slug: "voids", title: "Voids & refunds" },
      { slug: "vault", title: "The house vault" },
      { slug: "risk-limits", title: "Risk limits" },
    ],
  },
  {
    title: "Trust",
    pages: [
      { slug: "price-source", title: "Price source & audit" },
      { slug: "trust-model", title: "Trust model & admin keys" },
      { slug: "threat-model", title: "Threat model" },
      { slug: "contracts", title: "Contracts & addresses" },
    ],
  },
  {
    title: "Elysium",
    pages: [
      { slug: "why-elysium", title: "Why Elysium" },
      { slug: "hypercore-precompile", title: "The HyperCore precompile" },
    ],
  },
  {
    title: "Playing",
    pages: [
      { slug: "game-rules", title: "Seats, tables & stacks" },
      { slug: "wallet", title: "Wallet & bankroll" },
    ],
  },
  {
    title: "Token & roadmap",
    pages: [
      { slug: "token", title: "$ROPES" },
      { slug: "roadmap", title: "Roadmap" },
    ],
  },
  {
    title: "More",
    pages: [
      { slug: "faq", title: "FAQ" },
      { slug: "brand", title: "Brand kit" },
    ],
  },
];

export const PAGES = NAV.flatMap((s) => s.pages);
