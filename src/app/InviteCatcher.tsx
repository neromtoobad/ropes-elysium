"use client";

/**
 * Keeps an invite code from the link until it can be claimed.
 *
 * An invite only means something once the new player has a wallet behind
 * them, which happens at their first deposit — often a page or two after
 * they landed. So the code waits in storage and every page retries the claim
 * until the server gives a final answer.
 */
import { useEffect } from "react";
import { safeLocal } from "./shared";

export default function InviteCatcher() {
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("ref");
    if (fromUrl && !safeLocal.get("lc.refDone")) safeLocal.set("lc.ref", fromUrl.toUpperCase());

    const tryClaim = () => {
      const code = safeLocal.get("lc.ref");
      const playerKey = safeLocal.get("lc.playerKey");
      if (!code || !playerKey) return;
      fetch("/api/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerKey, code }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j || j.pending) return;
          safeLocal.remove("lc.ref");
          safeLocal.set("lc.refDone", j.ok ? "claimed" : String(j.reason ?? "no"));
        })
        .catch(() => {});
    };
    tryClaim();
    const id = setInterval(tryClaim, 60_000);
    return () => clearInterval(id);
  }, []);
  return null;
}
