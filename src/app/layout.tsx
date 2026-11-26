import type { Metadata, Viewport } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./rb.css";
import InviteCatcher from "./InviteCatcher";

/** The rebrand pair (Dec 2026): DM Sans for UI and headings, Geist Mono for prices, labels and kickers. */
const sans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"),
  title: "ROPES",
  description: "One minute of Hyperliquid, on a rope. Bet the next sixty seconds of HYPE, bail any second, last one holding takes the pot. On Elysium.",
  icons: { icon: "/favicon-64.png", apple: "/icon.png" },
  openGraph: {
    title: "ROPES",
    description: "One minute of Hyperliquid, on a rope. Bet the next sixty seconds of HYPE, bail any second, last one holding takes the pot. On Elysium.",
    images: [{ url: "/og/og-home.png", width: 1200, height: 630, alt: "ROPES: one minute of Hyperliquid, on a rope" }],
  },
  twitter: { card: "summary_large_image", site: "@PlayRopes", images: ["/og/og-home.png"] },
};

/**
 * viewport-fit=cover lets the pinned controls pad for the home indicator
 * (env(safe-area-inset-bottom)); without it the value is always 0. Zoom is
 * deliberately NOT disabled — the game stays legible to anyone who needs it.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#04181c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        {children}
        <InviteCatcher />
      </body>
    </html>
  );
}
