"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import type { TableState } from "@/lib/state";
import type { Address } from "viem";
import { Cliff, liveMultipleOf, CAST, type ClimberId } from "../Cliff";
import { txUrl, addressUrl } from "@/lib/elysium";
import { useSound, useHeartbeat } from "../sound";
import { useHasWallet, useAccount, wallets, connect, paySeat, collateralBalance, signDeposit } from "../wallet";
import { useSmoothed } from "../useSmoothed";
import { ElysiumBadge } from "../Elysium";
import {
  usd, short, clock, bigClock, usePlayerKey, useLedger, useClimberTheme, SiteNav, NavMenu, BellChip, HowItWorks, ShareRun,
  type LedgerData, OpenInWallet, safeLocal, fmtMark, fmtMove} from "../shared";

const SEAT = 10_000_000n; // 10 tUSDC, 6 decimals

const POLL_MS = 750;

/** What the bell meant for the viewer's own money. */
type BellVerdict =
  | { kind: "won"; from: number; to: number }
  | { kind: "lost" }
  | { kind: "push" }
  | null;

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      {on ? (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </>
      ) : (
        <>
          <path d="M22 9l-6 6" />
          <path d="M16 9l6 6" />
        </>
      )}
    </svg>
  );
}

/**
 * The asset and line of the current round, for the overlays (the result card,
 * the bell) that render outside the state-holding component. Written on every
 * render of Game, read on every render of those — they always render after it.
 */
const markInfo = { asset: "HYPE", strike: 100 };

