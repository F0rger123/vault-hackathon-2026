"use client";

import { useState } from "react";
import { errorText, vault, type RunSummary } from "@/lib/api";
import { humanize } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { Button, cx, inputClass, Panel } from "./ui";

const SUGGESTIONS = ["How is it going?", "How fast is it?", "Did anything fail?", "What did the security gate do?"];

/** F10.13: what this run did so far, and a chat with the coordinator that answers only from the run's records. */
export function RunSummaryPanel({ jobId, finished }: { jobId: number; finished: boolean }) {
  const summary = useLoad(`summary:${jobId}:${finished}`, () => vault.runSummary(jobId), finished ? undefined : 3000);
  const [messages, setMessages] = useState<{ who: "you" | "vault"; text: string; by?: string }[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  const ask = async (q: string) => {
    if (!q.trim()) return;
    setMessages((m) => [...m, { who: "you", text: q }]);
    setQuestion("");
    setBusy(true);
    try {
      const r = await vault.askRun(jobId, q);
      setMessages((m) => [...m, { who: "vault", text: r.answer, by: r.by }]);
    } catch (e) {
      setMessages((m) => [...m, { who: "vault", text: errorText(e), by: "error" }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Panel title="Run summary" aside={finished ? "Final" : "Updating live"}>
        {summary.data ? <Facts s={summary.data} /> : <p className="text-sm text-muted">Collecting the agents&apos; records…</p>}
      </Panel>
      <Panel title="Ask the coordinator">
        <div className="flex flex-col gap-3">
          <div className="flex max-h-72 min-h-24 flex-col gap-2 overflow-auto" aria-live="polite">
            {messages.length === 0 && (
              <p className="text-sm text-muted">
                Ask about this run: speed, failures, what the security gate held back. Answers come only from what the
                agents recorded, by the local Meta model when it is running.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={cx(
                  "pop-in max-w-[90%] rounded-card px-3 py-2 text-sm",
                  m.who === "you" ? "self-end bg-ink text-panel" : "self-start border border-line bg-raised",
                )}
              >
                {m.text}
                {m.who === "vault" && m.by && m.by !== "error" && (
                  <span className="mt-1 block text-[11px] text-muted">{m.by === "rules" ? "Rule-based answer, not AI" : `Answered by ${m.by} on this machine`}</span>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" disabled={busy} onClick={() => ask(s)} className="rounded-control border border-line px-2 py-1 text-xs text-muted hover:text-ink">
                {s}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <input
              className={inputClass}
              value={question}
              maxLength={500}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Why did document 12 go to a person?"
              aria-label="Question for the coordinator"
            />
            <Button type="submit" busy={busy} disabled={question.trim().length < 2}>
              Ask
            </Button>
          </form>
        </div>
      </Panel>
    </div>
  );
}

function Facts({ s }: { s: RunSummary }) {
  const types = Object.entries(s.doc_types);
  const items: [string, string][] = [
    ["Read", `${s.done} of ${s.total}${s.skipped_already_read ? ` (${s.skipped_already_read} skipped, already read)` : ""}`],
    ["Speed", s.docs_per_minute ? `${s.docs_per_minute} documents a minute, ${s.parallel_slots} in parallel` : "Measuring"],
    ["Security gate", `${s.security.screened ?? 0} screened · ${s.security.restricted ?? 0} restricted · ${s.kept_local} kept local`],
    ["Reviewer", `${s.escalated} escalated · ${s.for_a_person} for a person · ${s.findings ?? 0} findings`],
    ["Failed", s.failed ? `${s.failed}: ${s.failures[0]?.reason ?? ""}` : "None"],
  ];
  return (
    <div className="flex flex-col gap-4 text-sm">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[140px_minmax(0,1fr)]">
        {items.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {s.lanes.length > 0 && (
        <div>
          <p className="mb-1 text-muted">Model lanes</p>
          <ul className="flex flex-col gap-1">
            {s.lanes.map((l) => (
              <li key={l.lane} className="flex justify-between gap-3 tabular-nums">
                <span className="font-mono text-[13px]">{l.lane}</span>
                <span>
                  {l.documents} documents{l.avg_seconds !== null ? ` · ${l.avg_seconds} s each` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {types.length > 0 && <p className="text-muted">{types.map(([t, n]) => `${humanize(t)} ${n}`).join(" · ")}</p>}
    </div>
  );
}
