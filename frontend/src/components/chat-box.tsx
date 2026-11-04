"use client";

import { ASK_LABEL } from "@/lib/assistant";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { errorText, vault, type ChatCommand, type ChatReply, type Investigation } from "@/lib/api";
import { humanize } from "@/lib/format";
import { KindBadge, mediaLine } from "@/lib/media";
import { DocumentDrawer } from "./document-drawer";
import { Loader } from "./loader";
import { useSession } from "./session";
import { cx } from "./ui";

type Entry =
  | { id: number; who: "you"; text: string }
  | { id: number; who: "vault"; reply?: ChatReply; answer?: Investigation; error?: string; busy?: boolean };

// Demo suggestions name the fictional archive's projects; a real collection gets general ones.
const DEMO_STARTERS = ["Find drawings for Alpha", "Newest first", "Which parts have conflicting ratings?", "Are my models downloaded?"];
const STARTERS = ["Find contracts, newest first", "Show inspection reports", "Which parts have conflicting ratings?", "Are my models downloaded?"];

/** Type what you want: "find the Alpha drawings", "sort by name", "only 2024", or a question. On every screen. */
export function ChatBox() {
  const { collection } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [log, setLog] = useState<Entry[]>([]);
  const [last, setLast] = useState<ChatCommand | null>(null);
  const [doc, setDoc] = useState<number | null>(null);
  const nextId = useRef(1);
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [log]);

  const patch = (id: number, value: Partial<Extract<Entry, { who: "vault" }>>) =>
    setLog((l) => l.map((e) => (e.id === id && e.who === "vault" ? { ...e, ...value } : e)));

  const send = async (message: string) => {
    const m = message.trim();
    if (!m || !collection) return;
    setText("");
    const you = nextId.current++;
    const me = nextId.current++;
    setLog((l) => [...l, { id: you, who: "you", text: m }, { id: me, who: "vault", busy: true }]);
    try {
      const reply = await vault.chat(collection.id, m, last);
      patch(me, { reply, busy: reply.command.kind === "ask" });
      if (reply.command.kind === "find") setLast(reply.command);
      if (reply.command.kind === "open" && reply.command.page) router.push(reply.command.page);
      if (reply.command.kind === "ask") {
        try {
          patch(me, { answer: await vault.investigate(collection.id, reply.command.q, null), busy: false });
        } catch (e) {
          patch(me, { error: errorText(e), busy: false });
        }
      }
    } catch (e) {
      patch(me, { error: errorText(e), busy: false });
    }
  };

  // The full chat page has its own input; a second box over it would only get in the way.
  if (!collection || pathname === "/chat") return null;
  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="chat-launch press fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-line-strong bg-panel py-2.5 pl-3.5 pr-4 text-sm font-medium shadow-lift hover:border-ink"
        >
          <ChatIcon />
          {ASK_LABEL}
          <kbd className="rounded border border-line px-1.5 font-mono text-[10px] text-muted">/</kbd>
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-label={ASK_LABEL}
          className="chat-panel fixed inset-x-3 bottom-3 z-40 flex max-h-[78dvh] flex-col rounded-card border border-line-strong bg-panel shadow-lift sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[440px]"
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ChatIcon /> {ASK_LABEL}
            </h2>
            <div className="flex gap-1">
              <Link
                href="/chat"
                onClick={() => setOpen(false)}
                className="rounded-control px-2 py-1 text-xs text-muted hover:bg-raised hover:text-ink"
              >
                Open full chat
              </Link>
              {log.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setLog([]);
                    setLast(null);
                  }}
                  className="rounded-control px-2 py-1 text-xs text-muted hover:bg-raised hover:text-ink"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="rounded-control px-2 py-1 text-xs text-muted hover:bg-raised hover:text-ink"
              >
                Close
              </button>
            </div>
          </header>

          <div className="min-h-[180px] flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
            {log.length === 0 && (
              <div className="flex flex-col gap-3 py-2">
                <p className="text-sm text-muted">Type what you want to find, how to sort it, or a question.</p>
                <div className="flex flex-wrap gap-1.5">
                  {(collection.is_demo ? DEMO_STARTERS : STARTERS).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-full border border-line px-3 py-1 text-[13px] text-muted hover:border-line-strong hover:text-ink"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <ol className="flex flex-col gap-3">
              {log.map((e) =>
                e.who === "you" ? (
                  <li key={e.id} className="chat-msg ml-10 self-end rounded-card bg-ink px-3 py-2 text-sm text-paper">
                    {e.text}
                  </li>
                ) : (
                  <li key={e.id} className="chat-msg mr-4 text-sm">
                    <VaultReply entry={e} onOpen={setDoc} />
                  </li>
                ),
              )}
            </ol>
            <div ref={end} />
          </div>

          <form
            className="flex gap-2 border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <label htmlFor="chat-input" className="sr-only">
              Message
            </label>
            <input
              id="chat-input"
              ref={input}
              value={text}
              maxLength={300}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
              placeholder={last ? "Try “only 2024” or “sort by name”" : "Find, sort or ask anything"}
              className="min-w-0 flex-1 rounded-control border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="press rounded-control bg-ink px-3.5 text-sm font-medium text-paper disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </section>
      )}
      <DocumentDrawer documentId={doc} onClose={() => setDoc(null)} />
    </>
  );
}

