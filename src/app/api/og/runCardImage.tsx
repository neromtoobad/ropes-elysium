import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { type CardClimber, type RunCard, runVerdict } from "@/lib/runcard";

/**
 * The run card as an image: what X (and anything else that unfurls links)
 * shows for /run/<id>. Drawn on the server with satori, in the game's own
 * fonts, so a shared link carries the whole story — the multiple, how it
 * ended, the bells — without anyone uploading a screenshot.
 */
const dir = join(process.cwd(), "src/app/api/og");
const file = (p: string) => readFileSync(join(dir, p));
const dataUri = (p: string) => `data:image/png;base64,${file(p).toString("base64")}`;
const FONTS = [
  { name: "Russo One", data: file("fonts/RussoOne-Regular.ttf"), weight: 400 as const, style: "normal" as const },
  { name: "Chakra Petch", data: file("fonts/ChakraPetch-Bold.ttf"), weight: 700 as const, style: "normal" as const },
];
const MARK = dataUri("mark.png");
const ELYSIUM = dataUri("elysium.png");

const C = { bg0: "#1c1738", bg1: "#0b0917", text: "#eeecf5", dim: "#8d8ab0", up: "#00e58a", down: "#ff2f52", gold: "#ffc94d", edge: "#332c52" };

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).toUpperCase();

/** Draw a run card (or the generic card when `card` is null). */
export function runCardImage(card: RunCard | null, climber: CardClimber) {
  const cut = card?.status === "eliminated";
  const accent = !card ? C.gold : cut ? C.down : card.multiple >= 1 ? C.up : C.gold;
  const sprite = dataUri(`climbers/${climber}-${cut ? "fall" : "cheer"}.png`);
  const trail = card ? card.trail.slice(-18) : [];
  const tags = card
    ? [card.daily && card.day ? `DAILY CLIMB · ${fmtDay(card.day)}` : null, card.ranked ? "RANKED" : "PRACTICE"].filter(Boolean)
    : [];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: `linear-gradient(180deg, ${C.bg0} 0%, #131028 45%, ${C.bg1} 100%)`,
          fontFamily: "Chakra Petch",
          color: C.text,
        }}
      >
        {/* ledges */}
        {[150, 290, 430].map((y) => (
          <div key={y} style={{ position: "absolute", left: 60, right: 60, top: y, height: 2, borderTop: "2px dashed rgba(255,255,255,0.07)" }} />
        ))}
        {/* HUD corners */}
        {[
          { left: 28, top: 28, borderLeft: `4px solid ${C.gold}`, borderTop: `4px solid ${C.gold}` },
          { right: 28, top: 28, borderRight: `4px solid ${C.gold}`, borderTop: `4px solid ${C.gold}` },
          { left: 28, bottom: 28, borderLeft: `4px solid ${C.gold}`, borderBottom: `4px solid ${C.gold}` },
          { right: 28, bottom: 28, borderRight: `4px solid ${C.gold}`, borderBottom: `4px solid ${C.gold}` },
        ].map((s, i) => (
          <div key={i} style={{ position: "absolute", width: 36, height: 36, ...s }} />
        ))}

        {/* the climber, with the run's colour behind it */}
        <div
          style={{
            position: "absolute",
            right: 70,
            top: 110,
            width: 380,
            height: 380,
            borderRadius: 999,
            background: `radial-gradient(circle, ${accent}55 0%, transparent 68%)`,
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={sprite} alt="" height={360} style={{ position: "absolute", right: cut ? 70 : 120, top: 130, ...(cut ? { transform: "rotate(-18deg)" } : {}) }} />

        <div style={{ display: "flex", flexDirection: "column", padding: "64px 0 0 76px", width: 760 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={MARK} alt="" width={96} height={50} />
            <div style={{ display: "flex", fontFamily: "Russo One", fontSize: 34, letterSpacing: 6, marginRight: 12, flexShrink: 0 }}>ROPES</div>
            {tags.map((t) => (
              <div
                key={t}
                style={{
                  display: "flex",
                  fontSize: 18,
                  letterSpacing: 3,
                  padding: "6px 12px",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                  border: `2px solid ${t!.startsWith("DAILY") ? C.gold : C.edge}`,
                  color: t!.startsWith("DAILY") ? C.gold : C.dim,
                }}
              >
                {t}
              </div>
            ))}
          </div>

          {card ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  marginTop: 26,
                  fontFamily: "Russo One",
                  fontSize: 168,
                  lineHeight: 1,
                  color: accent,
                  textShadow: `0 0 50px ${accent}88`,
                }}
              >
                {`${card.multiple.toFixed(2)}×`}
              </div>
              <div style={{ display: "flex", marginTop: 14, fontFamily: "Russo One", fontSize: 48 }}>{runVerdict(card)}</div>
              <div style={{ display: "flex", marginTop: 12, fontSize: 24, letterSpacing: 2, color: C.dim, whiteSpace: "nowrap" }}>
                {`${card.name.toUpperCase().slice(0, 14)} · ${card.rounds} BELL${card.rounds === 1 ? "" : "S"} SURVIVED · PEAK ${card.peak.toFixed(2)}×`}
              </div>
              {/* the bells, oldest to newest */}
              <div style={{ display: "flex", gap: 8, marginTop: 26, flexWrap: "wrap", width: 700 }}>
                {trail.map((b, i) => {
                  const c = b.outcome === "lost" ? C.down : b.outcome === "push" ? C.gold : C.up;
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        width: 32,
                        height: 32,
                        alignItems: "center",
                        justifyContent: "center",
                        background: c,
                      }}
                    >
                      {b.outcome === "lost" ? (
                        <div style={{ display: "flex", position: "relative", width: 16, height: 16 }}>
                          <div style={{ position: "absolute", left: 6, top: -2, width: 4, height: 20, background: "#fff", transform: "rotate(45deg)" }} />
                          <div style={{ position: "absolute", left: 6, top: -2, width: 4, height: 20, background: "#fff", transform: "rotate(-45deg)" }} />
                        </div>
                      ) : (
                        <div
                          style={{
                            width: 0,
                            height: 0,
                            borderLeft: "8px solid transparent",
                            borderRight: "8px solid transparent",
                            ...(b.side === "UP" ? { borderBottom: "12px solid #0b0917" } : { borderTop: "12px solid #0b0917" }),
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", marginTop: 60, fontFamily: "Russo One", fontSize: 80 }}>ONE MINUTE OF HYPE, ON A ROPE</div>
          )}
        </div>

        {/* footer */}
        <div
          style={{
            position: "absolute",
            left: 76,
            right: 76,
            bottom: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 22,
            letterSpacing: 3,
          }}
        >
          <div style={{ display: "flex", color: C.gold }}>PLAYROPES.XYZ · CAN YOU CLIMB HIGHER?</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.dim }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ELYSIUM} alt="" width={30} height={30} style={{ borderRadius: 999 }} />
            ON ELYSIUM
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: FONTS,
      headers: { "cache-control": card && card.status !== "alive" ? "public, max-age=86400, immutable" : "public, max-age=60" },
    },
  );
}