export default function Game() {
  const playerKey = usePlayerKey();
  const [state, setState] = useState<TableState | null>(null);
  if (state?.mark) {
    markInfo.asset = state.mark.asset;
    if (state.mark.strike) markInfo.strike = state.mark.strike;
  }
  const [runId, setRunId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [bell, setBell] = useState<TableState["lastResult"]>(null);
  /**
   * What the last bell did to YOUR run, captured the moment it lands and kept
   * until you act on it. It used to be derived from `runId` on every render —
   * and the ledger refresh that follows a death clears `runId` within a
   * second, so the verdict vanished almost as it appeared and a lost round
   * read as "nothing happened". This survives that, and it is what the result
   * card (CONTINUE / CASH OUT / PLAY AGAIN / BACK) is built on.
   */
  const [verdict, setVerdict] = useState<Verdict>(null);
  const runIdRef = useRef<string | null>(null);
  /** The run the last verdict ended, for the share buttons: runId itself is
   *  cleared as soon as the ledger confirms the run is over. */
  const [endedRunId, setEndedRunId] = useState<string | null>(null);
  /** Before a seat: choose a climber, then a name. */
  const [preStage, setPreStage] = useState<"climber" | "name">("climber");
  const [leaping, setLeaping] = useState<string[]>([]);
  const [passed, setPassed] = useState<string | null>(null);
  const [optimisticPick, setOptimisticPick] = useState<"UP" | "DOWN" | null>(null);
  const [busy, setBusy] = useState(false);
  const [bailing, setBailing] = useState(false);
  // Which of the eight climbers you are. Cosmetic, local, and yours.
  const [climber, setClimber] = useState<ClimberId>("green");
  const lastBellIndex = useRef<number | null>(null);
  /** When the newest state frame arrived, so the clock can run on from it. */
  const stateAt = useRef(Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setRunId(safeLocal.get("lc.runId"));
    const saved = safeLocal.get("lc.climber");
    if (saved && CAST.some((c) => c.id === saved)) setClimber(saved as ClimberId);
  }, []);

  /**
   * One request at a time, newest frame wins.
   *
   * This was a 750 ms setInterval, but a state response takes 0.8–1.2 s, so
   * two were usually in flight and around the bell they landed out of order:
   * the wall flipped between the old round and the new one, the bell overlay
   * fired twice and the climber jumped. Now the next poll starts only when
   * the last one is done, and a frame for an older round than the one on
   * screen is dropped. Near the bell — while the keeper settles and opens the
   * next round, 2–4 s — it polls faster so the new round shows up promptly.
   */
  const newestRound = useRef<number>(-1);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let next: TableState | null = null;
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        // A 500 can still carry a JSON body, and storing THAT as the game
        // state was fatal: `state.seats.find(...)` on an undefined `seats`
        // threw, and the whole page became "Application error: a client-side
        // exception has occurred". Keep the last good frame instead.
        if (res.ok) next = await res.json();
      } catch {
        /* keep the last good frame rather than blanking the wall */
      }
      // `mark` is read unguarded in two places below; a frame without it
      // took the whole page down. Validate the SHAPE, not just seats.
      const good = alive && next && Array.isArray(next.seats) && next.mark && next.price;
      const idx = next?.round?.index ?? -1;
      if (good && idx >= newestRound.current) {
        newestRound.current = idx;
        stateAt.current = Date.now();
        setState(next);

        const bellIdx = next!.lastResult?.index ?? null;
        if (bellIdx !== null && lastBellIndex.current !== null && bellIdx > lastBellIndex.current) {
          setBell(next!.lastResult);
          setTimeout(() => setBell(null), 4800);
          const r = next!.lastResult!;
          const id = runIdRef.current;
          if (id) {
            if (r.killed.some((k) => k.runId === id)) {
              setEndedRunId(id);
              setVerdict({ kind: "lost", closedBy: r.closedBy, winner: r.winner });
            } else {
              const sv = r.survived.find((x) => x.runId === id);
              if (sv) setVerdict(r.voided ? { kind: "push", to: sv.to } : { kind: "won", from: sv.from, to: sv.to });
            }
          }
          // A bell consumes every pick — showing the old one as "YOUR BET"
          // would claim a stake that is not on the table.
          setOptimisticPick(null);
        }
        if (lastBellIndex.current === null || (bellIdx !== null && bellIdx > lastBellIndex.current)) lastBellIndex.current = bellIdx;
      }
      if (!alive) return;
      // Seconds until this round's bell, as of now.
      const left = next?.round ? next.round.secondsLeft : 99;
      timer = setTimeout(tick, left < 2 ? 250 : POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const post = useCallback(async (path: string, body: unknown) => {
    setErr(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      setErr(json.error ?? "something went wrong");
      return null;
    }
    return json;
  }, []);

  const [seatFlash, setSeatFlash] = useState<null | "paid" | "free">(null);

  useEffect(() => {
    runIdRef.current = runId;
  }, [runId]);

  /** mode "practice" takes the house's free seat even when the bankroll could
   *  pay for a ranked one; otherwise a funded bankroll seats ranked. */
  const join = async (depositTx?: string, who?: string, signature?: string, mode?: "practice") => {
    const called = (who ?? name).trim();
    if (!playerKey || !called || busy) return;
    setBusy(true);
    const r = await post("/api/join", { playerKey, name: called, depositTx, signature, mode });
    setBusy(false);
    if (r?.runId) {
      safeLocal.set("lc.runId", r.runId);
      setRunId(r.runId);
      // The moment the money moves, say so — and say whose money it was.
      setSeatFlash(r.paid ? "paid" : "free");
      setTimeout(() => setSeatFlash(null), 2800);
    }
  };

  // The player's own wallet — used to pay for the seat and receive payouts.
  // Play stays custodial either way; a missing wallet just means free play.
  const walletReady = useHasWallet();
  // Restored on mount, so a reload or a hop to /wallet no longer reads as a
  // wallet that disconnected itself. See useAccount.
  const [addr, setAddr] = useAccount();
  const [paying, setPaying] = useState(false);

  const connectWallet = async () => {
    /*
     * EVERYTHING lives inside the try. `sound.arm()` used to run before it and
     * reads localStorage, which THROWS on browsers that block storage — the
     * throw escaped the handler and the button did nothing at all, with no
     * error on screen. A connect button must never be able to fail silently.
     */
    const slow = setTimeout(
      () => setErr("still waiting on your wallet — check the wallet icon in your browser toolbar, the approval may be waiting there"),
      6000,
    );
    try {
      sound.arm();
      setAddr(await connect());
      setErr(null);
    } catch (e) {
      const detected = wallets().map((w) => w.name).join(", ") || "none";
      const why = String((e as Error)?.message ?? e).replace("Error: ", "").slice(0, 120);
      setErr(`${why} · wallets seen: ${detected} · storage: ${safeLocal.works() ? "ok" : "blocked"}`);
      console.error("[ropes] connect failed", e);
    }
    clearTimeout(slow);
  };

  /** Fund the bankroll from the game screen. Same verified path as the wallet
   *  page — pay on-chain, then the server credits the receipt. */
  const [funding, setFunding] = useState(false);
  const [funded, setFunded] = useState(0);
  const fundBankroll = async (amount: bigint) => {
    if (!state?.pay || !playerKey || funding) return;
    sound.arm();
    setFunding(true);
    setErr(null);
    try {
      const a = addr ?? (await connect());
      setAddr(a);
      const units = amount * 1_000_000n;
      const held = await collateralBalance(a, state.pay.collateral as Address);
      if (held < units) {
        throw new Error(`not enough tUSDC — you hold ${(Number(held) / 1e6).toFixed(2)}. mint some free on the wallet page (GET TEST tUSDC)`);
      }
      const tx = await paySeat(a, state.pay.collateral as Address, state.pay.house as Address, units);
      const signature = await signDeposit(a, tx, playerKey);
      const r = await post("/api/deposit", { playerKey, txHash: tx, signature });
      if (r) setFunded((n) => n + 1);
    } catch (e) {
      setErr(String(e).replace("Error: ", "").slice(0, 160));
    }
    setFunding(false);
  };

  const buySeat = async () => {
    if (!state?.pay || !addr || !name.trim() || paying || busy) return;
    sound.arm();
    setPaying(true);
    setErr(null);
    try {
      const bal = await collateralBalance(addr, state.pay.collateral as Address);
      if (bal < SEAT) throw new Error("not enough tUSDC — a seat costs 10. mint some free on the wallet page (GET TEST tUSDC) and come back");
      const tx = await paySeat(addr, state.pay.collateral as Address, state.pay.house as Address, SEAT);
      await join(tx, undefined, await signDeposit(addr, tx, playerKey!));
    } catch (e) {
      setErr(String(e).replace("Error: ", "").slice(0, 160));
    }
    setPaying(false);
  };

  /**
   * One click from the landing page to a live round.
   *
   * Someone evaluating a dozen projects in an afternoon should not have to
   * invent a name to see the thing move. `?seat=1` takes the free house seat
   * for them; picking a side is still theirs.
   */
  const autoSeated = useRef(false);
  const [coach, setCoach] = useState(false);
  useEffect(() => {
    if (!playerKey || runId || autoSeated.current) return;
    if (typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("seat")) return;
    autoSeated.current = true;
    const who = `climber${Math.floor(100 + Math.random() * 900)}`;
    setName(who);
    // A one-click visit is a practice seat: it must never spend a bankroll.
    void join(undefined, who, undefined, "practice").then(() => {
      setCoach(true);
      setTimeout(() => setCoach(false), 9000);
    });
    // join is stable enough for this one-shot; re-running would re-seat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerKey, runId]);

  const sound = useSound();
  const me = state?.seats?.find((s) => s.runId === runId) ?? null;
  /**
   * The clock, run locally between polls.
   *
   * secondsLeft is a server number and the responses carrying it land
   * irregularly — the database sits behind a pooler and a response can take
   * seconds. Rendering it raw made the countdown stutter and sit still. Anchor
   * on each fresh frame and count down from it here, so the clock stays smooth
   * however the network behaves.
   */
  const drift = state?.round ? (nowMs - stateAt.current) / 1000 : 0;
  const secs = Math.max(0, (state?.round?.secondsLeft ?? 0) - drift);
  const betsCloseIn = Math.max(0, (state?.round?.betsCloseIn ?? 0) - drift);
  const urgent = secs > 0 && secs < 15;

  /**
   * Is the game actually running?
   *
   * It can stop in two ways the page would otherwise not notice: the executor
   * stalls, so the newest window expired long ago and no successor opened; or
   * our own polling stops being answered. Either way the countdown drains to
   * zero and sits there, which reads as "this app is broken" rather than "the
   * clock is paused" — the worst possible thing for someone evaluating it.
   */
  const roundAge = state?.round ? (nowMs - Date.parse(state.round.expiresAt)) / 1000 : 0;
  const pollAge = (nowMs - stateAt.current) / 1000;
  // A frame with no round at all is the third way, and it used to slip
  // through: `roundAge` stayed 0, nothing looked stale, and the clock sat at
  // 00 reading TO THE BELL with no bell coming. There is nothing to count
  // down to — say so.
  const stalled = Boolean(state) && (!state?.round || roundAge > 90 || pollAge > 25);
  // The bell has rung and the keeper is settling it on-chain; the next round
  // appears in a few seconds. Say so instead of sitting on 00. "Under one
  // second" rather than "zero": the server's clock trails ours a little, so
  // frames in the gap still report a fraction of a second left, and testing
  // for zero made the label flicker between SETTLING and 00.
  const settlingLive = !stalled && Boolean(state?.round) && secs < 1;

  /** The newest state, with the clock replaced by the locally-run one so
   *  nothing on screen disagrees about the time. The dock acts on this. */
  const liveView: TableState | null =
    state?.round ? { ...state, round: { ...state.round, secondsLeft: secs, betsCloseIn } } : state;

  /**
   * The bell hold: one cut instead of three.
   *
   * The keeper opens the next round BEFORE it settles the last one on-chain.
   * Sampled live, a bell runs: 0:00 sits ~2.5 s, the new round lands already
   * at 0:57, and the result only arrives ~3 s after that. Rendered as it
   * came, the wall stepped three times — the clock pulsed, the climber slid
   * to the new line, then the verdict and the shake fired over a round that
   * had already started. That was the "glitch for a few seconds".
   *
   * So from the bell until the result for THAT round is in, the wall, clock
   * and stat panel stay on the closing frame — the price frozen at the
   * close, which is the honest number — and everything changes together
   * when the result lands. The dock keeps the live frame, so the next side
   * can be picked as soon as the new round opens. Capped, so a slow keeper
   * never freezes the wall for good.
   */
  const HOLD_MAX_MS = 12_000;
  const hold = useRef<{ round: number; at: number; frame: TableState | null; done: boolean } | null>(null);
  const liveIdx = state?.round?.index ?? null;
  const settledIdx = state?.lastResult?.index ?? -1;
  if (settlingLive && liveIdx !== null && settledIdx < liveIdx && hold.current?.round !== liveIdx) {
    hold.current = {
      round: liveIdx,
      at: nowMs,
      frame: liveView?.round ? { ...liveView, round: { ...liveView.round, secondsLeft: 0, betsCloseIn: 0 } } : liveView,
      done: false,
    };
  }
  const h = hold.current;
  if (h && !h.done && (stalled || settledIdx >= h.round || nowMs - h.at > HOLD_MAX_MS)) h.done = true;
  const holding = Boolean(h && !h.done);
  const settling = settlingLive || holding;
  const shownSecs = holding ? 0 : secs;
  /** What the wall, clock and stat panel render. */
  const view: TableState | null = holding ? h!.frame : liveView;

  useHeartbeat(secs, Boolean(me?.inRound));
  // The chosen climber's colours paint the whole site.
  useClimberTheme(climber);

  // One exit for the money, wherever it's asked from: mid-ride (BAIL sells at
  // live value) or between rounds (the stack banks as it stands).
  const bankOut = async () => {
    if (bailing || !runId || !me) return;
    setBailing(true);
    setEndedRunId(runId);
    setLeaping((n) => [...n, runId]);
    sound.play("win");
    const r = await post("/api/bank", { runId, playerKey });
    if (r?.ok) {
      safeLocal.remove("lc.runId");
      // Between rounds the stack banks as it stands; mid-ride the sale lands
      // at live value a tick later — either way this is the number the
      // player just chose to walk with.
      setVerdict({ kind: "banked", amount: liveMultipleOf(me, state?.price ?? { up: null, down: null }) * me.buyIn });
    } else setBailing(false);
    setTimeout(() => setLeaping((n) => n.filter((x) => x !== runId)), 1400);
  };
  useEffect(() => {
    if (!me && bailing) setBailing(false);
  }, [me, bailing]);


  // Auto-bail: the server owns the value; a click paints instantly and the
  // optimistic overlay retires the moment the poll agrees (or the seat ends).
  const [abOptimistic, setAbOptimistic] = useState<number | null | undefined>(undefined);
  const autoBail = abOptimistic !== undefined ? abOptimistic : (me?.autoBailAt ?? null);
  useEffect(() => {
    if (abOptimistic !== undefined && (!me || me.autoBailAt === abOptimistic)) {
      setAbOptimistic(undefined);
    }
  }, [me, abOptimistic]);
  const setAutoBail = async (at: number | null) => {
    if (!runId) return;
    sound.play("click");
    setAbOptimistic(at);
    const r = await post("/api/autobail", { runId, playerKey, at });
    if (!r) setAbOptimistic(undefined);
  };

  // The bell, made personal: did YOUR money win, lose, or carry? Matched by
  // runId, never display name — names are free text and can collide, and the
  // runId state outlives the seat the settling poll removes.
  const mine: BellVerdict =
    !bell || !verdict || verdict.kind === "banked"
      ? null
      : verdict.kind === "won"
        ? { kind: "won", from: verdict.from, to: verdict.to }
        : verdict.kind === "lost"
          ? { kind: "lost" }
          : { kind: "push" };
  /**
   * The bell belongs to whoever had a stake in it. A visitor who has not
   * joined should not have the screen shaken, a verdict flashed over the wall
   * and the bell tolled at them once a minute for somebody else's round.
   *
   * Two ways it is yours: the round resolved YOUR run (mine — which still
   * fires on the bell that kills you, after the seat is gone), or you are on
   * the wall right now and simply sat this window out.
   */
  const myBell = bell && (mine || me) ? bell : null;

  // A survivor who had already queued the next side is riding again by the
  // time the card could show — do not block their screen, just let the
  // banner go by itself.
  useEffect(() => {
    if (verdict && verdict.kind !== "lost" && verdict.kind !== "banked" && me?.inRound) {
      const t = setTimeout(() => setVerdict(null), 5000);
      return () => clearTimeout(t);
    }
  }, [verdict, me?.inRound]);

  // A ref, not a dep: `me` changes on every poll, and a dep that churns would
  // replay the bell sound for the whole 3.4s the verdict is up.
  const onTheWall = useRef(false);
  onTheWall.current = Boolean(me);

  useEffect(() => {
    if (!bell) return;
    const killed = runId ? bell.killed.some((k) => k.runId === runId) : false;
    const survived = runId ? bell.survived.some((s) => s.runId === runId) : false;
    if (!killed && !survived && !onTheWall.current) return; // not your round
    if (bell.voided) sound.play("push");
    else if (killed) sound.play("death");
    else if (survived) sound.play("win");
    else sound.play("toll");
  }, [bell, sound, runId]);

  const pickClimber = (id: ClimberId) => {
    sound.arm();
    sound.play("click");
    setClimber(id);
    safeLocal.set("lc.climber", id);
  };

  // The ledger backs the money bar, the sparkline and YOUR LAST RUN.
  // It refreshes on every bell (each bell can change it).
  const ledger = useLedger(playerKey, `${bell?.index ?? 0}-${runId}-${funded}-${verdict?.kind ?? ""}`);

  // A finished run must not linger in storage. The wall, the bail bar and the
  // auto-bail control all key off runId; a dead one keeps a previous session
  // half-attached to this screen. The ledger is authoritative and carries ended
  // runs, so a fresh join (not in it yet) is never cleared by mistake.
  useEffect(() => {
    if (!runId || !ledger) return;
    const known = ledger.runs?.find((r) => r.id === runId);
    if (known && known.status !== "alive") {
      safeLocal.remove("lc.runId");
      setRunId(null);
    }
  }, [runId, ledger]);

  /*
   * The phone layout is a GAME SCREEN, the way the crash games do it: one
   * stage that fills the screen, the number that matters drawn on the stage,
   * one dominant action in the thumb zone, everything secondary collapsed
   * into a single row. Header on top, controls docked to the bottom, and the
   * wall gets every pixel in between. The dock's height changes with the
   * moment (join box, UP/DOWN, BAIL), so the chrome is MEASURED and the wall
   * is handed the remainder as a CSS variable — no guessed budgets.
   *
   * On lg the grid is one viewport and the wall flexes; the dock sits in flow.
   */
  const topRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  // Only the CHROME is measured; the viewport side stays in CSS (`100dvh`),
  // so an address bar collapsing or a rotation never waits on a JS event.
  const [chrome, setChrome] = useState({ chromeH: 0, dockH: 0 });
  useEffect(() => {
    const measure = () => {
      const h = (r: React.RefObject<HTMLDivElement | null>) => r.current?.getBoundingClientRect().height ?? 0;
      const top = h(topRef);
      const dock = Math.round(h(dockRef));
      // main's top padding (12) + the grid's margin (8) + a breath (6).
      const chromeH = Math.round(top + dock + 26);
      setChrome((c) => (c.chromeH === chromeH && c.dockH === dock ? c : { chromeH, dockH: dock }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const r of [topRef, dockRef]) if (r.current) ro.observe(r.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const stageVars = {
    "--chrome-h": chrome.chromeH > 0 ? `${chrome.chromeH}px` : undefined,
    "--dock-h": `${chrome.dockH}px`,
  } as CSSProperties;

  // lg is one viewport by design, but `overflow-hidden` CLIPPED the side
  // buttons on a 13" laptop whose Chrome + dock leave ~680px: the wall had
  // already shrunk to its floor and UP/DOWN ran off the bottom. Scroll is the
  // honest fallback; when everything fits, nothing scrolls.
  return (
    <main
      style={stageVars}
      className={`relative z-10 mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pt-3 pb-[calc(var(--dock-h)+12px)] lg:h-screen lg:max-h-screen lg:overflow-y-auto lg:overflow-x-hidden lg:pb-3 ${myBell ? "shake" : ""}`}
    >
      {secs > 0 && secs < 10 && <div className="danger" />}

      <div ref={topRef}>
      <TopBar state={view} urgent={urgent} sound={sound} me={me} stalled={stalled} settling={settling} />

      {/* Desktop only. On a phone the money is drawn on the wall itself
          (top-left HUD) and the bankroll lives on the wallet page. */}
      <div className="hidden shrink-0 lg:block"><MoneyBar
          me={me}
          price={state?.price ?? { up: null, down: null }}
          ledger={ledger}
          walletReady={walletReady}
          addr={addr}
          funding={funding}
          onConnect={connectWallet}
          onFund={() => fundBankroll(10n)}
        /></div>

      {coach && me && (
        <div
          role="status"
          className="chamfer-sm mt-2 shrink-0 border px-4 py-2 text-center text-[10px] font-black tracking-[0.25em]"
          style={{ borderColor: "var(--up)", background: "#06170f", color: "var(--up)" }}
        >
          YOU&apos;RE IN, ON THE HOUSE — PICK A SIDE AND YOUR WHOLE STACK RIDES ONE MINUTE OF {state?.mark?.asset ?? "HYPE"}
        </div>
      )}

      {stalled && (
        <div
          role="status"
          className="chamfer-sm mt-2 shrink-0 border px-4 py-2 text-center text-[10px] font-black tracking-[0.25em]"
          style={{ borderColor: "var(--gold)", background: "#241c07", color: "var(--gold)" }}
        >
          {pollAge > 25
            ? "RECONNECTING — THE MARKET CLOCK IS AHEAD OF US. NOTHING IS LOST; PICKS AND STACKS ARE SAFE."
            : "THE WALL WAS ASLEEP — YOU WOKE IT. THE NEXT ROUND STRIKES AT THE TOP OF THE MINUTE."}
        </div>
      )}
      </div>

      {seatFlash && (
        <div className="pointer-events-none fixed inset-x-0 top-[20%] z-40 text-center">
          <p className="display text-3xl sm:text-4xl" style={{ color: seatFlash === "paid" ? "var(--down)" : "var(--gold)", textShadow: `0 0 40px ${seatFlash === "paid" ? "var(--down-glow)" : "var(--gold-glow)"}` }}>
            {seatFlash === "paid" ? "RANKED SEAT −10.00" : "PRACTICE SEAT · 10.00"}
          </p>
          <p className="mt-1 text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">
            {seatFlash === "paid"
              ? "YOUR tUSDC — COUNTS ON THIS WEEK'S BOARDS"
              : "ON THE HOUSE — PRACTICE NEVER COUNTS ON THE BOARDS"}
          </p>
        </div>
      )}

      {/* The HUD: roster rail · the wall · the stat block. One viewport,
          no scroll — the wall flexes to fill whatever height is left. */}
      <div className="mt-2 grid grid-cols-1 gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_240px]">

        <div className="flex min-w-0 flex-col lg:min-h-0">
          {/* The wall's height floor belongs HERE, not on the wall itself —
              the wall is lg:h-full and must never outgrow this slot. */}
          <div className="lg:min-h-[300px] lg:flex-1">
          <Cliff
            seats={view?.seats ?? []}
            price={view?.price ?? { up: null, down: null }}
            secondsLeft={shownSecs}
            clockUrgent={urgent}
            stalled={stalled}
            settling={settling}
            intervalSec={state?.round?.intervalSec ?? 60}
            myRunId={runId}
            falling={(bell?.killed ?? []).map((k) => k.runId)}
            cheering={(bell?.survived ?? []).filter((x) => !bell?.voided && x.to > x.from).map((x) => ({ runId: x.runId, gain: x.to - x.from }))}
            bellKey={bell?.index ?? null}
            dailyRun={Boolean(runId && ledger?.daily?.runId === runId)}
            bells={view?.bells ?? []}
            leaping={leaping}
            mark={view?.mark ?? { asset: "HYPE", price: null, strike: null, oracleQuestionId: null }}
            record={view?.wallRecord ?? null}
            climber={climber}
            onMilestone={(m) => {
              sound.play("win");
              setPassed(`${m}×`);
              setTimeout(() => setPassed(null), 2000);
            }}
          />
          </div>

          {/* THE DOCK. One control, matched to the moment, never several at
              once. On a phone it is fixed to the bottom edge — the thumb
              zone — and the wall above is sized to end exactly where it
              begins (see the measurement above), so it never covers play.
              On lg it sits in flow under the wall. */}
          <div
            ref={dockRef}
            className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--edge)] bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-md lg:static lg:backdrop-blur-none lg:mt-2 lg:border-0 lg:bg-transparent lg:px-0 lg:pt-0 lg:pb-0"
          >
            {verdict && (!me || !me.inRound || verdict.kind === "lost" || verdict.kind === "banked") ? (
              <Result
                verdict={verdict}
                share={
                  endedRunId && (verdict.kind === "lost" || verdict.kind === "banked") ? (
                    <ShareRun
                      runId={endedRunId}
                      run={ledger?.runs?.find((r) => r.id === endedRunId && r.status !== "alive") ?? null}
                      climber={climber}
                      name={ledger?.name ?? "climber"}
                      daily={ledger?.daily?.runId === endedRunId}
                    />
                  ) : null
                }
                daily={
                  endedRunId && ledger?.daily?.runId === endedRunId && ledger.daily.rank
                    ? `DAILY CLIMB · #${ledger.daily.rank} OF ${ledger.daily.entrants} TODAY`
                    : null
                }
                busy={busy || bailing}
                onContinue={() => setVerdict(null)}
                onCashOut={() => {
                  void bankOut();
                }}
                onAgain={() => {
                  setVerdict(null);
                  sound.arm();
                  void join(undefined, name || undefined);
                }}
                onBack={() => {
                  setVerdict(null);
                  setPreStage("climber");
                }}
              />
            ) : !runId || !me ? (
              preStage === "climber" ? (
                <ChooseClimber climber={climber} secs={view?.round ? shownSecs : null} onPick={pickClimber} onNext={() => { sound.arm(); setPreStage("name"); }} />
              ) : (
              <Join
                secs={view?.round ? shownSecs : null}
                name={name}
                setName={setName}
                busy={busy}
                paying={paying}
                addr={addr}
                walletReady={walletReady}
                bank={ledger?.bank ?? null}
                dailyOpen={!ledger?.daily?.runId}
                onJoin={() => { sound.arm(); join(); }}
                onPractice={() => { sound.arm(); join(undefined, undefined, undefined, "practice"); }}
                onConnect={connectWallet}
                onBuy={buySeat}
                onPlayFree={() => setAddr(null)}
                onBack={() => setPreStage("climber")}
              />
              )
            ) : me.inRound ? (
              <BailBar
                me={me}
                price={state?.price ?? { up: null, down: null }}
                pending={bailing}
                onBank={bankOut}
                autoBail={autoBail}
                onAutoBail={setAutoBail}
                onNext={async (side) => {
                  if (!runId) return;
                  sound.arm();
                  sound.play("click");
                  await post("/api/pick", { runId, playerKey, side });
                }}
              />
            ) : liveView?.round ? (
              <Sides
                state={liveView}
                me={me}
                optimistic={optimisticPick}
                onWalk={bankOut}
                walking={bailing}
                onPick={async (side) => {
                  if (busy) return;
                  sound.arm();
                  sound.play("click");
                  setOptimisticPick(side);
                  if (runId) {
                    setBusy(true);
                    const r = await post("/api/pick", { runId, playerKey, side });
                    setBusy(false);
                    if (!r) setOptimisticPick(null);
                  }
                }}
              />
            ) : null}
            {err && <p className="mt-2 text-sm text-[var(--down)]">{err}</p>}
          </div>
        </div>

        <StatPanel state={view} me={me} climber={climber} series={ledger?.series ?? null} />
      </div>

      {/* 40% of the viewport is inside the wall on every layout; at 28% a
          phone printed this over the money bar's FUND button. */}
      {passed && (
        <div className="pointer-events-none fixed inset-x-0 top-[40%] z-40 text-center">
          <span className="display text-3xl glow-gold sm:text-4xl">LEDGE {passed}</span>
        </div>
      )}

      <div id="runs" className="lg:hidden">
        <Feed state={state} />
        {!me && <LastRun ledger={ledger} climber={climber} />}
      </div>
      {/* A won or lost bell plays its finish on the wall first. */}
      {myBell && <Bell result={myBell} mine={mine} delay={mine?.kind === "won" || mine?.kind === "lost" ? 1.4 : 0} />}
      <div className="lg:hidden"><Footnote state={state} /></div>
    </main>
  );
}

/* ───────────────────────────── top bar ───────────────────────────── */

function TopBar({
  state,
  urgent,
  sound,
  me,
  stalled,
  settling,
}: {
  state: TableState | null;
  urgent: boolean;
  sound: ReturnType<typeof useSound>;
  me: TableState["seats"][number] | null;
  stalled: boolean;
  settling: boolean;
}) {
  const secs = Math.floor(state?.round?.secondsLeft ?? 0);
  const t = state?.table;
  const roping = t?.status === "filling" && t.seated > 0;
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex shrink-0 items-center gap-3">
        <Image src="/mark.webp" alt="" width={64} height={34} priority className="h-9 w-auto" />
        {/* the mark IS the logo; on a phone the word and the subtitle cost
            the nav its row, and the nameplate on the wall says whose money */}
        <div className="hidden sm:block">
          <h1 className="display whitespace-nowrap text-base leading-none tracking-[0.2em] sm:text-lg">ROPES</h1>
          <p className="mt-0.5 text-[9px] font-bold tracking-[0.3em] text-[var(--dim)]">
            {roping
              ? `ROPING UP · ${clock(t!.sealsIn)}`
              : me
                ? (
                  /* The title block and the clock together need 364px of a
                     343px header at 375 wide, so the long form wrapped the
                     clock onto its own row. The money bar and the nameplate
                     both carry the qualifier; here the short form is enough. */
                  <>
                    {me.paid ? "RANKED" : "PRACTICE"}
                    <span className="hidden sm:inline">
                      {me.paid ? " · YOUR tUSDC" : " · HOUSE MONEY"}
                    </span>
                  </>
                )
                : `${state?.mark?.asset ?? "HYPE"} · ${Math.round((state?.round?.intervalSec ?? 60) / 60)} MINUTE`}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 sm:gap-1">
        <SiteNav from="lg" />
        <NavMenu from="lg" />
        <button
          onClick={sound.toggle}
          aria-label={sound.on ? "Mute sound" : "Unmute sound"}
          aria-pressed={sound.on}
          className="gametab flex items-center"
        >
          <SpeakerIcon on={sound.on} />
        </button>
      </div>

      {/* lg and up only: below that the clock is drawn ON the wall, where
          the crash games put the number that matters */}
      <div className="hidden text-right lg:block">
        <div className={`display tabular outline-num clock-num text-5xl leading-[0.85] sm:text-7xl ${urgent && !stalled ? "clock-urgent" : ""} `}
          style={stalled ? { color: "var(--dim)" } : settling ? { color: "var(--gold)" } : undefined}>
          {stalled || settling ? "··" : bigClock(secs)}
        </div>
        <p className="mt-0.5 text-[9px] font-bold tracking-[0.3em] text-[var(--dim)]">
          {stalled ? "CLOCK PAUSED" : settling ? "SETTLING · NEXT ROPE" : "TO THE BELL"}
        </p>
      </div>
    </header>
  );
}

/* ───────────────────────── step 1 · the climber ───────────────────────── */

/**
 * The selection screen from every mech garage: eight climbers, one outlined.
 * Purely cosmetic — the market does not care what you look like — but choosing
 * a body is half of what makes a game feel like one, and it is the FIRST thing
 * a new player does here, before a name and before a bet.
 */
function ChooseClimber({
  climber,
  secs,
  onPick,
  onNext,
}: {
  climber: ClimberId;
  secs: number | null;
  onPick: (id: ClimberId) => void;
  onNext: () => void;
}) {
  const cast = CAST.find((c) => c.id === climber) ?? CAST[0];
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[10px] font-black tracking-[0.3em] text-[var(--dim)]">
          <span className="text-[var(--gold)]">1</span> · CHOOSE YOUR CLIMBER
        </p>
        <p className="text-[10px] font-black tracking-[0.2em] text-[var(--accent)]">
          {cast.code} · {cast.label}
        </p>
      </div>
      <div className="grid grid-cols-8 gap-1.5 sm:gap-2">
        {CAST.map((c) => (
          <button
            key={c.id}
            onClick={() => onPick(c.id)}
            title={`${c.code} ${c.label}`}
            aria-pressed={climber === c.id}
            className={`slot chamfer-sm aspect-[3/4] w-full ${climber === c.id ? "sel" : ""}`}
          >
            <Image
              src={`/climbers/${c.id}/climb.webp`}
              alt={c.label}
              width={40}
              height={56}
              unoptimized
              loading="eager"
              className="h-[72%] w-auto"
            />
          </button>
        ))}
      </div>
      {/* the same pinned CTA as the landing: the bell beside one big
          thumb-zone button */}
      <div className="mt-2.5 flex items-stretch gap-2.5">
        <div className="flex lg:hidden"><BellChip secs={secs} /></div>
        <button
          onClick={onNext}
          className="chamfer flex min-h-[60px] flex-1 flex-col items-center justify-center bg-[var(--gold)] px-4 text-[#120d02] transition hover:brightness-110 active:brightness-90"
        >
          <span className="display text-lg leading-none tracking-[0.12em]">CONTINUE →</span>
          <span className="mt-1 text-[9px] font-black tracking-[0.2em] opacity-70">AS {cast.label} · PRACTICE IS FREE</span>
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── after the bell · the result ───────────────────────── */

type Verdict =
  | { kind: "won"; from: number; to: number }
  | { kind: "push"; to: number }
  | { kind: "lost"; closedBy: number | null; winner: "UP" | "DOWN" | null }
  | { kind: "banked"; amount: number }
  | null;

/**
 * The bell has rung and it concerned you. Say what happened in dollars and
 * offer exactly the two moves that exist: go on, or go back. Nothing else on
 * the screen changes until you choose.
 */
function Result({
  verdict,
  share,
  daily,
  busy,
  onContinue,
  onCashOut,
  onAgain,
  onBack,
}: {
  verdict: NonNullable<Verdict>;
  /** Share buttons for the run that just ended. */
  share?: ReactNode;
  /** Where the run landed on today's Daily Climb, if it was one. */
  daily?: string | null;
  busy: boolean;
  onContinue: () => void;
  onCashOut: () => void;
  onAgain: () => void;
  onBack: () => void;
}) {
  const c =
    verdict.kind === "won" ? "var(--up)" : verdict.kind === "lost" ? "var(--down)" : "var(--gold)";
  const title =
    verdict.kind === "won"
      ? `YOU WON +${(verdict.to - verdict.from).toFixed(2)}`
      : verdict.kind === "lost"
        ? "YOU FELL"
        : verdict.kind === "push"
          ? "PUSH"
          : `BANKED ${verdict.amount.toFixed(2)}`;
  const line =
    verdict.kind === "won"
      ? `STACK NOW ${verdict.to.toFixed(2)} — RIDE IT AGAIN, OR CASH OUT`
      : verdict.kind === "lost"
        ? verdict.closedBy !== null
          ? `${markInfo.asset} CLOSED $${fmtMove(verdict.closedBy, markInfo.strike)} ${verdict.closedBy >= 0 ? "OVER" : "UNDER"} THE LINE — ${verdict.winner} WON. ONLY YOUR SEAT WAS AT RISK`
          : "THE OTHER SIDE WON. ONLY YOUR SEAT WAS AT RISK"
        : verdict.kind === "push"
          ? `NO PRICE AT THE BELL — THE ROUND VOIDED, YOUR STACK OF ${verdict.to.toFixed(2)} CARRIES`
          : "THE RUN IS OVER AND THE MONEY IS BOOKED";
  const primary =
    verdict.kind === "lost" || verdict.kind === "banked"
      ? { label: busy ? "SEATING…" : "PLAY AGAIN", on: onAgain }
      : { label: "CONTINUE — PICK A SIDE", on: onContinue };
  const secondary =
    verdict.kind === "lost" || verdict.kind === "banked"
      ? { label: "◂ BACK TO START", on: onBack }
      : { label: busy ? "CASHING OUT…" : "CASH OUT & LEAVE", on: onCashOut };
  return (
    <div
      className="chamfer border px-4 py-3"
      style={{ borderColor: c, background: "linear-gradient(180deg, var(--panel-2), var(--panel))", boxShadow: `0 0 44px -18px ${c}` }}
      role="status"
    >
      <p className="text-[10px] font-black tracking-[0.3em] text-[var(--dim)]">THE BELL</p>
      <p className="display mt-1 text-3xl leading-none sm:text-4xl" style={{ color: c, textShadow: `0 0 34px ${c}55` }}>
        {title}
      </p>
      <p className="mt-1.5 text-[10px] font-bold tracking-[0.2em] text-[var(--dim)]">{line}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={primary.on}
          disabled={busy}
          className="chamfer-sm min-h-[46px] bg-[var(--gold)] px-3 text-sm font-black tracking-[0.12em] text-black transition hover:brightness-110 disabled:opacity-60"
        >
          {primary.label}
        </button>
        <button
          onClick={secondary.on}
          disabled={busy}
          className="chamfer-sm min-h-[46px] border border-[var(--edge)] px-3 text-sm font-black tracking-[0.12em] text-[var(--dim)] transition hover:border-[var(--gold)] hover:text-[var(--gold)] disabled:opacity-60"
        >
          {secondary.label}
        </button>
      </div>
      {(share || daily) && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-black tracking-[0.22em] text-[var(--gold)]">{daily ?? "SHOW THEM HOW HIGH"}</span>
          {share}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── stat panel ──────────────────────────── */

function Stat({ label, value, frac }: { label: string; value: string; frac: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] font-black tracking-[0.25em] text-[var(--dim)]">{label}</span>
        <span className="tabular text-[11px] font-bold">{value}</span>
      </div>
      <div className="statbar mt-1">
        <div style={{ width: `${Math.max(2, Math.min(100, frac * 100))}%` }} />
      </div>
    </div>
  );
}

/** The RPG stat block: altitude as the level numeral, then the bars. */
function Sparkline({ series }: { series: number[] }) {
  const w = 200;
  const h = 42;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = Math.max(max - min, 0.01);
  const pts = series.map((v, i) => [
    (i / Math.max(series.length - 1, 1)) * (w - 8) + 4,
    h - 6 - ((v - min) / span) * (h - 12),
  ]);
  const d = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const up = series[series.length - 1] >= series[0];
  const c = up ? "var(--up)" : "var(--down)";
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[42px] w-full" aria-hidden="true">
      <polyline points={d} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" opacity="0.9" />
      <circle cx={lx} cy={ly} r="3" fill={c} />
    </svg>
  );
}

function StatPanel({
  state,
  me,
  climber,
  series,
}: {
  state: TableState | null;
  me: TableState["seats"][number] | null;
  climber: ClimberId;
  series: number[] | null;
}) {
  const cast = CAST.find((c) => c.id === climber) ?? CAST[0];
  const smoothMult = useSmoothed(liveMultipleOf(me, state?.price ?? { up: null, down: null }), 340, 3);
  const mult = me ? smoothMult : null;
  const record = state?.wallRecord?.multiple ?? null;
  const best = me?.best ?? null;
  // One scale for every bar, so they are comparable at a glance.
  const scale = Math.max(record ?? 0, best ?? 0, mult ?? 0, 2);
  const mark = state?.mark;

  return (
    <aside className="ticks chamfer-sm hidden flex-col gap-4 border p-4 lg:flex lg:h-full lg:min-h-0 lg:overflow-y-auto"
      style={{ borderColor: "var(--edge)", background: "linear-gradient(180deg, var(--panel-2), var(--panel))" }}>
      <div>
        <p className="text-[9px] font-black tracking-[0.3em] text-[var(--dim)]">{cast.code}</p>
        <p className="display text-lg tracking-[0.08em]">{cast.label}</p>
        <span className="hatch mt-1 block h-[6px] w-full" />
      </div>

      <div className="border border-[var(--edge)] px-3 py-2">
        <p className="text-[9px] font-black tracking-[0.3em] text-[var(--dim)]">ALTITUDE</p>
        <p className="display tabular text-5xl leading-none glow-gold">
          {mult !== null ? mult.toFixed(2) : "—"}
          {mult !== null && <span className="text-2xl opacity-70">×</span>}
        </p>
        {series && series.length >= 2 && (
          <div className="mt-1.5 border-t border-[var(--edge)] pt-1">
            <p className="text-[8px] font-black tracking-[0.3em] text-[var(--dim)]">THIS RUN, BELL BY BELL</p>
            <Sparkline series={series} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Stat label="CURRENT" value={mult !== null ? `${mult.toFixed(2)}×` : "—"} frac={(mult ?? 0) / scale} />
        <Stat label="YOUR BEST" value={best !== null ? `${best.toFixed(2)}×` : "—"} frac={(best ?? 0) / scale} />
        <Stat label="RECORD" value={record !== null ? `${record.toFixed(2)}×` : "—"} frac={(record ?? 0) / scale} />
        <Stat
          label="ROUNDS"
          value={me ? `${me.rounds}` : "—"}
          frac={me && state?.record ? Math.min(1, me.rounds / Math.max(state.record.rounds, 1)) : 0}
        />
      </div>

      {mark?.price != null && mark.strike != null && (
        <div className="mt-auto border-t border-[var(--edge)] pt-3">
          <p className="text-[9px] font-black tracking-[0.3em] text-[var(--dim)]">{mark.asset} vs THE LINE</p>
          <p className="tabular mt-1 text-lg font-bold"
            style={{ color: mark.price >= mark.strike ? "var(--up)" : "var(--down)" }}>
            {mark.price >= mark.strike ? "▲ +$" : "▼ −$"}
            {fmtMove(mark.price - mark.strike, mark.strike)}
          </p>
          <p className="tabular text-[10px] text-[var(--dim)]">
            TO BEAT ${fmtMark(mark.strike)}
          </p>
        </div>
      )}

      {/* the feed lives HERE on desktop, so the page never scrolls */}
      {state?.feed && state.feed.length > 0 && (
        <div className="border-t border-[var(--edge)] pt-2">
          <p className="text-[8px] font-black tracking-[0.3em] text-[var(--dim)]">LATEST BELLS</p>
          <div className="mt-1.5 space-y-1">
            {(state.feed ?? []).slice(0, 3).map((f, i) => (
              <div key={`${f.name}-${f.round}-${i}`} className="flex items-center justify-between text-[10px] font-bold">
                <span className="flex items-center gap-1.5 truncate">
                  <span style={{ color: f.kind === "died" ? "var(--down)" : f.kind === "swept" ? "var(--dim)" : "var(--gold)" }}>
                    {f.kind === "died" ? "☠" : f.kind === "swept" ? "⌁" : "◆"}
                  </span>
                  <span className="truncate">{f.name}</span>
                </span>
                <span className="tabular text-[var(--dim)]">{f.multiple.toFixed(2)}×</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {state?.mark?.oracleQuestionId && (
        <a
          className="text-[8px] font-bold tracking-[0.2em] text-[var(--dim)] underline decoration-dotted hover:text-[var(--gold)]"
          href={`${addressUrl(state.pay.market)}?tab=logs`}
          target="_blank"
          rel="noreferrer"
        >
          EVERY STRIKE, CLOSE AND FILL — ON-CHAIN ↗
        </a>
      )}
    </aside>
  );
}

/* ─────────────────────────── action bar ──────────────────────────── */

const AUTO_BAIL_PRESETS = [1.5, 2, 3, 5] as const;

function BailBar({
  me,
  price,
  pending,
  onBank,
  autoBail,
  onAutoBail,
  onNext,
}: {
  me: TableState["seats"][number];
  price: TableState["price"];
  pending: boolean;
  onBank: () => void;
  autoBail: number | null;
  onAutoBail: (at: number | null) => void;
  /** Queue a side for the NEXT window while this one is still riding. */
  onNext: (side: "UP" | "DOWN") => void;
}) {
  const liveMult = useSmoothed(liveMultipleOf(me, price), 340, 3);
  // Paints instantly; retires the moment the poll agrees or the ride ends.
  const [nextOptimistic, setNextOptimistic] = useState<"UP" | "DOWN" | null>(null);
  useEffect(() => {
    if (nextOptimistic && me.nextPick === nextOptimistic) setNextOptimistic(null);
  }, [me.nextPick, nextOptimistic]);
  const next = nextOptimistic ?? me.nextPick;
  const keep = liveMult * me.buyIn;
  const sideC = me.pick === "UP" ? "var(--up)" : "var(--down)";
  return (
    <>
      {/* the bet slip — what's riding, at what price */}
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[10px] font-bold tracking-[0.25em]">
        <span style={{ color: sideC }}>
          YOUR BET: {me.pick === "UP" ? "▲ UP" : "▼ DOWN"}
          {me.fillPrice ? ` · FILLED @ ${me.fillPrice.toFixed(3)}` : ""}
        </span>
        <span className="tabular text-[var(--dim)]">STAKE {me.costInRound.toFixed(2)}</span>
      </div>
    <button
      onClick={onBank}
      disabled={pending}
      className="chamfer flex w-full items-center justify-between gap-3 border px-4 py-3 text-left transition disabled:opacity-70 sm:px-5 sm:py-4"
      style={{
        borderColor: "var(--gold)",
        background: "linear-gradient(90deg, #241c07, var(--panel))",
        boxShadow: "0 0 44px -18px var(--gold)",
      }}
    >
      <span>
        <span className="display text-2xl glow-gold sm:text-3xl">{pending ? "SELLING…" : "BAIL"}</span>
        <span className="ml-3 text-[11px] font-bold tracking-widest text-[var(--dim)]">
          {pending ? "ON THE BOOK — MONEY LANDS IN A MOMENT" : `KEEP ${keep.toFixed(2)}`}
        </span>
      </span>
      <span className="display tabular text-3xl glow-gold sm:text-4xl">{liveMult.toFixed(2)}×</span>
    </button>

      {/* Everything secondary on ONE row: the auto-bail line (the executor
          pulls the ripcord for you) and the side queued for the next minute
          (the bell rolls a survivor straight in). Labels shrink to their
          icons on a phone; the lit chip is the state. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-black tracking-[0.2em]">
        <span className="text-[var(--dim)]">
          <span className="sm:hidden">⚡</span>
          <span className="hidden sm:inline">⚡ AUTO-BAIL</span>
        </span>
        {AUTO_BAIL_PRESETS.map((at) => {
          const active = autoBail === at;
          return (
            <button
              key={at}
              onClick={() => onAutoBail(active ? null : at)}
              className="chamfer-sm min-h-10 border px-2.5 py-1 transition"
              style={{
                borderColor: active ? "var(--gold)" : "var(--edge)",
                color: active ? "var(--gold)" : "var(--dim)",
                background: active ? "#241c07" : "transparent",
              }}
            >
              {at}×
            </button>
          );
        })}
        {autoBail !== null && !AUTO_BAIL_PRESETS.includes(autoBail as (typeof AUTO_BAIL_PRESETS)[number]) && (
          <span className="text-[var(--gold)]">{autoBail}×</span>
        )}
        <span className="mx-0.5 h-5 w-px bg-[var(--edge)]" aria-hidden="true" />
        <span className="text-[var(--dim)]">
          <span className="sm:hidden">⟳</span>
          <span className="hidden sm:inline">⟳ NEXT MINUTE</span>
        </span>
        {(["UP", "DOWN"] as const).map((side) => {
          const active = next === side;
          const c = side === "UP" ? "var(--up)" : "var(--down)";
          return (
            <button
              key={side}
              onClick={() => {
                setNextOptimistic(side);
                onNext(side);
              }}
              className="chamfer-sm min-h-10 border px-2.5 py-1 transition"
              style={{
                borderColor: active ? c : "var(--edge)",
                color: active ? c : "var(--dim)",
                background: active ? (side === "UP" ? "#06170f" : "#1a0810") : "transparent",
                boxShadow: active ? `0 0 18px -8px ${c}` : "none",
              }}
            >
              {side === "UP" ? "▲ UP" : "▼ DOWN"}
            </button>
          );
        })}
        <span className="ml-auto hidden whitespace-nowrap text-[var(--dim)] lg:inline">
          {autoBail !== null && <span className="text-[var(--gold)]">SELLS AT {autoBail}×</span>}
          {autoBail !== null && next && " · "}
          {next && "NEXT MINUTE QUEUED"}
        </span>
      </div>
    </>
  );
}

function Sides({
  state,
  me,
  onPick,
  optimistic,
  onWalk,
  walking,
}: {
  state: TableState;
  me: TableState["seats"][number] | null;
  onPick: (side: "UP" | "DOWN") => void;
  optimistic: "UP" | "DOWN" | null;
  onWalk?: () => void;
  walking?: boolean;
}) {
  const canPick = me && !me.inRound;
  const shownPick = optimistic ?? me?.pick ?? null;

  /**
   * Why a placed bet is not on the book yet.
   *
   * These 1m books are routinely EMPTY at the open, and the executor declines
   * a quote above the entry cap rather than risking a whole stack for a few
   * percent. Both are honest, both leave the player staring at a bet that
   * hasn't happened — so say which one it is instead of claiming "entering
   * now" while nothing enters.
   */
  const pickPrice = shownPick === "UP" ? state.price.up : shownPick === "DOWN" ? state.price.down : null;
  const pickCapped = shownPick === "UP" ? state.capped.up : shownPick === "DOWN" ? state.capped.down : false;
  const windowOpen = (state.round?.betsCloseIn ?? 0) > 0;
  const pickStatus = pickCapped
    ? "TOO PRICEY — HOLDING FOR A BETTER QUOTE"
    : pickPrice === null
      ? windowOpen
        ? `WAITING FOR THE BOOK · ${clock(state.round?.betsCloseIn ?? 0)}`
        : "NO BOOK THIS WINDOW — RIDES THE NEXT"
      : windowOpen
        ? "ENTERING NOW"
        : "RIDES THE NEXT WINDOW";

  return (
    <>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[10px] font-bold tracking-[0.25em] text-[var(--dim)]">
        <span className={state.locked || shownPick ? "glow-gold" : ""}>
          {me && !me.playing
            ? "ROPING UP"
            : state.locked
              ? "LOCKED — WATCH IT PLAY OUT"
              : shownPick
                ? `YOUR BET: ${shownPick === "UP" ? "▲ UP" : "▼ DOWN"} — ${pickStatus}`
                : canPick
                  ? (state.round?.betsCloseIn ?? 0) > 0
                    ? `BETS OPEN — CLOSE IN ${clock(state.round!.betsCloseIn)}`
                    : `BETS CLOSED — NEXT WINDOW IN ${clock(state.round?.secondsLeft ?? 0)}`
                  : "NEXT ROUND"}
          {me?.autoBailAt != null && (
            <span className="ml-2 text-[var(--gold)]">⚡ AUTO-BAIL {me.autoBailAt}×</span>
          )}
        </span>
        {/* The exit door: between rounds the stack banks as it stands. Lives
            in this header row so the one-viewport layout pays no height. */}
        {onWalk && me && me.stack > 0 ? (
          <button
            onClick={onWalk}
            disabled={walking}
            className="tabular whitespace-nowrap font-black tracking-[0.2em] underline decoration-dotted underline-offset-2 transition hover:text-[var(--gold)] disabled:opacity-60"
          >
            {walking ? "CASHING OUT…" : `TAKE ${me.stack.toFixed(2)} & WALK →`}
          </button>
        ) : (
          <span className="tabular">
            {state.round ? `ROUND ${state.round.index} · ` : ""}BELL{" "}
            {clock(state.round?.secondsLeft ?? 0)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(["UP", "DOWN"] as const).map((side) => {
          const isUp = side === "UP";
          const price = isUp ? state.price.up : state.price.down;
          const pays = isUp ? state.pays.up : state.pays.down;
          const capped = isUp ? state.capped.up : state.capped.down;
          const picked = shownPick === side;
          const unpicked = shownPick !== null && !picked;
          const c = isUp ? "var(--up)" : "var(--down)";

          return (
            <button
              key={side}
              disabled={!canPick || capped}
              onClick={() => onPick(side)}
              className={`side ${isUp ? "side-up" : "side-down"} ${picked ? "picked" : ""} ${unpicked ? "unpicked" : ""} chamfer border p-3 text-left disabled:cursor-not-allowed min-[400px]:p-4 sm:p-5`}
              style={{
                color: c,
                borderColor: picked ? c : "var(--edge)",
                background: `linear-gradient(180deg, ${isUp ? "#06170f" : "#1a0810"}, var(--panel))`,
                opacity: capped ? 0.45 : 1,
              }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="display whitespace-nowrap text-lg tracking-[0.12em] sm:text-2xl sm:tracking-[0.15em]">
                  {isUp ? "▲ UP" : "▼ DOWN"}
                </span>
                <span className="tabular hidden whitespace-nowrap text-[10px] font-bold text-[var(--dim)] min-[420px]:inline sm:text-[11px]">
                  PAYS IF RIGHT
                </span>
              </div>

              {pays ? (
                <div
                  className="pays-num display tabular mt-2 text-4xl leading-none min-[400px]:text-5xl sm:mt-3 sm:text-7xl"
                  style={{ textShadow: `0 0 44px ${c}55` }}
                >
                  {pays.toFixed(2)}
                  <span className="align-super text-2xl opacity-60">×</span>
                </div>
              ) : (
                <div className="pays-wait mt-2 flex h-[40px] items-center sm:mt-3 sm:h-[72px]">
                  <span className="text-sm font-semibold tracking-[0.2em] text-[var(--dim)]">
                    WAITING FOR THE BOOK
                  </span>
                </div>
              )}

              <div className="mt-2 text-[11px] font-bold tracking-wider text-[var(--dim)]">
                {capped
                  ? "ABOVE 90% — NOT WORTH THE RISK"
                  : price
                    ? `${price.toFixed(3)} PER CONTRACT`
                    : "THE BOOK IS EMPTY AT WINDOW OPEN"}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Join({
  secs,
  name,
  setName,
  busy,
  paying,
  addr,
  walletReady,
  bank,
  dailyOpen,
  onJoin,
  onPractice,
  onConnect,
  onBuy,
  onPlayFree,
  onBack,
}: {
  secs: number | null;
  name: string;
  setName: (v: string) => void;
  busy: boolean;
  paying: boolean;
  addr: Address | null;
  walletReady: boolean;
  bank: LedgerData["bank"];
  /** Today's Daily Climb is still untaken: this seat will be it. */
  dailyOpen: boolean;
  onJoin: () => void;
  onPractice: () => void;
  onConnect: () => void;
  onBuy: () => void;
  onPlayFree: () => void;
  onBack: () => void;
}) {
  // A funded bankroll seats with ONE click — the server debits it, no
  // wallet popup. That is the whole point of the bankroll.
  const funded = Boolean(bank && bank.balance >= 10);
  // Ranked seats are rationed per wallet per day; practice never is.
  const left = bank ? Math.max(0, (bank.rankedCap ?? 20) - (bank.rankedToday ?? 0)) : 0;
  const capped = funded && left === 0;
  const primary = funded && !capped ? onJoin : addr ? onBuy : onPractice;
  // No wallet anywhere: practice is the only door, so it gets the solid fill.
  const solo = !funded && !addr && !walletReady;
  /*
   * The rules are four cards' worth of screen. A first-timer needs them; a
   * returning player has read them and just wants the wall back, so they
   * collapse to one line after the first visit. This block was the single
   * biggest thing crowding the game.
   */
  const [showRules, setShowRules] = useState(false);
  useEffect(() => {
    /*
     * Expanded-by-default is right on a desktop and wrong on a phone. Four
     * rule cards are ~185px, which pushed the name field and the seat button
     * to 899px on an 812px screen — a first-time visitor landed on the wall,
     * scrolled past the rules, and never saw the way in. On a narrow screen
     * the button wins; the rules are one tap away for anyone who wants them.
     */
    const roomy = window.matchMedia("(min-width: 1024px)").matches;
    setShowRules(roomy && safeLocal.get("lc.rulesSeen") !== "1");
  }, []);
  return (
    // flex column so the buttons can sit LAST on a phone, in the thumb zone,
    // with the small print above them instead of under them
    <div className="flex flex-col">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[10px] font-black tracking-[0.3em] text-[var(--dim)]">
          <span className="text-[var(--gold)]">2</span> · YOUR NAME
        </p>
        <button onClick={onBack} className="min-h-[36px] text-[10px] font-black tracking-[0.2em] text-[var(--dim)] transition hover:text-[var(--gold)]">
          ◂ CHANGE CLIMBER
        </button>
      </div>
      <button
        onClick={() => {
          setShowRules((v) => !v);
          safeLocal.set("lc.rulesSeen", "1");
        }}
        className="mb-2 flex min-h-[40px] items-center text-left text-[10px] font-black tracking-[0.25em] text-[var(--dim)] transition hover:text-[var(--gold)] lg:min-h-0"
        aria-expanded={showRules}
      >
        {showRules ? "▾ HOW IT WORKS" : (
          <>
            ▸ HOW IT WORKS
            <span className="hidden sm:inline"> · 10 tUSDC A SEAT, ONE MINUTE A ROUND</span>
          </>
        )}
      </button>
      {showRules && <HowItWorks />}
      {dailyOpen && (
        <p className="mb-2 text-[10px] font-black tracking-[0.2em] text-[var(--gold)]">
          ★ THIS SEAT IS TODAY&apos;S DAILY CLIMB — ONE SHOT ON TODAY&apos;S BOARD.{" "}
          <Link href="/leaders?tab=daily" className="underline decoration-dotted">SEE IT →</Link>
        </p>
      )}
      {/* Name on its own row, then the doors as big thumb-zone buttons with
          the bell beside them, the same pinned CTA as the landing. Two doors,
          always visibly different: green is PRACTICE on the house's money,
          gold is RANKED on yours. Practice stays open to everyone. */}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && primary()}
        placeholder="your name"
        maxLength={12}
        autoFocus
        className="w-full min-w-0 rounded-lg border border-[var(--edge)] bg-[var(--panel)] px-4 py-3 text-base outline-none focus:border-[var(--gold)]"
      />
      <div className="order-last mt-2.5 flex items-stretch gap-2.5 lg:order-none">
        <div className="flex lg:hidden"><BellChip secs={secs} /></div>
        <button
          onClick={onPractice}
          disabled={!name.trim() || busy}
          className={`chamfer flex min-h-[60px] flex-1 flex-col items-center justify-center border border-[var(--up)] px-3 transition disabled:opacity-40 ${
            solo ? "bg-[var(--up)] text-black hover:brightness-110" : "text-[var(--up)] hover:bg-[var(--up)] hover:text-black"
          }`}
        >
          <span className="display text-lg leading-none tracking-[0.12em]">{busy && !paying ? "SEATING…" : solo ? "PRACTICE →" : "PRACTICE"}</span>
          <span className="mt-1 text-[9px] font-black tracking-[0.2em] opacity-75">FREE · HOUSE MONEY</span>
        </button>
        {(funded || addr || walletReady) && (
          <button
            onClick={funded ? onJoin : addr ? onBuy : onConnect}
            disabled={funded ? !name.trim() || busy || capped : addr ? !name.trim() || paying || busy : false}
            className="chamfer flex min-h-[60px] flex-1 flex-col items-center justify-center bg-[var(--gold)] px-3 text-[#120d02] transition hover:brightness-110 disabled:opacity-40"
          >
            <span className="display text-lg leading-none tracking-[0.12em]">
              {paying ? "PAYING…" : busy ? "SEATING…" : funded && capped ? "DONE TODAY" : "RANKED →"}
            </span>
            <span className="mt-1 text-[9px] font-black tracking-[0.2em] opacity-75">
              {funded ? `10 OF ${bank!.balance.toFixed(2)} BANKROLL` : addr ? "DEPOSIT 10 tUSDC" : "CONNECT WALLET"}
            </span>
          </button>
        )}
      </div>
      <p className="mt-2 text-[10px] font-bold tracking-wider text-[var(--dim)]">
        {funded ? (
          <>
            RANKED: YOUR BANKROLL PAYS, WINNINGS GO BACK TO IT, AND IT COUNTS ON{" "}
            <a href="/leaders" className="underline decoration-dotted hover:text-[var(--gold)]">THIS WEEK&apos;S BOARDS</a> ·{" "}
            <span className="tabular text-[var(--gold)]">{left}</span> OF {bank!.rankedCap} RANKED SEATS LEFT TODAY ·{" "}
            <a href="/wallet" className="underline decoration-dotted hover:text-[var(--gold)]">BANKROLL</a>
          </>
        ) : addr ? (
          <>
            RANKED FROM <span className="tabular text-[var(--gold)]">{short(addr)}</span>: YOUR tUSDC, YOUR WINNINGS, ON THE
            WEEKLY BOARDS. PRACTICE IS THE HOUSE&apos;S MONEY AND NEVER COUNTS ·{" "}
            <button onClick={onPlayFree} className="underline decoration-dotted hover:text-[var(--gold)]">
              DISCONNECT
            </button>
          </>
        ) : walletReady ? (
          "PRACTICE = THE HOUSE STAKES 10, NOTHING TO LOSE, NOT ON THE BOARDS. RANKED = YOUR tUSDC (FREE TO MINT), YOUR WINNINGS, ON THE WEEKLY BOARDS."
        ) : (
          "NO WALLET IN THIS BROWSER — PRACTICE ONLY. RANKED NEEDS A WALLET; THE TRADE IS REAL AND ON-CHAIN EITHER WAY."
        )}
      </p>
      <p className="mt-1 text-[10px] font-bold tracking-wider text-[var(--dim)]">
        NEW HERE?{" "}
        <a href="/learn" className="text-[var(--gold)] underline decoration-dotted">
          LEARN THE ROPE IN 2-MINUTE LESSONS →
        </a>
      </p>
      {!walletReady && <OpenInWallet />}
    </div>
  );
}

/* ────────────────────────── bell + feed ──────────────────────────── */

function Bell({
  result,
  mine,
  delay = 0,
}: {
  result: NonNullable<TableState["lastResult"]>;
  mine: BellVerdict;
  /** Seconds to hold the overlay back while the wall plays the finish. */
  delay?: number;
}) {
  const c = result.voided ? "var(--gold)" : result.winner === "UP" ? "var(--up)" : "var(--down)";
  return (
    <div
      className="bell pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/92 px-4"
      style={{ ["--bell-delay" as string]: `${delay}s` } as CSSProperties}
    >
      <div className="text-center">
        <p className="text-xs font-bold tracking-[0.5em] text-[var(--dim)]">THE BELL</p>
        <p
          className="display mt-2 text-[2.5rem] leading-[0.9] tracking-tight sm:text-[6rem] sm:leading-[0.85]"
          style={{ color: c, textShadow: `0 0 90px ${c}` }}
        >
          {result.voided ? "NO VERDICT" : result.winner === "UP" ? "▲ ABOVE THE LINE" : "▼ BELOW THE LINE"}
        </p>
        <p className="tabular mt-3 text-sm font-bold tracking-[0.2em] text-[var(--dim)]">
          {result.voided
            ? "NO PRICE AT THE BELL — THE ROUND VOIDED, EVERYONE'S STACK CARRIES"
            : `${markInfo.asset} CLOSED ${
                result.closedBy !== null
                  ? `$${fmtMove(result.closedBy, markInfo.strike)} ${result.closedBy >= 0 ? "OVER" : "UNDER"} THE LINE`
                  : result.winner === "UP" ? "OVER THE LINE" : "UNDER THE LINE"
              } — ${result.winner} RIDERS SURVIVE`}
        </p>
        {result.killed.length > 0 && (
          <p className="display mt-6 text-xl glow-down sm:text-3xl">
            {result.killed.map((k) => `☠ ${k.name}`).join("   ")}
          </p>
        )}
        {result.survived.length > 0 && (
          <p className="tabular mt-3 text-lg font-bold glow-up">
            {result.survived.map((s) => `${s.name} ${s.from.toFixed(2)} → ${s.to.toFixed(2)}`).join("   ")}
          </p>
        )}

        {/* the verdict — what this bell did to YOUR money, in dollars */}
        {mine?.kind === "won" && (
          <div className="mt-8">
            <p className="display text-3xl glow-up sm:text-5xl">
              {/* from/to are dollar stacks, straight from the ledger */}
              YOU WON +{(mine.to - mine.from).toFixed(2)}
            </p>
            <p className="mt-2 text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">
              STACK NOW {mine.to.toFixed(2)} — ALREADY RIDING THE NEXT ROUND · BAIL ANYTIME TO CASH OUT
            </p>
          </div>
        )}
        {mine?.kind === "lost" && (
          <div className="mt-8">
            <p className="display text-3xl glow-down sm:text-5xl">YOU LOST</p>
            <p className="mt-2 text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">
              RUN OVER — ONLY YOUR 10.00 SEAT WAS EVER AT RISK
            </p>
          </div>
        )}
        {mine?.kind === "push" && (
          <div className="mt-8">
            <p className="display text-3xl glow-gold sm:text-5xl">PUSH</p>
            <p className="mt-2 text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">
              THE ORACLE VOIDED THIS ROUND — NOBODY FALLS, YOUR STACK CARRIES
            </p>
          </div>
        )}

        {/* every bell is a settlement on-chain — say where */}
        <p className="mt-8 inline-flex items-center gap-2 text-[9px] font-black tracking-[0.35em] text-[var(--dim)]">
          <ElysiumBadge size={18} />
          {result.voided ? "VOIDED" : "SETTLED"} ON ELYSIUM · ROUND {result.index}
        </p>
      </div>
    </div>
  );
}

function Feed({ state }: { state: TableState | null }) {
  const feed = state?.feed ?? [];
  const record = state?.record;
  if (!feed.length && !record) return null;
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">PAST RUNS</h2>
        {record && (
          <p className="tabular text-[11px] font-bold glow-gold">
            LONGEST RUN · {record.name.toUpperCase()} · {record.rounds}R · {record.multiple.toFixed(2)}×
          </p>
        )}
      </div>
      <div className="space-y-1">
        {feed.slice(0, 6).map((f, i) => (
          <div
            key={`${f.name}-${f.round}-${i}`}
            className="feed-row chamfer-sm flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border border-[var(--edge)] px-4 py-2.5 text-sm"
            style={{ background: "var(--panel)", animationDelay: `${i * 45}ms` }}
          >
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span
                className="text-lg"
                style={{ color: f.kind === "died" ? "var(--down)" : f.kind === "swept" ? "var(--dim)" : "var(--gold)" }}
              >
                {f.kind === "died" ? "☠" : f.kind === "swept" ? "⌁" : "◆"}
              </span>
              <span className="font-bold">{f.name}</span>
              <span className="text-[11px] tracking-wider text-[var(--dim)]">
                {f.kind === "died" ? "FELL AT THE BELL" : f.kind === "swept" ? "SWEPT" : "BAILED"}
              </span>
            </span>
            <span className="tabular ml-auto whitespace-nowrap text-[11px] font-bold text-[var(--dim)]">
              {f.rounds}R · {f.multiple.toFixed(2)}×
              {f.missedBy !== null && (
                <span className="ml-3 glow-down">MISSED BY ${fmtMove(f.missedBy, state?.mark?.strike ?? 100)}</span>
              )}
              {f.payoutTx && (
                <a
                  href={txUrl(f.payoutTx)}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-3 text-[var(--gold)] underline decoration-dotted underline-offset-2"
                >
                  PAID OUT ↗
                </a>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── the money bar ─────────────────────────── */

/**
 * The two numbers that make a player pick again, too big to miss:
 * what is riding right now, and what the game has paid them all time.
 */
function MoneyBar({
  me,
  price,
  ledger,
  walletReady,
  addr,
  funding,
  onConnect,
  onFund,
}: {
  me: TableState["seats"][number] | null;
  price: TableState["price"];
  ledger: LedgerData | null;
  walletReady: boolean;
  addr: Address | null;
  funding: boolean;
  onConnect: () => void;
  onFund: () => void;
}) {
  const mult = useSmoothed(liveMultipleOf(me, price), 340, 3);
  const onWall = me ? mult * me.buyIn : null;
  const delta = me && onWall !== null ? onWall - me.buyIn : null;
  const upC = delta === null || delta >= 0 ? "var(--up)" : "var(--down)";
  const net = ledger?.totals?.net ?? null;
  // The headline is what the wins added up to — never a red minus under a
  // label that says WON. Signed net lives in the corner, honest but small.
  const won = ledger?.totals?.won ?? null;
  const bankBalance = ledger?.bank && ledger.bank.address ? ledger.bank.balance : null;

  /*
   * Nothing to report yet — no seat, no winnings, no bankroll. Two tall cards
   * of em dashes is the emptiest possible use of the best space on the page,
   * so before the first run this collapses to one slim line and gives the
   * height back to the wall.
   */
  // Zero counts as nothing. A player whose ledger row exists but is all zeros
  // (no seat, nothing won, no bankroll) has exactly as little to report as one
  // with no row at all — checking for null alone left them the big empty cards.
  const nothingYet = onWall === null && !won && !bankBalance;
  if (nothingYet) {
    return (
      /*
       * Hidden on a phone. With no run, no bankroll and nothing won, this row
       * only repeats the seat control that is already a few hundred pixels
       * below it — and those ~55px were the difference between the PLAY FREE
       * button being on screen and under the fold. Desktop has the room.
       */
      <div
        className="chamfer-sm mt-3 hidden flex-wrap items-center justify-between gap-2 border px-4 py-2 lg:flex"
        style={{ borderColor: "var(--edge)", background: "linear-gradient(180deg, var(--panel-2), var(--panel))" }}
      >
        <span className="text-[10px] font-black tracking-[0.25em] text-[var(--dim)]">
          TAKE A SEAT TO START A RUN — 10 tUSDC, OR FREE ON THE HOUSE
        </span>
        {walletReady && !addr ? (
          <button
            onClick={onConnect}
            className="chamfer-sm shrink-0 whitespace-nowrap border border-[var(--gold)] px-2.5 py-1.5 text-[9px] font-black tracking-[0.15em] text-[var(--gold)] transition hover:bg-[var(--gold)] hover:text-black"
          >
            CONNECT WALLET
          </button>
        ) : addr ? (
          <button
            onClick={onFund}
            disabled={funding}
            className="chamfer-sm shrink-0 whitespace-nowrap border border-[var(--gold)] px-2.5 py-1.5 text-[9px] font-black tracking-[0.15em] text-[var(--gold)] transition hover:bg-[var(--gold)] hover:text-black disabled:opacity-50"
          >
            {funding ? "FUNDING…" : "DEPOSIT 10"}
          </button>
        ) : (
          <a
            href="/wallet"
            className="chamfer-sm shrink-0 whitespace-nowrap border border-[var(--gold)] px-2.5 py-1.5 text-[9px] font-black tracking-[0.15em] text-[var(--gold)] transition hover:bg-[var(--gold)] hover:text-black"
          >
            GET A WALLET →
          </a>
        )}
      </div>
    );
  }

  // One scoreboard row. Two tall cards were 100px of a short laptop's
  // viewport; the same four facts fit on a line.
  const fund =
    bankBalance === null ? (
      walletReady && !addr ? (
        <button
          onClick={onConnect}
          className="chamfer-sm shrink-0 whitespace-nowrap border border-[var(--gold)] px-2.5 py-1.5 text-[9px] font-black tracking-[0.15em] text-[var(--gold)] transition hover:bg-[var(--gold)] hover:text-black"
        >
          CONNECT WALLET
        </button>
      ) : addr ? (
        <button
          onClick={onFund}
          disabled={funding}
          className="chamfer-sm shrink-0 whitespace-nowrap border border-[var(--gold)] px-2.5 py-1.5 text-[9px] font-black tracking-[0.15em] text-[var(--gold)] transition hover:bg-[var(--gold)] hover:text-black disabled:opacity-50"
        >
          {funding ? "FUNDING…" : "DEPOSIT 10"}
        </button>
      ) : (
        <a
          href="/wallet"
          className="chamfer-sm shrink-0 whitespace-nowrap border border-[var(--gold)] px-2.5 py-1.5 text-[9px] font-black tracking-[0.15em] text-[var(--gold)] transition hover:bg-[var(--gold)] hover:text-black"
        >
          GET A WALLET →
        </a>
      )
    ) : (
      <a
        href="/wallet"
        className="tabular text-[9px] font-bold tracking-[0.2em] underline decoration-dotted"
        style={{ color: net !== null && net < 0 ? "var(--down)" : "var(--dim)" }}
      >
        {net !== null ? `NET ${usd(net)}` : "MANAGE"}
      </a>
    );

  return (
    <div
      className="chamfer-sm mt-3 flex items-center gap-6 border px-4 py-2"
      style={{ borderColor: "var(--edge)", background: "linear-gradient(180deg, var(--panel-2), var(--panel))" }}
    >
      <div className="flex items-baseline gap-3">
        <span className="whitespace-nowrap text-[9px] font-black tracking-[0.3em] text-[var(--dim)]">ON THE WALL</span>
        {me && (
          <span
            className="rounded-sm px-1.5 py-[1px] text-[8px] font-black tracking-[0.2em]"
            style={me.paid
              ? { background: "var(--gold)", color: "#000" }
              : { border: "1px solid var(--edge)", color: "var(--dim)" }}
          >
            {me.paid ? "YOUR tUSDC" : "HOUSE MONEY"}
          </span>
        )}
        <span
          className="display tabular text-3xl leading-none"
          style={onWall !== null ? { color: upC, textShadow: `0 0 34px ${upC}55` } : { color: "var(--dim)" }}
        >
          {onWall !== null ? onWall.toFixed(2) : "—"}
        </span>
        {delta !== null && (
          <span className="tabular whitespace-nowrap text-sm font-black" style={{ color: upC }}>
            THIS RUN {usd(delta)}
          </span>
        )}
      </div>
      <div className="ml-auto flex items-baseline gap-3">
        <span className="whitespace-nowrap text-[9px] font-black tracking-[0.3em] text-[var(--dim)]">
          {bankBalance !== null ? "BANKROLL" : "WON ALL TIME"}
        </span>
        <span
          className="display tabular text-3xl leading-none"
          style={bankBalance !== null
            ? { color: "var(--gold)", textShadow: "0 0 34px var(--gold-glow)" }
            : won !== null ? { color: "var(--up)", textShadow: "0 0 34px var(--up-glow)" } : { color: "var(--dim)" }}
        >
          {bankBalance !== null ? bankBalance.toFixed(2) : won !== null ? `+${won.toFixed(2)}` : "—"}
        </span>
        {fund}
      </div>
    </div>
  );
}

/* ─────────────────────── ledger · leaders · share ─────────────────────── */

/** After a run ends, its card waits under the join box — the trophy moment. */
function LastRun({ ledger, climber }: { ledger: LedgerData | null; climber: ClimberId }) {
  const last = ledger?.runs?.find((r) => r.status !== "alive");
  if (!last) return null;
  const won = last.net >= 0;
  return (
    <section className="mt-4 flex items-center justify-between gap-3 border border-[var(--edge)] px-4 py-3 chamfer-sm" style={{ background: "var(--panel)" }}>
      {/* label over numbers: on one line the run wrapped mid-figure on a phone */}
      <span className="min-w-0">
        <span className="block text-[10px] font-bold tracking-[0.2em] text-[var(--dim)]">YOUR LAST RUN</span>
        <span className="tabular mt-0.5 block whitespace-nowrap text-[13px] font-bold">
          <span style={{ color: won ? "var(--up)" : "var(--down)" }}>
            {last.multiple.toFixed(2)}× · {usd(last.net)}
          </span>
          <span className="text-[var(--dim)]"> · {last.rounds}R</span>
        </span>
      </span>
      <ShareRun runId={last.id} run={last} climber={climber} name={ledger?.name ?? "climber"} daily={ledger?.daily?.runId === last.id} />
    </section>
  );
}

function Footnote({ state }: { state: TableState | null }) {
  return (
    <footer className="mt-10 border-t border-[var(--edge)] pt-4 text-[11px] leading-relaxed text-[var(--dim)]">
      Every round is a binary market on Elysium, Kinetiq&apos;s Hyperliquid L2, struck at the live
      Hyperliquid {state?.mark?.asset ?? "HYPE"} mark at the top of the minute and settled on the mark at the
      bell. The contract quotes both sides from that mark on every trade — fair value plus a 1%
      spread, which is the house vault&apos;s only edge — and you can never lose more than your seat.
      Until Elysium&apos;s HyperCore precompile ships, the mark is relayed by our keeper and every
      relayed price is an on-chain event you can audit.{" "}
      {state?.mark?.oracleQuestionId && (
        <a
          className="underline decoration-dotted underline-offset-2 hover:text-[var(--gold)]"
          href={`${addressUrl(state.pay.market)}?tab=logs`}
          target="_blank"
          rel="noreferrer"
        >
          check every strike and close on-chain
        </a>
      )}
    </footer>
  );
}
