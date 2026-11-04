"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  askTeam,
  downloadRecords,
  errorText,
  vault,
  type ChatCommand,
  type Finding,
  type InvestigationSource,
  type SearchResult,
  type TeamEvent,
  type TeamHelperId,
} from "@/lib/api";
import { ASK_LABEL, ASSISTANT_NAME, ASSISTANT_POSSESSIVE } from "@/lib/assistant";
import { humanize } from "@/lib/format";
import { helperStates, type HelperState, type VaultTurn } from "@/lib/keeper-turn";
import { KindBadge, mediaLine, NOT_READ_NOTE } from "@/lib/media";
import { useLoad } from "@/lib/use-load";
import { DocumentDrawer } from "../document-drawer";
import { FindingRedline } from "../finding-redline";
import { Loader } from "../loader";
import { useSession } from "../session";
import { TitleBlock } from "../title-block";
import { cx, Skeleton } from "../ui";

// Every card below is drawn from an event the server sent while the work happened: nothing here runs on a timer.
// The one exception is presentation of text that has already arrived (the answer types itself out, once).

// The brain beside the chat is drawn only on wide screens, or when asked for, and loads separately.
const KeeperBrain = dynamic(() => import("../keeper-brain"), {
  ssr: false,
  loading: () => <Skeleton className="h-[420px] w-full" />,
});

type Turn = { id: number; who: "you"; text: string } | VaultTurn;

interface Saved {
  turns: Turn[];
  last: ChatCommand | null;
}

const DEMO_STARTERS = [
  "Which parts have conflicting pressure ratings?",
  "Find drawings for Alpha, newest first",
  "Show the photos",
  "Are my models downloaded?",
];
const STARTERS = ["Which parts have conflicting ratings?", "Find contracts, newest first", "Show the photos", "Are my models downloaded?"];

const storageKey = (collectionId: number) => `vault.chat.${collectionId}`;

function load(collectionId: number): Saved {
  try {
    const raw = sessionStorage.getItem(storageKey(collectionId));
    if (!raw) return { turns: [], last: null };
    const saved = JSON.parse(raw) as Saved;
    // A reply that was still running when the page closed will never finish; say so instead of spinning.
    return {
      last: saved.last ?? null,
      turns: (saved.turns ?? []).map((t) =>
        t.who === "vault"
          ? { ...t, live: false, ...(t.running ? { running: false, error: t.error ?? "Stopped when the page closed." } : {}) }
          : t,
      ),
    };
  } catch {
    return { turns: [], last: null };
  }
}

function save(collectionId: number, value: Saved): void {
  try {
    sessionStorage.setItem(storageKey(collectionId), JSON.stringify(value));
  } catch {
    /* storage full or blocked: the thread lives only in this page */
  }
}

