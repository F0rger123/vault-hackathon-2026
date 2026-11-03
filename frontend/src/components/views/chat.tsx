"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  askTeam,
  errorText,
  vault,
  type ChatCommand,
  type InvestigationSource,
  type TeamEvent,
  type TeamHelperId,
  type TeamHelperPlan,
} from "@/lib/api";
import { humanize } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { DocumentDrawer } from "../document-drawer";
import { Loader } from "../loader";
import { useSession } from "../session";
import { TitleBlock } from "../title-block";
import { cx } from "../ui";

// Every card below is drawn from an event the server sent while the work happened: nothing here runs on a timer.

type Turn =
  | { id: number; who: "you"; text: string }
  | { id: number; who: "vault"; events: TeamEvent[]; running: boolean; error?: string };

interface Saved {
  turns: Turn[];
  last: ChatCommand | null;
}

const DEMO_STARTERS = [
  "Which parts have conflicting pressure ratings?",
  "Find drawings for Alpha, newest first",
  "Are my models downloaded?",
  "Open approvals",
];
const STARTERS = [
  "Which parts have conflicting ratings?",
  "Find contracts, newest first",
  "Are my models downloaded?",
  "Open approvals",
];

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
        t.who === "vault" && t.running ? { ...t, running: false, error: t.error ?? "Stopped when the page closed." } : t,
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

export function ChatView() {
  const { collection } = useSession();
  return (
    <>
      <TitleBlock
        href="/chat"
        title="Ask VAULT"
        description="Ask a question or say what to find. The coordinator hands the work to helpers, and you can watch each one."
      />
      {collection ? <Thread key={collection.id} collectionId={collection.id} demo={!!collection.is_demo} /> : null}
    </>
  );
}

