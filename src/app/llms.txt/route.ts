import { allDocs } from "@/docs/load";
import { NAV } from "@/docs/nav";

/** The docs in one plain-text file, for people and agents who'd rather not click. */
export const dynamic = "force-static";

export function GET() {
  const docs = Object.fromEntries(allDocs().map((d) => [d.slug, d]));
  const index = NAV.map((s) => `## ${s.title}\n` + s.pages.map((p) => `- [${p.title}](https://playropes.xyz/docs/${p.slug}): ${docs[p.slug]?.description ?? ""}`).join("\n")).join("\n\n");
  const full = NAV.flatMap((s) => s.pages).map((p) => docs[p.slug]?.raw ?? "").join("\n\n---\n\n");
  const body = `# ROPES docs\n\n> One minute of Hyperliquid, on a rope. A one-minute prediction game on the HYPE price, on Elysium.\n\n${index}\n\n---\n\n${full}\n`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
