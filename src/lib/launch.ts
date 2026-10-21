/**
 * Dates the /mainnet and /token pages count toward. Elysium has announced the
 * day, not the hour, so the countdown runs to the start of Nov 9 UTC.
 */
export const MAINNET_AT = Date.UTC(2026, 10, 9);
export const MAINNET_LABEL = "Nov 9, 2026";

const details =
  "Elysium, Kinetiq's Hyperliquid L2, goes live on mainnet. ROPES (one-minute HYPE rounds) follows on real USDC after a security review. Only trust @PlayRopes and ropes.nerom.site.";

export const GOOGLE_CAL =
  "https://calendar.google.com/calendar/render?action=TEMPLATE" +
  `&text=${encodeURIComponent("Elysium mainnet · ROPES")}` +
  "&dates=20261109/20261110" +
  `&details=${encodeURIComponent(details)}` +
  `&location=${encodeURIComponent("https://ropes.nerom.site/mainnet")}`;

export const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//ROPES//mainnet//EN",
  "BEGIN:VEVENT",
  "UID:elysium-mainnet-2026@ropes.nerom.site",
  "DTSTAMP:20261021T000000Z",
  "DTSTART;VALUE=DATE:20261109",
  "DTEND;VALUE=DATE:20261110",
  "SUMMARY:Elysium mainnet · ROPES",
  `DESCRIPTION:${details.replace(/,/g, "\\,")}`,
  "URL:https://ropes.nerom.site/mainnet",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");