function Thread({ collectionId, demo }: { collectionId: number; demo: boolean }) {
  const [state, setState] = useState<Saved>(() => (typeof window === "undefined" ? { turns: [], last: null } : load(collectionId)));
  const [text, setText] = useState("");
  const [doc, setDoc] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(state.turns.reduce((m, t) => Math.max(m, t.id), 0) + 1);
  const running = state.turns.some((t) => t.who === "vault" && t.running);

  useEffect(() => save(collectionId, state), [collectionId, state]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [state.turns]);
  useEffect(() => () => abort.current?.abort(), []);

  const patch = useCallback((id: number, change: (t: Extract<Turn, { who: "vault" }>) => Partial<Extract<Turn, { who: "vault" }>>) => {
    setState((s) => ({
      ...s,
      turns: s.turns.map((t) => (t.id === id && t.who === "vault" ? { ...t, ...change(t) } : t)),
    }));
  }, []);

  const send = async (message: string) => {
    const m = message.trim();
    if (!m || running) return;
    setText("");
    const you = nextId.current++;
    const me = nextId.current++;
    const previous = state.last;
    setState((s) => ({ ...s, turns: [...s.turns, { id: you, who: "you", text: m }, { id: me, who: "vault", events: [], running: true }] }));
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
    } catch (e) {
      patch(me, () => ({ running: false, error: controller.signal.aborted ? "Stopped." : errorText(e) }));
    } finally {
      abort.current = null;
      input.current?.focus();
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <MachineNote />
      <div aria-live="polite" className="flex min-h-[40dvh] flex-col gap-6 pb-6">
        {state.turns.length === 0 && (
          <div className="flex flex-col items-start gap-4 rounded-card border border-dashed border-line-strong p-5 sm:p-6">
            <svg aria-hidden viewBox="0 0 24 24" className="h-7 w-7 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M2 8V2h6M16 2h6v6M22 16v6h-6M8 22H2v-6" />
              <path d="M7.5 9h9M7.5 12.5h6" strokeLinecap="round" />
            </svg>
            <p className="display text-[17px] leading-snug">Ask about your documents, or tell VAULT what to find.</p>
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
            <p key={t.id} className="chat-msg max-w-[85%] self-end whitespace-pre-wrap break-words rounded-card bg-ink px-3.5 py-2 text-sm text-paper">
              {t.text}
            </p>
          ) : (
            <VaultTurn key={t.id} turn={t} onOpen={setDoc} />
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
            placeholder={state.last ? "Ask, or refine: “only 2024”, “sort by name”" : "Ask a question or say what to find"}
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
      <DocumentDrawer documentId={doc} onClose={() => setDoc(null)} />
    </div>
  );
}

// ---------- one VAULT reply ----------

interface HelperState {
  plan: TeamHelperPlan;
  status: "waiting" | "running" | "finished" | "failed";
  thread?: string;
  progress: string[];
  duration_ms?: number;
  summary?: string;
  result?: Record<string, unknown>;
  detail?: string;
}

function helperStates(events: TeamEvent[], helpers: TeamHelperPlan[]): Map<TeamHelperId, HelperState> {
  const out = new Map<TeamHelperId, HelperState>(helpers.map((h) => [h.id, { plan: h, status: "waiting", progress: [] }]));
  for (const ev of events) {
    if (ev.type !== "helper") continue;
    const h = out.get(ev.id);
    if (!h) continue;
    if (ev.status === "started") Object.assign(h, { status: "running", thread: ev.thread });
    else if (ev.status === "progress" && ev.text) h.progress.push(ev.text);
    else if (ev.status === "finished") Object.assign(h, { status: "finished", duration_ms: ev.duration_ms, summary: ev.summary, result: ev.result });
    else if (ev.status === "failed") Object.assign(h, { status: "failed", duration_ms: ev.duration_ms, detail: ev.detail });
  }
  return out;
}

function VaultTurn({ turn, onOpen }: { turn: Extract<Turn, { who: "vault" }>; onOpen: (id: number) => void }) {
  const { events, running, error } = turn;
  const plan = events.find((e): e is Extract<TeamEvent, { type: "plan" }> => e.type === "plan");
  const answer = events.find((e): e is Extract<TeamEvent, { type: "answer" }> => e.type === "answer");
  const failure = events.find((e): e is Extract<TeamEvent, { type: "error" }> => e.type === "error");
  const done = events.find((e): e is Extract<TeamEvent, { type: "done" }> => e.type === "done");
  const notes = events.filter((e): e is Extract<TeamEvent, { type: "coordinator" }> => e.type === "coordinator");
  const helpers = helperStates(events, plan?.helpers ?? []);

  return (
    <article className="chat-msg flex flex-col gap-3" aria-label="VAULT's reply">
      <HandOff plan={plan} notes={notes} helpers={helpers} running={running && !answer} />
      {answer && <Answer answer={answer} onOpen={onOpen} />}
      {failure && <p className="text-sm text-redline">{failure.detail}</p>}
      {error && <p className="text-sm text-redline">{error}</p>}
      {done && (
        <p className="text-xs text-muted">
          {helpers.size} helper{helpers.size === 1 ? "" : "s"} · {(done.duration_ms / 1000).toFixed(done.duration_ms < 1000 ? 2 : 1)} s in all
          {answer?.answered_by && <> · written by {answer.answered_by.is_ai_model ? answer.answered_by.model : "VAULT's rules (no model)"}</>}
        </p>
      )}
    </article>
  );
}

function HandOff({
  plan,
  notes,
  helpers,
  running,
}: {
  plan: Extract<TeamEvent, { type: "plan" }> | undefined;
  notes: Extract<TeamEvent, { type: "coordinator" }>[];
  helpers: Map<TeamHelperId, HelperState>;
  running: boolean;
}) {
  const asking = notes.find((n) => n.status === "asking_model");
  return (
    <section aria-label="Who did the work" className="rounded-card border border-line bg-panel p-3 shadow-panel">
      <div className="flex items-start gap-2.5">
        <span aria-hidden className={cx("mt-1 h-2 w-2 shrink-0 rounded-full", plan ? "bg-green" : "live-dot bg-green")} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Coordinator</p>
          {!plan ? (
            <Loader className="mt-0.5 text-xs" size={13} label={asking ? asking.text : "Reading your message"} />
          ) : (
            <p className="text-xs text-muted">
              {plan.reason} Planned by {plan.source === "model" ? plan.model : "VAULT's rules"} in {plan.duration_ms} ms.
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
        <ol className="ml-[3px] mt-2 flex flex-col gap-2 border-l border-line-strong pl-4">
          {plan.steps.map((group, i) => (
            <li key={i} className="flex flex-col gap-1.5">
              {group.length > 1 && <span className="text-[11px] font-medium text-muted">At the same time</span>}
              <div className={cx("grid gap-2", group.length > 1 && "sm:grid-cols-2")}>
                {group.map((id) => {
                  const h = helpers.get(id);
                  return h ? <HelperCard key={id} h={h} /> : null;
                })}
              </div>
              {i === 0 && notes.filter((n) => n.status === "merged").map((n) => (
                <p key={n.t_ms} className="chat-row text-xs text-muted">
                  Coordinator: {n.text} ({n.duration_ms} ms).
                </p>
              ))}
            </li>
          ))}
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
        h.status === "running" && "helper-lit border-green/60",
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
          {h.thread && <p className="mt-1">Ran on thread <span className="font-mono">{h.thread}</span>.</p>}
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
    <svg aria-hidden viewBox="0 0 16 16" className={cx("mt-0.5 h-[13px] w-[13px] shrink-0", status === "finished" ? "text-green" : status === "failed" ? "text-redline" : "text-line-strong")} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {status === "finished" && <path d="m3 8.5 3.2 3L13 4.5" />}
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

function Answer({ answer, onOpen }: { answer: Extract<TeamEvent, { type: "answer" }>; onOpen: (id: number) => void }) {
  const sources = answer.sources ?? [];
  const byId = new Map<number, InvestigationSource>(sources.map((s) => [s.id, s]));
  return (
    <div className="flex flex-col gap-3 text-[14.5px] leading-relaxed">
      {answer.kind === "ask" && answer.sentences && answer.sentences.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {answer.sentences.map((s, i) => (
            <li key={i} className={cx("chat-row", !s.verified && "text-muted")} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
              {s.text}
              {s.sources.map((n) => {
                const src = byId.get(n);
                return (
                  <button
                    key={n}
                    type="button"
                    title={src ? `${src.filename}: ${src.quote}` : undefined}
                    aria-label={src ? `Source ${n}: ${src.filename}` : `Source ${n}`}
                    onClick={() => src && onOpen(src.document_id)}
                    className="mx-0.5 inline-grid min-w-5 place-items-center rounded-[4px] border border-line-strong px-1 align-[2px] font-mono text-[11px] text-muted hover:border-ink hover:text-ink"
                  >
                    {n}
                  </button>
                );
              })}
              {s.unsupported_numbers.length > 0 && <span className="ml-1 text-xs text-redline">(not in the sources: {s.unsupported_numbers.join(", ")})</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p>{answer.text}</p>
      )}

      {sources.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Sources</p>
          <ol className="flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <li key={s.id} className="min-w-0 max-w-full">
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

      {answer.rows && answer.rows.length > 0 && (
        <ul className="overflow-hidden rounded-control border border-line">
          {answer.rows.map((r, i) => (
            <li key={r.document_id} className="chat-row border-b border-line last:border-b-0" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <button type="button" onClick={() => onOpen(r.document_id)} className="flex w-full min-w-0 flex-col px-3 py-1.5 text-left hover:bg-raised">
                <span className="truncate font-mono text-[12.5px]">{r.filename}</span>
                <span className="truncate text-xs text-muted">{[humanize(r.doc_type), r.project, r.doc_date].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
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
