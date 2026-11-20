import Home from "./rb/Home";
import { getTransparency } from "@/lib/transparency";

/**
 * The landing, rebrand edition (Dec 2026): ROPES as the onchain options
 * exchange for Hyperliquid. The live ladder and examples are client-side; the
 * settled-round count comes from the same cached reads /transparency uses.
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  let rounds: number | null = null;
  try {
    rounds = (await getTransparency()).roundCount;
  } catch {
    rounds = null;
  }
  return <Home rounds={rounds} />;
}
