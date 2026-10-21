"use client";

import { useEffect, useState } from "react";
import { MAINNET_AT } from "@/lib/launch";

const pad = (n: number) => String(n).padStart(2, "0");

/** Days, hours, minutes, seconds to Elysium mainnet; renders blanks until the clock is known. */
export function Countdown() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = now == null ? null : Math.max(0, MAINNET_AT - now);
  if (left === 0) return <p className="mn-live"><span className="dot" /> Elysium mainnet is live</p>;
  const s = left == null ? null : Math.floor(left / 1000);
  const parts: [string, string][] = [
    ["days", s == null ? "--" : String(Math.floor(s / 86400))],
    ["hours", s == null ? "--" : pad(Math.floor(s / 3600) % 24)],
    ["min", s == null ? "--" : pad(Math.floor(s / 60) % 60)],
    ["sec", s == null ? "--" : pad(s % 60)],
  ];
  return (
    <div className="mn-clock" role="timer" aria-label="time until Elysium mainnet">
      {parts.map(([label, v]) => (
        <div key={label}>
          <strong>{v}</strong>
          <small>{label}</small>
        </div>
      ))}
    </div>
  );
}