function VaultReply({ entry, onOpen }: { entry: Extract<Entry, { who: "vault" }>; onOpen: (id: number) => void }) {
  const { reply, answer, error, busy } = entry;
  if (error) return <p className="text-redline">That did not work: {error}</p>;
  return (
    <div className="flex flex-col gap-2">
      {reply && reply.command.kind !== "ask" && <p>{reply.reply}</p>}
      {busy && <Loader label={reply?.command.kind === "ask" ? "Reading the sources" : "Thinking"} />}
      {reply?.results.length ? (
        <ul className="overflow-hidden rounded-control border border-line">
          {reply.results.map((r, i) => (
            <li key={r.document_id} className="chat-row border-b border-line last:border-b-0" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <button
                type="button"
                onClick={() => onOpen(r.document_id)}
                className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-raised"
              >
                <span className="truncate font-mono text-[12.5px]">
                  <KindBadge kind={r.kind} />
                  {r.filename}
                </span>
                <span className="text-xs text-muted">
                  {r.kind && r.kind !== "document"
                    ? mediaLine(r.media_info, r.kind)
                    : [humanize(r.doc_type), r.project, r.doc_date].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {reply?.models && reply.models.length > 0 && (
        <ul className="flex flex-col gap-1">
          {reply.models.map((m) => (
            <li key={m.name} className="flex items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green" />
              <span className="font-mono text-[12.5px]">{m.name}</span>
              <span className="text-xs text-muted">
                {m.size_gb} GB{m.used_by_vault ? ", in use" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {answer && (
        <>
          <ul className="flex flex-col gap-1.5">
            {answer.answer.map((s, i) => (
              <li key={i} className={cx(!s.verified && "text-muted")}>
                {s.text}
                {s.sources.map((n) => {
                  const src = answer.sources.find((x) => x.id === n);
                  return (
                    <button
                      key={n}
                      type="button"
                      title={src ? `${src.filename}: ${src.quote}` : undefined}
                      onClick={() => src && onOpen(src.document_id)}
                      className="mx-0.5 inline-grid min-w-5 place-items-center rounded-[4px] border border-line-strong px-1 align-[2px] font-mono text-[11px] text-muted hover:text-ink"
                    >
                      {n}
                    </button>
                  );
                })}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            {answer.answered_by?.is_ai_model ? answer.answered_by.model : "Rule-based"} · {answer.sources.length} sources ·{" "}
            {(answer.duration_ms / 1000).toFixed(1)} s. Click a number to open its document.
          </p>
        </>
      )}
    </div>
  );
}

function ChatIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M3.5 4.5h13v9h-7l-3.5 3v-3h-2.5z" />
      <path d="M7 8.5h6M7 11h3.5" strokeLinecap="round" />
    </svg>
  );
}
