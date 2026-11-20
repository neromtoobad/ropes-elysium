import type { Metadata } from "next";
import Trade from "../rb/Trade";

export const metadata: Metadata = {
  title: "Trade HYPE options · ROPES",
  description: "Calls and puts on HYPE, every five minutes to every day. The onchain book opens December 1 on Elysium.",
};

export default function Page() {
  return <Trade />;
}
