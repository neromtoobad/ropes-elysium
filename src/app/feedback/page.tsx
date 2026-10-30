"use client";

/**
 * The feedback board and the patch notes. Players post bugs and ideas and
 * vote on each other's; the team answers in public, sets a status, and
 * grants points for the useful ones (lib/feedback). Patch notes are the
 * other half of the loop: what came of it.
 *
 * Team controls appear when this browser holds the admin token. Open
 * /feedback#admin=<token> once to store it.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, usePlayerKey, useClimberTheme, safeLocal } from "../shared";
import { PATCH_NOTES } from "@/lib/patchNotes";

type Post = {
  id: string;
  kind: string;
  title: string;
  body: string;
  author: string;
  status: string;
  teamNote: string | null;
  pointsAwarded: number;
  votes: number;
  voted: boolean;
  mine: boolean;
  hidden: boolean;
  at: string;
};

const KINDS = [
  { id: "bug", label: "BUG", color: "var(--down)" },
  { id: "idea", label: "IDEA", color: "var(--gold)" },
  { id: "general", label: "GENERAL", color: "var(--dim)" },
] as const;
const STATUSES = ["open", "confirmed", "planned", "shipped", "closed"] as const;
const STATUS_COLOR: Record<string, string> = { open: "var(--dim)", confirmed: "var(--down)", planned: "var(--gold)", shipped: "var(--up)", closed: "var(--dim)" };

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}M AGO`;
  if (s < 86400) return `${Math.floor(s / 3600)}H AGO`;
  return `${Math.floor(s / 86400)}D AGO`;
};
const date = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase();

async function call(body: object) {
  const r = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "something went wrong");
  return j;
}

export default function Feedback() {
  useClimberTheme();
  const playerKey = usePlayerKey();
  const [tab, setTab] = useState<"board" | "notes">("board");
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [admin, setAdmin] = useState<string | null>(null);
  const [isTeam, setIsTeam] = useState(false);
  const [kind, setKind] = useState<string>("all");
  const [sort, setSort] = useState<"top" | "new">("top");
  const [composing, setComposing] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const h = window.location.hash;
    const m = h.match(/admin=([^&]+)/);
    if (m) {
      safeLocal.set("lc.admin", decodeURIComponent(m[1]));
      history.replaceState(null, "", window.location.pathname);
    } else if (h === "#notes") setTab("notes");
    setAdmin(safeLocal.get("lc.admin"));
  }, []);

  useEffect(() => {
    if (!playerKey) return;
    call({ action: "list", playerKey, admin })
      .then((j) => {
        setPosts(j.posts);
        setIsTeam(Boolean(j.admin));
      })
      .catch(() => {});
  }, [playerKey, admin, refresh]);

  const shown = (posts ?? [])
    .filter((p) => kind === "all" || p.kind === kind)
    .sort((a, b) => (sort === "new" ? b.at.localeCompare(a.at) : b.votes - a.votes || b.at.localeCompare(a.at)));

  const vote = async (id: string) => {
    if (!playerKey) return;
    setPosts((ps) => ps?.map((p) => (p.id === id ? { ...p, voted: !p.voted, votes: p.votes + (p.voted ? -1 : 1) } : p)) ?? null);
    await call({ action: "vote", playerKey, id }).catch(() => setRefresh((n) => n + 1));
  };

  return (
    <main className="relative z-10 mx-auto min-h-screen max-w-5xl px-4 py-4">
      <PageHeader title="FEEDBACK" />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold tracking-[0.3em] text-[var(--gold)]">BUILT IN PUBLIC</p>
          <h2 className="display mt-1 text-3xl leading-none sm:text-4xl">Tell us what&apos;s broken.</h2>
          <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-[var(--dim)]">
            Bugs, ideas, anything. Vote up what matters to you. Bugs we confirm and ideas we ship can earn{" "}
            <Link href="/points" className="font-bold text-[var(--text)] underline decoration-dotted hover:text-[var(--gold)]">ROPES Points</Link>
            , at the team&apos;s call.
          </p>
        </div>
        <div className="flex gap-1" role="tablist">
          {(["board", "notes"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`gametab whitespace-nowrap ${tab === t ? "active" : ""}`}>
              {t === "board" ? "BOARD" : "PATCH NOTES"}
            </button>
          ))}
        </div>
      </div>

      {tab === "notes" ? (
        <Notes />
      ) : (
        <>
          {composing ? (
            <Composer
              playerKey={playerKey}
              onDone={(posted) => {
                setComposing(false);
                if (posted) {
                  setSort("new");
                  setRefresh((n) => n + 1);
                }
              }}
            />
          ) : (
            <button
              onClick={() => setComposing(true)}
              className="chamfer mt-5 w-full border border-dashed border-[var(--gold)] px-5 py-4 text-left transition hover:bg-[color-mix(in_srgb,var(--gold)_8%,transparent)]"
            >
              <span className="display text-lg text-[var(--gold)]">+ NEW POST</span>
              <span className="ml-3 text-[11px] text-[var(--dim)]">Found a bug? Got an idea?</span>
            </button>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {[{ id: "all", label: "ALL" }, ...KINDS].map((k) => (
                <button key={k.id} onClick={() => setKind(k.id)} className={`gametab ${kind === k.id ? "active" : ""}`}>
                  {k.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {(["top", "new"] as const).map((s) => (
                <button key={s} onClick={() => setSort(s)} className={`gametab ${sort === s ? "active" : ""}`}>
                  {s.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {!posts ? (
              <p className="mt-10 text-center text-[11px] font-bold tracking-[0.3em] text-[var(--dim)]">LOADING THE BOARD…</p>
            ) : shown.length === 0 ? (
              <div className="chamfer-sm border border-dashed border-[var(--edge)] px-4 py-8 text-center" style={{ background: "var(--panel)" }}>
                <p className="text-sm font-bold">Nothing here yet.</p>
                <p className="mt-1 text-[11px] text-[var(--dim)]">Be the first to post. Early reports get the most attention.</p>
              </div>
            ) : (
              shown.map((p) => <PostCard key={p.id} post={p} onVote={() => vote(p.id)} admin={isTeam ? admin : null} onChanged={() => setRefresh((n) => n + 1)} />)
            )}
          </div>
        </>
      )}
    </main>
  );
}

function Composer({ playerKey, onDone }: { playerKey: string | null; onDone: (posted: boolean) => void }) {
  const [kind, setKind] = useState<string>("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!playerKey) return;
    setBusy(true);
    setErr(null);
    try {
      await call({ action: "post", playerKey, kind, title, body });
      onDone(true);
    } catch (e) {
      setErr(String(e).replace("Error: ", ""));
    } finally {
      setBusy(false);
    }
  };

  const hint =
    kind === "bug"
      ? "What did you do, what did you expect, what happened instead? Round number, device and wallet help a lot."
      : kind === "idea"
        ? "What would you change, and why would it make ROPES better to play?"
        : "Anything else on your mind.";

  return (
    <div className="chamfer mt-5 border border-[var(--gold)] px-5 py-5" style={{ background: "var(--panel)" }}>
      <div className="flex flex-wrap gap-1">
        {KINDS.map((k) => (
          <button key={k.id} onClick={() => setKind(k.id)} className={`gametab ${kind === k.id ? "active" : ""}`}>
            {k.label}
          </button>
        ))}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 80))}
        placeholder={kind === "bug" ? "Short summary, e.g. Deposit stuck on confirming" : "Short summary"}
        aria-label="title"
        className="chamfer-sm mt-3 w-full border border-[var(--edge)] px-3 py-2 font-bold outline-none focus:border-[var(--gold)]"
        style={{ background: "var(--bg)" }}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 1500))}
        placeholder={hint}
        aria-label="details"
        rows={5}
        className="chamfer-sm mt-2 w-full resize-y border border-[var(--edge)] px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-[var(--gold)]"
        style={{ background: "var(--bg)" }}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[10px] leading-relaxed text-[var(--dim)]">
          Up to 3 posts a day. To be eligible for points, post from a browser that has taken a ranked seat. {body.length}/1500
        </p>
        <div className="flex gap-2">
          <button onClick={() => onDone(false)} className="chamfer-sm border border-[var(--edge)] px-4 py-2 text-[11px] font-black tracking-[0.2em] hover:border-[var(--gold)]">
            CANCEL
          </button>
          <button onClick={submit} disabled={busy || title.trim().length < 4 || body.trim().length < 10} className="chamfer-sm bg-[var(--gold)] px-5 py-2 text-[11px] font-black tracking-[0.2em] text-black transition hover:brightness-110 disabled:opacity-40">
            {busy ? "POSTING…" : "POST"}
          </button>
        </div>
      </div>
      {err && <p className="mt-2 text-[11px] font-bold text-[var(--down)]">{err}</p>}
    </div>
  );
}

function PostCard({ post: p, onVote, admin, onChanged }: { post: Post; onVote: () => void; admin: string | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const k = KINDS.find((x) => x.id === p.kind) ?? KINDS[2];
  const long = p.body.length > 280;
  return (
    <article className="chamfer-sm flex gap-3 border px-4 py-3" style={{ background: "var(--panel)", borderColor: p.mine ? "var(--gold)" : "var(--edge)", opacity: p.hidden ? 0.5 : 1 }}>
      <button
        onClick={onVote}
        aria-pressed={p.voted}
        aria-label={p.voted ? "remove vote" : "vote up"}
        className="chamfer-sm flex h-14 w-12 shrink-0 flex-col items-center justify-center border transition"
        style={{ borderColor: p.voted ? "var(--gold)" : "var(--edge)", color: p.voted ? "var(--gold)" : "var(--text)", background: p.voted ? "color-mix(in srgb, var(--gold) 10%, transparent)" : "transparent" }}
      >
        <span className="text-[11px] leading-none">▲</span>
        <span className="display tabular mt-1 text-base leading-none">{p.votes}</span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] font-black tracking-[0.2em]">
          <span style={{ color: k.color }}>{k.label}</span>
          <span className="rounded-sm border px-1.5 py-0.5" style={{ color: STATUS_COLOR[p.status], borderColor: STATUS_COLOR[p.status] }}>
            {p.status.toUpperCase()}
          </span>
          {p.pointsAwarded > 0 && <span className="text-[var(--gold)]">+{p.pointsAwarded} POINTS</span>}
          {p.mine && <span className="text-[var(--gold)]">YOURS</span>}
          {p.hidden && <span className="text-[var(--down)]">HIDDEN</span>}
        </div>
        <h3 className="mt-1 font-bold leading-snug">{p.title}</h3>
        <p className={`mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[var(--dim)] ${long && !open ? "line-clamp-4" : ""}`}>{p.body}</p>
        {long && (
          <button onClick={() => setOpen((o) => !o)} className="mt-1 text-[10px] font-bold tracking-[0.15em] text-[var(--text)] hover:text-[var(--gold)]">
            {open ? "LESS" : "MORE"}
          </button>
        )}
        <p className="mt-1.5 text-[10px] font-bold tracking-[0.15em] text-[var(--dim)]">
          {p.author} · {ago(p.at)}
        </p>
        {p.teamNote && (
          <div className="mt-2 border-l-2 border-[var(--gold)] pl-3">
            <p className="text-[9px] font-black tracking-[0.2em] text-[var(--gold)]">ROPES TEAM</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed">{p.teamNote}</p>
          </div>
        )}
        {admin && <TeamControls post={p} admin={admin} onChanged={onChanged} />}
      </div>
    </article>
  );
}

function TeamControls({ post: p, admin, onChanged }: { post: Post; admin: string; onChanged: () => void }) {
  const [note, setNote] = useState(p.teamNote ?? "");
  const [award, setAward] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (change: object) => {
    setMsg(null);
    try {
      await call({ action: "moderate", admin, id: p.id, ...change });
      setMsg("SAVED");
      onChanged();
    } catch (e) {
      setMsg(String(e).replace("Error: ", "").toUpperCase());
    }
  };
  const field = "chamfer-sm border border-[var(--edge)] px-2 py-1 text-[11px] outline-none focus:border-[var(--gold)]";
  return (
    <div className="mt-3 space-y-2 border-t border-dashed border-[var(--edge)] pt-2 text-[10px] font-bold tracking-[0.12em]">
      <div className="flex flex-wrap gap-1">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => act({ status: s })} className={`gametab ${p.status === s ? "active" : ""}`}>
            {s.toUpperCase()}
          </button>
        ))}
        <button onClick={() => act({ hidden: !p.hidden })} className="gametab">
          {p.hidden ? "UNHIDE" : "HIDE"}
        </button>
      </div>
      <div className="flex gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Team reply" className={`${field} min-w-0 flex-1`} style={{ background: "var(--bg)" }} />
        <button onClick={() => act({ teamNote: note })} className="gametab">REPLY</button>
      </div>
      <div className="flex gap-2">
        <input value={award} onChange={(e) => setAward(e.target.value.replace(/\D/g, ""))} placeholder="Points" className={`${field} w-24`} style={{ background: "var(--bg)" }} />
        <button
          onClick={() => {
            if (award) act({ award: Number(award) }).then(() => setAward(""));
          }}
          className="gametab"
        >
          GRANT
        </button>
        {msg && <span className="self-center text-[var(--gold)]">{msg}</span>}
      </div>
    </div>
  );
}

function Notes() {
  return (
    <div className="mt-6 space-y-6">
      {PATCH_NOTES.map((n, i) => (
        <section key={n.date} className="grid gap-2 sm:grid-cols-[140px_1fr] sm:gap-6">
          <div>
            <p className="tabular text-[11px] font-bold tracking-[0.2em] text-[var(--dim)]">{date(n.date)}</p>
            {i === 0 && <p className="mt-1 text-[9px] font-black tracking-[0.2em] text-[var(--up)]">LATEST</p>}
          </div>
          <div className="chamfer-sm border border-[var(--edge)] px-5 py-4" style={{ background: "var(--panel)" }}>
            <h3 className="display text-lg">{n.title}</h3>
            <ul className="mt-2 space-y-1.5">
              {n.items.map((it) => (
                <li key={it} className="flex gap-2 text-[13px] leading-relaxed">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--gold)]" />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}