const wideQuery = "(min-width: 1024px)";
const watchWide = (cb: () => void) => {
  const m = window.matchMedia(wideQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const reducedQuery = "(prefers-reduced-motion: reduce)";
const watchReduced = (cb: () => void) => {
  const m = window.matchMedia(reducedQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
export function useReducedMotion(): boolean {
  return useSyncExternalStore(watchReduced, () => window.matchMedia(reducedQuery).matches, () => false);
}

export function ChatView() {
  const { collection } = useSession();
  if (!collection)
    return <TitleBlock href="/chat" title={ASK_LABEL} description={`Ask ${ASSISTANT_NAME} a question or say what to find.`} />;
  return <Ask key={collection.id} collectionId={collection.id} demo={!!collection.is_demo} />;
}

function Ask({ collectionId, demo }: { collectionId: number; demo: boolean }) {
  const [state, setState] = useState<Saved>(() => (typeof window === "undefined" ? { turns: [], last: null } : load(collectionId)));
  // ?q= (from an old /investigate link or the palette) fills the box; ?ask= sends it once.
  const [text, setText] = useState(() => (typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("q") ?? "").slice(0, 300)));
  const [doc, setDoc] = useState<number | null>(null);
  const closeDoc = useCallback(() => setDoc(null), []);
  const memory = useLoad(`keeper-memory:${collectionId}`, () => vault.keeperMemory(collectionId));
  const wide = useSyncExternalStore(watchWide, () => window.matchMedia(wideQuery).matches, () => true);
  const [brainChoice, setBrainChoice] = useState<boolean | null>(null);
  const showBrain = brainChoice ?? wide;
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(state.turns.reduce((m, t) => Math.max(m, t.id), 0) + 1);
  const running = state.turns.some((t) => t.who === "vault" && t.running);
  const latest = [...state.turns].reverse().find((t): t is VaultTurn => t.who === "vault") ?? null;

  useEffect(() => save(collectionId, state), [collectionId, state]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [state.turns]);
  useEffect(() => () => abort.current?.abort(), []);

  const patch = useCallback((id: number, change: (t: VaultTurn) => Partial<VaultTurn>) => {
    setState((s) => ({
      ...s,
      turns: s.turns.map((t) => (t.id === id && t.who === "vault" ? { ...t, ...change(t) } : t)),
    }));
  }, []);

  const lastRef = useRef(state.last);
  lastRef.current = state.last;
  const runningRef = useRef(running);
  runningRef.current = running;
  const reloadMemory = memory.reload;

  const send = useCallback(
    async (message: string) => {
      const m = message.trim().slice(0, 300);
      if (!m || runningRef.current) return;
      runningRef.current = true;
      setText("");
      const you = nextId.current++;
      const me = nextId.current++;
      const previous = lastRef.current;
      setState((s) => ({
        ...s,
        turns: [...s.turns, { id: you, who: "you", text: m }, { id: me, who: "vault", events: [], running: true, live: true }],
      }));
      const controller = new AbortController();
      abort.current = controller;
      try {
        await askTeam(
          collectionId,
          m,
          previous,
          (ev) => {
            patch(me, (t) => ({ events: [...t.events, ev] }));
            if (ev.type === "answer" && ev.kind === "find") setState((s) => ({ ...s, last: ev.command }));
          },
          controller.signal,
        );
        patch(me, () => ({ running: false }));
        reloadMemory();
      } catch (e) {
        patch(me, () => ({ running: false, error: controller.signal.aborted ? "Stopped." : errorText(e) }));
      } finally {
        abort.current = null;
        input.current?.focus();
      }
    },
    [collectionId, patch, reloadMemory],
  );

  // ?ask= sends once, then leaves the address bar clean so a reload does not ask again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ask = params.get("ask");
    if (!params.has("ask") && !params.has("q")) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (ask) window.setTimeout(() => void send(ask), 0);
  }, [send]);

  const vote = async (turn: VaultTurn, run: string, value: -1 | 0 | 1) => {
    const before = turn.vote ?? 0;
    patch(turn.id, () => ({ vote: value }));
    try {
      await vault.voteAnswer(collectionId, run, value);
      reloadMemory();
    } catch {
      patch(turn.id, () => ({ vote: before }));
    }
  };

  const brainToggle = (
    <button
      type="button"
      aria-pressed={showBrain}
      onClick={() => setBrainChoice(!showBrain)}
      className="press flex min-h-9 items-center gap-1.5 rounded-control border border-line px-2.5 text-sm text-muted hover:border-line-strong hover:text-ink"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M4 4.5a1.5 1.5 0 1 0 0-.01M12 3.5a1.5 1.5 0 1 0 0-.01M8 12.5a1.5 1.5 0 1 0 0-.01M5.3 4.7 10.6 3.8M4.7 5.8l2.6 5.4M11.4 5l-2.7 6" />
      </svg>
      {showBrain ? "Hide the brain" : "Show the brain"}
    </button>
  );

  const brain = showBrain ? (
    <KeeperBrain collectionId={collectionId} turn={latest} onOpen={setDoc} />
  ) : null;

  return (
    <>
      {/* Each child of the page animates in, so each is its own layer; this one sits on top for the export menu. */}
      <div className="relative z-20">
      <TitleBlock
        href="/chat"
        title={ASK_LABEL}
        description={`Ask a question or say what to find. ${ASSISTANT_NAME} hands the work to helpers, shows what each one found, and checks every answer against the original page.`}
        actions={
          <>
            <LearnedBadge learned={memory.data?.learned} answers={memory.data?.answers} />
            <ExportMenu collectionId={collectionId} />
            {brainToggle}
          </>
        }
      />
      </div>
      <div className={cx("grid gap-6", showBrain && wide && "grid-cols-[minmax(0,1fr)_minmax(300px,360px)]")}>
        <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col">
          <MachineNote />
          {brain && !wide && <div className="mb-5">{brain}</div>}
          <div aria-live="polite" className="flex min-h-[40dvh] flex-col gap-6 pb-6">
            {state.turns.length === 0 && (
              <div className="flex flex-col items-start gap-4 rounded-card border border-dashed border-line-strong p-5 sm:p-6">
                <svg aria-hidden viewBox="0 0 24 24" className="h-7 w-7 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M2 8V2h6M16 2h6v6M22 16v6h-6M8 22H2v-6" />
                  <path d="M7.5 9h9M7.5 12.5h6" strokeLinecap="round" />
                </svg>
                <p className="display text-[17px] leading-snug">Ask about your documents, or tell {ASSISTANT_NAME} what to find.</p>
                <p className="-mt-2 text-sm text-muted">Try one of these, or type your own.</p>
                <div className="flex flex-wrap gap-1.5">
                  {(demo ? DEMO_STARTERS : STARTERS).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="press rounded-full border border-line px-3 py-1 text-[13px] text-muted hover:border-line-strong hover:text-ink"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {state.turns.map((t) =>
              t.who === "you" ? (
                <p key={t.id} className="ask-fly max-w-[85%] self-end whitespace-pre-wrap break-words rounded-card bg-ink px-3.5 py-2 text-sm text-paper">
                  {t.text}
                </p>
              ) : (
                <KeeperTurn
                  key={t.id}
                  turn={t}
                  collectionId={collectionId}
                  onOpen={setDoc}
                  onSend={send}
                  onVote={(run, v) => vote(t, run, v)}
                />
              ),
            )}
            <div ref={end} />
          </div>

          <form
            className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-paper px-4 pb-4 pt-3 sm:mx-0 sm:rounded-card sm:border sm:px-3 sm:pb-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <Refine last={state.last} disabled={running} onSend={send} />
            <label htmlFor="ask-input" className="sr-only">
              Message
            </label>
            <div className="flex items-end gap-2">
              <textarea
                id="ask-input"
                ref={input}
                rows={1}
                value={text}
                maxLength={300}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(text);
                  }
                }}
                placeholder={state.last ? "Ask, or refine: “only 2024”, “sort by name”" : `Ask ${ASSISTANT_NAME} a question or say what to find`}
                className="max-h-40 min-h-10 min-w-0 flex-1 resize-none rounded-control border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-ink"
              />
              {running ? (
                <button
                  type="button"
                  onClick={() => abort.current?.abort()}
                  className="press min-h-10 rounded-control border border-line-strong px-3.5 text-sm font-medium"
                >
                  Stop
                </button>
              ) : (
                <button type="submit" disabled={!text.trim()} className="press min-h-10 rounded-control bg-ink px-3.5 text-sm font-medium text-paper disabled:opacity-40">
                  Send
                </button>
              )}
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted">
              <span>Enter to send, Shift+Enter for a new line.</span>
              {state.turns.length > 0 && !running && (
                <button
                  type="button"
                  onClick={() => setState({ turns: [], last: null })}
                  className="rounded-control px-1.5 py-0.5 hover:bg-raised hover:text-ink"
                >
                  Clear chat
                </button>
              )}
            </div>
          </form>
        </div>
        {brain && wide && <aside className="min-w-0 self-start lg:sticky lg:top-6">{brain}</aside>}
      </div>
      <DocumentDrawer documentId={doc} onClose={closeDoc} />
    </>
  );
}

// ---------- header pieces ----------

function LearnedBadge({ learned, answers }: { learned: number | undefined; answers: number | undefined }) {
  if (learned === undefined) return null;
  return (
    <span
      data-testid="keeper-learned"
      title={`${answers ?? 0} answers stored in this collection. Rate an answer with thumbs up or down to teach ${ASSISTANT_NAME}.`}
      className="flex min-h-9 items-center gap-1.5 rounded-control border border-line px-2.5 text-sm text-muted"
    >
      <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", learned > 0 ? "bg-green" : "bg-line-strong")} />
      {ASSISTANT_NAME} has learned from <span key={learned} className="learn-bump tabular-nums text-ink">{learned}</span>{" "}
      {learned === 1 ? "answer" : "answers"}
    </span>
  );
}

/** F08.5 (moved from Investigate): the extracted facts as a table, one row per part, each with its file and page. */
function ExportMenu({ collectionId }: { collectionId: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"csv" | "json" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const run = async (format: "csv" | "json") => {
    setBusy(format);
    setMessage(null);
    try {
      await downloadRecords(collectionId, format);
      setMessage(`Downloaded the ${format.toUpperCase()} file.`);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="press flex min-h-9 items-center rounded-control border border-line px-2.5 text-sm text-muted hover:border-line-strong hover:text-ink"
      >
        Export table
      </button>
      {open && (
        <div className="refine-pop absolute right-0 z-30 mt-1.5 w-72 rounded-card border border-line-strong bg-panel p-3 text-sm shadow-lift">
          <p className="mb-2 text-xs text-muted">
            One row per part: document type, project, date, rating, material and quantity, with the file, page and quote each value came from.
          </p>
          <div className="flex gap-2">
            {(["csv", "json"] as const).map((f) => (
              <button
                key={f}
                type="button"
                disabled={busy !== null}
                onClick={() => run(f)}
                className="press rounded-control border border-line-strong px-2.5 py-1 text-[13px] hover:border-ink disabled:opacity-50"
              >
                {busy === f ? "Preparing" : `Download ${f.toUpperCase()}`}
              </button>
            ))}
          </div>
          {message && (
            <p role="status" className="mt-2 text-xs text-muted">
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- the filter row (what Investigate's search form did) ----------

const KINDS = [
  { media: "photo", label: "Photos", ref: "only photos", fresh: "Show the photos" },
  { media: "video", label: "Videos", ref: "only videos", fresh: "Show the videos" },
  { media: "audio", label: "Audio", ref: "only audio", fresh: "Show the audio recordings" },
] as const;
const SORTS = [
  { sort: "date", order: "desc", label: "Newest", ref: "sort newest first", fresh: "Find everything, newest first" },
  { sort: "date", order: "asc", label: "Oldest", ref: "sort oldest first", fresh: "Find everything, oldest first" },
  { sort: "name", order: "asc", label: "A to Z", ref: "sort A to Z", fresh: "Find everything A to Z" },
  { sort: "duration", order: "desc", label: "Longest", ref: "sort longest first", fresh: "Find videos and audio, longest first" },
  { sort: "size", order: "desc", label: "Largest", ref: "sort largest first", fresh: "Find everything, largest first" },
] as const;

/** Each chip sends an ordinary message ("only photos", "sort newest first"), so the thread shows what changed. */
function Refine({ last, disabled, onSend }: { last: ChatCommand | null; disabled: boolean; onSend: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const media = last?.media === "image" ? "photo" : last?.media;
  return (
    <div className="mb-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-control px-1 py-0.5 text-xs text-muted hover:text-ink"
      >
        <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 4h12M4.5 8h7M7 12h2" strokeLinecap="round" />
        </svg>
        Refine: kind of file and order
        {last && (media || last.sort !== "relevance") && (
          <span className="rounded-full border border-line px-1.5 text-[11px]">
            {[media && KINDS.find((k) => k.media === media)?.label, last.sort !== "relevance" && SORTS.find((s) => s.sort === last.sort && s.order === last.order)?.label]
              .filter(Boolean)
              .join(", ")}
          </span>
        )}
      </button>
      {open && (
        <div role="group" aria-label="Refine the list" className="refine-pop mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex flex-wrap items-center gap-1">
            <span className="mr-0.5 text-[11px] font-medium text-muted">Kind</span>
            {KINDS.map((k) => (
              <Chip key={k.media} on={media === k.media} disabled={disabled} onClick={() => onSend(last ? k.ref : k.fresh)}>
                {k.label}
              </Chip>
            ))}
          </span>
          <span className="flex flex-wrap items-center gap-1">
            <span className="mr-0.5 text-[11px] font-medium text-muted">Sort</span>
            {SORTS.map((s) => (
              <Chip
                key={s.label}
                on={!!last && last.sort === s.sort && last.order === s.order}
                disabled={disabled}
                onClick={() => onSend(last ? s.ref : s.fresh)}
              >
                {s.label}
              </Chip>
            ))}
          </span>
          <span className="basis-full text-[11px] text-muted">{NOT_READ_NOTE}</span>
        </div>
      )}
    </div>
  );
}

function Chip({ on, disabled, onClick, children }: { on: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "press rounded-full border px-2.5 py-0.5 text-[12.5px] disabled:opacity-40",
        on ? "border-ink bg-ink text-paper" : "border-line text-muted hover:border-line-strong hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

// ---------- one Keeper reply ----------

type Ev<K extends TeamEvent["type"]> = Extract<TeamEvent, { type: K }>;
const pick = <K extends TeamEvent["type"]>(events: TeamEvent[], type: K) => events.find((e): e is Ev<K> => e.type === type);

function KeeperTurn({
  turn,
  collectionId,
  onOpen,
  onSend,
  onVote,
}: {
  turn: VaultTurn;
  collectionId: number;
  onOpen: (id: number) => void;
  onSend: (m: string) => void;
  onVote: (run: string, v: -1 | 0 | 1) => void;
}) {
  const { events, running, error } = turn;
  const plan = pick(events, "plan");
  const answer = pick(events, "answer");
  const failure = pick(events, "error");
  const done = pick(events, "done");
  const notes = events.filter((e): e is Ev<"coordinator"> => e.type === "coordinator");
  const recalled = events.find((e): e is Extract<TeamEvent, { type: "memory"; status: "recalled" }> => e.type === "memory" && e.status === "recalled");
  const rechecked = events.find((e): e is Extract<TeamEvent, { type: "memory"; status: "rechecked" }> => e.type === "memory" && e.status === "rechecked");
  const helpers = helperStates(events, plan?.helpers ?? []);
  // F10.22: the helpers' work for this reply is recorded under its run id, so the brain can show the same steps.
  const start = pick(events, "start");
  const watch = start?.run && plan?.steps.some((g) => g.some((h) => h === "finder" || h === "sorter")) ? start.run : null;
  const by = answer?.answered_by ? (answer.answered_by.is_ai_model ? answer.answered_by.model : `${ASSISTANT_POSSESSIVE} rules (no model)`) : null;

  return (
    <article className="chat-msg flex flex-col gap-3" aria-label={`${ASSISTANT_POSSESSIVE} reply`} data-live={turn.live ? "1" : undefined}>
      {recalled && <Recall recalled={recalled} rechecked={rechecked} />}
      <HandOff plan={plan} notes={notes} helpers={helpers} running={running && !answer} />
      {answer && <Answer answer={answer} collectionId={collectionId} live={!!turn.live} onOpen={onOpen} onSend={onSend} />}
      {failure && <p className="text-sm text-redline">{failure.detail}</p>}
      {error && <p className="text-sm text-redline">{error}</p>}
      {done && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
          <p>
            {helpers.size} helper{helpers.size === 1 ? "" : "s"} · {(done.duration_ms / 1000).toFixed(done.duration_ms < 1000 ? 2 : 1)} s in all
            {by && <> · written by {by}</>}
            {watch && (
              <>
                {" · "}
                <Link href={`/brain?run=${encodeURIComponent(watch)}`} className="underline underline-offset-4 hover:text-ink">
                  Watch in the 3D brain
                </Link>
              </>
            )}
          </p>
          {answer?.kind === "ask" && answer.run && <Rate value={turn.vote ?? 0} onVote={(v) => onVote(answer.run!, v)} />}
        </div>
      )}
    </article>
  );
}

function Rate({ value, onVote }: { value: -1 | 0 | 1; onVote: (v: -1 | 0 | 1) => void }) {
  const thumb = (up: boolean) => (
    <svg aria-hidden viewBox="0 0 16 16" className={cx("h-3.5 w-3.5", !up && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M5 7v6.5H2.5V7zM5 7l2.5-5c1.3 0 2 .8 1.7 2.2L8.8 6H12.6c.9 0 1.5.8 1.3 1.6l-1.1 4.7c-.2.7-.8 1.2-1.5 1.2H5" />
    </svg>
  );
  return (
    <span className="ml-auto flex items-center gap-1" role="group" aria-label="Rate this answer">
      <span className="mr-0.5">{value === 1 ? `${ASSISTANT_NAME} will remember this` : value === -1 ? `${ASSISTANT_NAME} will not boost these sources` : "Was this right?"}</span>
      {([1, -1] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          aria-label={v === 1 ? "Good answer" : "Wrong answer"}
          onClick={() => onVote(value === v ? 0 : v)}
          className={cx(
            "press grid h-7 w-7 place-items-center rounded-control border",
            value === v ? (v === 1 ? "vote-on border-green text-green" : "vote-on border-redline text-redline") : "border-line hover:border-line-strong hover:text-ink",
          )}
        >
          {thumb(v === 1)}
        </button>
      ))}
    </span>
  );
}

function Recall({
  recalled,
  rechecked,
}: {
  recalled: Extract<TeamEvent, { type: "memory"; status: "recalled" }>;
  rechecked: Extract<TeamEvent, { type: "memory"; status: "rechecked" }> | undefined;
}) {
  const when = new Date(recalled.asked_at * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  return (
    <section aria-label="You asked this before" className="recall-in rounded-card border border-line-strong bg-raised/40 p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 text-green" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.6h2.6M8 5v3.2l2 1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        You asked this before
        <span className="text-xs font-normal text-muted">
          {when}, marked as a good answer: “{recalled.question}”
        </span>
      </p>
      <p className="mt-1.5 text-[14px] leading-relaxed">{recalled.text}</p>
      <p className="mt-1.5 text-xs text-muted" role="status">
        {!rechecked ? (
          <Loader size={12} label="Checking it again against the documents as they are now" />
        ) : rechecked.still_cited === rechecked.total ? (
          <span className="text-green">
            Still true: all {rechecked.total} source document{rechecked.total === 1 ? "" : "s"} are cited again in today&apos;s answer below.
          </span>
        ) : (
          <span className="text-amber">
            The documents changed: {rechecked.still_cited} of {rechecked.total} earlier sources are cited today. Trust the new answer below.
          </span>
        )}
      </p>
    </section>
  );
}

function HandOff({
  plan,
  notes,
  helpers,
  running,
}: {
  plan: Ev<"plan"> | undefined;
  notes: Ev<"coordinator">[];
  helpers: Map<TeamHelperId, HelperState>;
  running: boolean;
}) {
  const asking = notes.find((n) => n.status === "asking_model");
  return (
    <section aria-label="Who did the work" className="rounded-card border border-line bg-panel p-3 shadow-panel">
      <div className="flex items-start gap-2.5">
        <span aria-hidden className={cx("mt-1 h-2 w-2 shrink-0 rounded-full", plan ? "bg-green" : "live-dot bg-green")} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{ASSISTANT_NAME}</p>
          {!plan ? (
            <div className="mt-0.5">
              <Loader className="text-xs" size={13} label={asking ? asking.text : "Reading your message"} />
              {/* The thinking trace: shown only until the real plan event arrives. */}
              <svg aria-hidden viewBox="0 0 240 14" className="think-trace mt-1.5 h-3.5 w-full max-w-[240px] text-green" preserveAspectRatio="none">
                <path d="M0 7 H40 l6 -5 6 10 6 -10 6 5 H120 l5 -4 5 8 5 -8 5 4 H240" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </div>
          ) : (
            <p className="plan-in text-xs text-muted">
              {plan.reason} Planned by {plan.source === "model" ? plan.model : `${ASSISTANT_POSSESSIVE} rules`} in {plan.duration_ms} ms.
              {plan.parallel_note && <> {plan.parallel_note}</>}
            </p>
          )}
          {notes
            .filter((n) => n.status === "fallback")
            .map((n) => (
              <p key={n.t_ms} className="text-xs text-amber">
                {n.text}
                {n.duration_ms !== undefined && ` (checking took ${n.duration_ms} ms)`}
              </p>
            ))}
        </div>
      </div>
      {plan && plan.steps.length > 0 && (
        <ol className="ml-[3px] mt-2 flex flex-col gap-2">
          {plan.steps.map((group, i) => {
            const states = group.map((id) => helpers.get(id)).filter((h): h is HelperState => !!h);
            const started = states.filter((h) => h.status !== "waiting");
            const finished = states.length > 0 && states.every((h) => h.status === "finished" || h.status === "failed");
            return (
              <li key={i} className="handoff-step relative flex flex-col gap-1.5 pl-4" data-state={finished ? "done" : started.length ? "live" : "wait"}>
                {/* The line from Keeper to this step. A pulse runs down it when a helper's real "started" event arrives. */}
                <span aria-hidden className="absolute bottom-0 left-0 top-0 w-px bg-line-strong" />
                {started.length > 0 && <span aria-hidden key={`p-${started[0].started_ms}`} className="handoff-pulse" />}
                {group.length > 1 && <span className="text-[11px] font-medium text-muted">At the same time</span>}
                <div className={cx("grid gap-2", group.length > 1 && "sm:grid-cols-2")}>
                  {states.map((h) => (
                    <HelperCard key={h.plan.id} h={h} />
                  ))}
                </div>
                {i === 0 &&
                  notes
                    .filter((n) => n.status === "merged")
                    .map((n) => (
                      <p key={n.t_ms} className="chat-row text-xs text-muted">
                        {ASSISTANT_NAME}: {n.text} ({n.duration_ms} ms).
                      </p>
                    ))}
              </li>
            );
          })}
        </ol>
      )}
      {plan && plan.steps.length === 0 && !running && <p className="mt-1 pl-[18px] text-xs text-muted">No helpers needed.</p>}
    </section>
  );
}

function HelperCard({ h }: { h: HelperState }) {
  const [open, setOpen] = useState(false);
  const last = h.progress[h.progress.length - 1];
  return (
    <div
      data-helper={h.plan.id}
      data-status={h.status}
      className={cx(
        "min-w-0 rounded-control border transition-colors",
        h.status === "waiting" && "border-dashed border-line text-muted",
        h.status === "running" && "helper-lit helper-run border-green/60",
        h.status === "finished" && "helper-lit border-line-strong",
        h.status === "failed" && "border-redline/60",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-raised"
      >
        <StatusMark status={h.status} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[13px] font-medium text-ink">{h.plan.name}</span>
            {h.plan.uses_model && <span className="text-[11px] text-muted">uses the model</span>}
            {h.duration_ms !== undefined && <span className="ml-auto font-mono text-[11px] tabular-nums text-muted">{h.duration_ms} ms</span>}
          </span>
          <span className="block break-words text-xs text-muted">
            {h.status === "waiting" && h.plan.does}
            {h.status === "running" && (last ?? "Working")}
            {h.status === "finished" && h.summary}
            {h.status === "failed" && <span className="text-redline">{h.detail}</span>}
          </span>
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-2.5 py-2 text-xs text-muted">
          <p>
            <span className="text-ink">{h.plan.does}</span>, because {h.plan.why}.
          </p>
          {h.thread && (
            <p className="mt-1">
              Ran on thread <span className="font-mono">{h.thread}</span>.
            </p>
          )}
          {h.progress.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {h.progress.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
          {h.result && <ResultDetail result={h.result} />}
        </div>
      )}
    </div>
  );
}

function StatusMark({ status }: { status: HelperState["status"] }) {
  if (status === "running") return <Loader size={13} className="mt-0.5" />;
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={cx("mt-0.5 h-[13px] w-[13px] shrink-0", status === "finished" ? "text-green" : status === "failed" ? "text-redline" : "text-line-strong")}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {status === "finished" && <path className="tick-draw" d="m3 8.5 3.2 3L13 4.5" />}
      {status === "failed" && <path d="M4 4l8 8M12 4l-8 8" />}
      {status === "waiting" && <circle cx="8" cy="8" r="5" />}
    </svg>
  );
}

type Row = Record<string, unknown>;

/** What a helper handed back, in words: file names, conflicts, checks, models or a page. */
function ResultDetail({ result }: { result: Record<string, unknown> }) {
  const list = (key: string) => (Array.isArray(result[key]) ? (result[key] as Row[]) : []);
  const docs = [...list("documents"), ...list("first")];
  const findings = list("findings");
  const sentences = list("sentences");
  const models = list("models");
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {docs.length > 0 && (
        <ul className="flex flex-col">
          {docs.map((d, i) => (
            <li key={i} className="truncate font-mono text-[11.5px]">
              {String(d.filename)}
              {d.page ? ` p.${d.page}` : ""}
              {d.doc_date ? ` · ${d.doc_date}` : ""}
            </li>
          ))}
        </ul>
      )}
      {typeof result.count === "number" && docs.length > 0 && result.count > docs.length && <p>and {result.count - docs.length} more.</p>}
      {findings.map((f) => (
        <p key={String(f.id)}>{String(f.summary)}</p>
      ))}
      {sentences.map((s) => (
        <p key={String(s.sentence)}>
          Sentence {String(s.sentence)}:{" "}
          {s.verified ? (
            <span className="text-green">every number found in its sources</span>
          ) : Array.isArray(s.unsupported_numbers) && s.unsupported_numbers.length ? (
            <span className="text-redline">not in the sources: {s.unsupported_numbers.join(", ")}</span>
          ) : (
            "no source cited, shown as interpretation"
          )}
        </p>
      ))}
      {models.map((m) => (
        <p key={String(m.name)} className="font-mono text-[11.5px]">
          {String(m.name)} · {String(m.size_gb)} GB{m.loaded ? " · loaded" : ""}
        </p>
      ))}
      {typeof result.route === "string" && <p className="font-mono text-[11.5px]">{result.route}</p>}
      {typeof result.by === "string" && <p>Written by {result.by}.</p>}
    </div>
  );
}

// ---------- the answer ----------

const WORD_MS = 28;
const MAX_STREAM_MS = 1400;

/** How many words of the answer are showing. Live replies type out once; restored ones show whole. */
function useStream(total: number, live: boolean): number {
  const reduced = useReducedMotion();
  const animate = live && !reduced && total > 0;
  const [shown, setShown] = useState(animate ? 0 : total);
  useEffect(() => {
    if (!animate) return;
    const step = Math.max(1, Math.ceil((total * WORD_MS) / MAX_STREAM_MS));
    const timer = window.setInterval(() => {
      setShown((n) => {
        const next = Math.min(total, n + step);
        if (next >= total) window.clearInterval(timer);
        return next;
      });
    }, WORD_MS);
    return () => window.clearInterval(timer);
  }, [animate, total]);
  return animate ? shown : total;
}

function Answer({
  answer,
  collectionId,
  live,
  onOpen,
  onSend,
}: {
  answer: Ev<"answer">;
  collectionId: number;
  live: boolean;
  onOpen: (id: number) => void;
  onSend: (m: string) => void;
}) {
  const sources = useMemo(() => answer.sources ?? [], [answer.sources]);
  const byId = new Map<number, InvestigationSource>(sources.map((s) => [s.id, s]));
  const sentences = useMemo(() => (answer.kind === "ask" ? (answer.sentences ?? []) : []), [answer.kind, answer.sentences]);
  // Each piece's words, and where it starts in the whole answer, so the typing can run across sentences.
  const { pieces, starts, totalWords } = useMemo(() => {
    const p = sentences.length ? sentences.map((s) => s.text.split(/(\s+)/)) : [answer.text.split(/(\s+)/)];
    const st: number[] = [];
    let n = 0;
    for (const part of p) {
      st.push(n);
      n += part.length;
    }
    return { pieces: p, starts: st, totalWords: n };
  }, [sentences, answer.text]);
  const shown = useStream(totalWords, live);
  const streamed = shown >= totalWords;
  const take = (i: number) => {
    const left = shown - starts[i];
    return { out: pieces[i].slice(0, Math.max(0, left)).join(""), whole: left >= pieces[i].length };
  };
  const findingIds = new Set((answer.findings ?? []).map((f) => f.id));
  // When a live answer arrives, bring its first line into view; the evidence cards then grow below it.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) box.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [live]);

  return (
    <div ref={box} className="scroll-mt-24 flex flex-col gap-3 text-[14.5px] leading-relaxed">
      {sentences.length > 0 ? (
        <ul className="flex flex-col gap-1.5" data-testid="keeper-answer">
          {sentences.map((s, i) => {
            const { out, whole } = take(i);
            if (!out && !whole) return null;
            return (
              <li key={i} className={cx(!s.verified && "text-muted")}>
                {out}
                {whole &&
                  s.sources.map((n, j) => {
                    const src = byId.get(n);
                    return (
                      <button
                        key={n}
                        type="button"
                        title={src ? `${src.filename}: ${src.quote}` : undefined}
                        aria-label={src ? `Source ${n}: ${src.filename}` : `Source ${n}`}
                        onClick={() => src && onOpen(src.document_id)}
                        style={{ animationDelay: `${j * 70}ms` }}
                        className="cite-pop mx-0.5 inline-flex min-w-5 items-center justify-center gap-0.5 rounded-[4px] border border-line-strong px-1 align-[2px] font-mono text-[11px] text-muted hover:border-ink hover:text-ink"
                      >
                        {n}
                        {s.verified && (
                          <svg aria-hidden viewBox="0 0 16 16" className="h-2.5 w-2.5 text-green" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path className="tick-draw tick-late" d="m3 8.5 3.2 3L13 4.5" style={{ animationDelay: `${180 + j * 70}ms` }} />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                {whole && s.unsupported_numbers.length > 0 && <span className="ml-1 text-xs text-redline">(not in the sources: {s.unsupported_numbers.join(", ")})</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p data-testid="keeper-answer">{take(0).out}</p>
      )}

      {streamed && answer.kind === "ask" && sentences.length > 0 && (
        <p className="result-in text-xs text-muted">
          <svg aria-hidden viewBox="0 0 16 16" className="mr-1 inline h-3 w-3 text-green" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 8.5 3.2 3L13 4.5" />
          </svg>
          Fact checker: {sentences.filter((s) => s.verified).length} of {sentences.filter((s) => s.kind === "cited").length} cited sentences verified against their quotes.
        </p>
      )}

      {streamed && findingIds.size > 0 && <FindingCards collectionId={collectionId} ids={findingIds} onOpen={onOpen} />}

      {streamed && sources.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Sources</p>
          <ol className="flex flex-wrap gap-1.5">
            {sources.map((s, i) => (
              <li key={s.id} className="result-in min-w-0 max-w-full" style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
                <button
                  type="button"
                  data-source={s.id}
                  onClick={() => onOpen(s.document_id)}
                  title={s.quote}
                  className="press flex max-w-full items-center gap-1.5 rounded-control border border-line px-2 py-1 text-left hover:border-ink"
                >
                  <span className="font-mono text-[11px] text-muted">{s.id}</span>
                  <span className="truncate font-mono text-[12px]">{s.filename}</span>
                  {s.page ? <span className="shrink-0 text-[11px] text-muted">p.{s.page}</span> : null}
                </button>
              </li>
            ))}
          </ol>
          {answer.withheld_local_only ? (
            <p className="mt-1 text-xs text-muted">{answer.withheld_local_only} lines from local-only documents were kept back from the remote model.</p>
          ) : null}
        </div>
      )}

      {streamed && answer.rows && answer.rows.length > 0 && (
        <ul className="overflow-hidden rounded-card border border-line bg-panel" data-testid="keeper-results">
          {answer.rows.map((r, i) => (
            <ResultRow key={`${r.document_id}-${r.page}`} r={r} i={i} onOpen={onOpen} onSend={onSend} />
          ))}
          {answer.count !== undefined && answer.count > answer.rows.length && (
            <li className="px-3 py-1.5 text-xs text-muted">
              Showing the first {answer.rows.length} of {answer.count}. Refine to narrow it down.
            </li>
          )}
        </ul>
      )}

      {answer.models && answer.models.length > 0 && (
        <ul className="flex flex-col gap-1">
          {answer.models.map((m) => (
            <li key={m.name} className="flex flex-wrap items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green" />
              <span className="font-mono text-[12.5px]">{m.name}</span>
              <span className="text-xs text-muted">
                {m.size_gb} GB{m.used_by_vault ? ", VAULT uses it" : ""}
                {m.loaded ? ", loaded now" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {answer.kind === "open" && answer.route && (
        <Link href={answer.route} className="press self-start rounded-control bg-ink px-3.5 py-1.5 text-sm font-medium text-paper">
          Go to {answer.text.replace(/^Open |\.$/g, "")}
        </Link>
      )}
    </div>
  );
}

/** The conflicts the answer cites, drawn as Investigate drew them: values side by side, the differing number in red. */
function FindingCards({ collectionId, ids, onOpen }: { collectionId: number; ids: Set<number>; onOpen: (id: number) => void }) {
  const all = useLoad(`findings:${collectionId}`, () => vault.findings(collectionId));
  const shown: Finding[] = (all.data ?? []).filter((f) => ids.has(f.id));
  if (!all.data) return <Skeleton className="h-24 w-full" />;
  return (
    <div className="flex flex-col gap-3" data-testid="keeper-findings">
      {shown.map((f, i) => (
        <div key={f.id} className="result-in" style={{ animationDelay: `${i * 90}ms` }}>
          <FindingRedline finding={f} onOpenDocument={onOpen} />
        </div>
      ))}
    </div>
  );
}

function Snippet({ text }: { text: string }) {
  const parts = text.split(/\[\[(.*?)\]\]/g);
  return (
    <p className="mt-0.5 line-clamp-2 whitespace-pre-line break-words font-mono text-[12px] leading-relaxed text-ink/80">
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </p>
  );
}

function ResultRow({ r, i, onOpen, onSend }: { r: SearchResult; i: number; onOpen: (id: number) => void; onSend: (m: string) => void }) {
  const media = r.kind && r.kind !== "document";
  return (
    <li className="result-in border-b border-line last:border-b-0" style={{ animationDelay: `${Math.min(i, 14) * 40}ms` }}>
      <button type="button" onClick={() => onOpen(r.document_id)} className="flex w-full min-w-0 items-start gap-2.5 px-3 py-2 text-left hover:bg-raised">
        <span aria-hidden className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-control border border-line text-muted">
          <KindIcon kind={r.kind} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1">
            <KindBadge kind={r.kind} />
            <span className="truncate font-mono text-[12.5px] font-medium">{r.filename}</span>
            {r.page != null && <span className="ml-auto shrink-0 text-[11px] text-muted">p.{r.page}</span>}
          </span>
          <span className="block truncate text-xs text-muted">
            {media ? mediaLine(r.media_info, r.kind) : [humanize(r.doc_type), r.project && `project ${r.project}`, r.doc_date].filter(Boolean).join(" · ")}
          </span>
          {r.snippet && <Snippet text={r.snippet.trim()} />}
        </span>
      </button>
      {r.part_numbers.length > 0 && (
        <div className="-mt-1 flex flex-wrap gap-1 px-3 pb-2 pl-[52px]">
          {r.part_numbers.slice(0, 6).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onSend(`find ${p}`)}
              className="rounded-control border border-line px-1.5 font-mono text-[11px] text-muted hover:border-ink hover:text-ink"
              title={`Find ${p}`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function KindIcon({ kind }: { kind: SearchResult["kind"] }) {
  const d =
    kind === "photo"
      ? "M2.5 4h11v8.5h-11zM2.5 10.5l3-3 2.5 2.5 2-2 3.5 3.5M10.5 6.5h.01"
      : kind === "video"
        ? "M2.5 4h8v8h-8zM10.5 7l3-2v6l-3-2"
        : kind === "audio"
          ? "M3 6.5v3M5.5 4.5v7M8 3v10M10.5 5v6M13 7v2"
          : "M4 2h5.5L12 4.5V14H4zM9.5 2v2.5H12M6 8h4M6 10.5h4";
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round">
      <path d={d} />
    </svg>
  );
}

// ---------- what this computer can run ----------

/** Read from /system/hardware and /system/local-models; nothing here is typed in by hand. */
function MachineNote() {
  const hw = useLoad("hardware", vault.hardware);
  const lm = useLoad("localModels", vault.localModels);
  const [open, setOpen] = useState(false);
  if (!hw.data && !lm.data) return null;
  const active = lm.data?.models.find((m) => m.used_by_vault);
  const gpu = hw.data?.gpus[0];
  const parts = [
    gpu ? `${gpu.name}${gpu.memory_mb ? `, ${(gpu.memory_mb / 1024).toFixed(0)} GB` : ""}` : "no graphics card found",
    hw.data ? `${(hw.data.ram_total_mb / 1024).toFixed(0)} GB memory` : null,
  ].filter(Boolean);
  return (
    <section aria-label="What this computer can run" className="mb-5 rounded-card border border-line px-3 py-2 text-xs text-muted">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-x-2 text-left">
        <span className="font-medium text-ink">This computer</span>
        <span className="min-w-0 flex-1 truncate">
          {parts.join(" · ")}
          {lm.data && (active ? ` · ${active.name}${active.loaded ? " loaded" : " ready"}` : lm.data.reachable ? " · VAULT's model is not downloaded" : " · Ollama is not running")}
        </span>
        <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
          {hw.data && (
            <p>
              {hw.data.cpu_model}, {hw.data.logical_cores} threads. {(hw.data.ram_available_mb / 1024).toFixed(1)} GB of{" "}
              {(hw.data.ram_total_mb / 1024).toFixed(0)} GB memory free.
            </p>
          )}
          {active && (
            <p>
              {active.name}
              {active.parameters ? ` (${active.parameters}${active.quantization ? `, ${active.quantization}` : ""})` : ""} needs about {active.memory_gb} GB.{" "}
              {active.copies_on_gpu > 0 ? "It fits in graphics memory." : "It does not fit in graphics memory, so it runs slower from main memory."}{" "}
              {active.loaded ? "It is loaded now." : "Ollama loads it on the first question."}
            </p>
          )}
          <p>
            Only the Answer writer (and planning, when the rules do not understand a message) uses the model. Finder, Sorter, Conflict
            checker, Fact checker, Models helper and Navigator are plain code. Helpers share one loaded copy of the model.
          </p>
          <Link href="/models" className="self-start text-ink underline underline-offset-4">
            Models page
          </Link>
        </div>
      )}
    </section>
  );
}
