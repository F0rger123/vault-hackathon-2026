"use client";

import { useMemo, useState } from "react";
import { errorText, vault, type Investigation, type ProviderName } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { Button, cx, inputClass, Notice, Panel, Tag } from "./ui";

const SUGGESTIONS = [
  "Which parts in Project Alpha have conflicting pressure ratings?",
  "Are any part numbers reused across different projects?",
  "What pressure ratings are recorded for BV-7891?",
];

/** Ask a question in plain words; every sentence of the answer points at the lines it rests on. */
export function AskPanel({ collectionId, onOpenDocument }: { collectionId: number; onOpenDocument: (id: number) => void }) {
  const providers = useLoad("providers", vault.providers);
  // Only local providers are offered here: a remote answer would need its own data-leaves-this-machine prompt.
  const local = useMemo(
    () => (providers.data?.providers ?? []).filter((p) => p.available && p.locality !== "remote"),
    [providers.data],
  );
  const [chosen, setChosen] = useState<ProviderName | null>(null);
  const provider = chosen ?? local.find((p) => p.is_ai_model)?.name ?? local[0]?.name ?? null;
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Investigation | null>(null);
  const [focus, setFocus] = useState<number | null>(null);

  const ask = async (q: string) => {
    if (q.trim().length < 3) return;
    setQuestion(q);
    setBusy(true);
    setError(null);
    setFocus(null);
    try {
      setResult(await vault.investigate(collectionId, q.trim(), provider));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const by = result?.answered_by;
  return (
    <Panel
      title="Ask the archive"
      aside={
        local.length > 0 && (
          <label className="flex items-center gap-2">
            <span className="sr-only">Answer with</span>
            <select
              className={cx(inputClass, "h-8 py-0 text-[13px]")}
              value={provider ?? ""}
              onChange={(e) => setChosen(e.target.value as ProviderName)}
            >
              {local.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.is_ai_model ? `${p.model} (on this machine)` : "Rule-based, not AI"}
                </option>
              ))}
            </select>
          </label>
        )
      }
      className="mb-6"
    >
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <label htmlFor="ask" className="sr-only">
          Question
        </label>
        <input
          id="ask"
          className={cx(inputClass, "flex-1")}
          placeholder="Ask about parts, ratings, projects or documents"
          value={question}
          maxLength={500}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <Button type="submit" variant="primary" busy={busy} disabled={!provider || question.trim().length < 3}>
          {busy ? "Reading sources" : "Ask"}
        </Button>
      </form>
      {!result && !busy && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              disabled={!provider}
              className="rounded-control border border-line px-2.5 py-1 text-left text-[13px] text-muted hover:border-line-strong hover:text-ink disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {providers.data && local.length === 0 && (
        <Notice tone="warning" className="mt-3">
          No local model is ready, so questions cannot be answered. Check Security for provider status.
        </Notice>
      )}
      {error && (
        <Notice className="mt-3">
          The question could not be answered: {error}
        </Notice>
      )}

      {result && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              {by?.is_ai_model ? (
                <Tag tone="blue">
                  {by.model}, {by.locality === "local" ? "on this machine" : "remote"}
                </Tag>
              ) : (
                <Tag>Rule-based, not AI</Tag>
              )}
              <span className="tabular-nums">{(result.duration_ms / 1000).toFixed(1)} s</span>
              <span>{result.sources.length} source lines</span>
            </p>
            <ol className="flex flex-col gap-2.5" aria-label="Answer">
              {result.answer.map((s, i) => (
                <li key={i} className="text-[15px] leading-relaxed">
                  <span className={cx(!s.verified && "text-muted")}>{s.text}</span>{" "}
                  {s.sources.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setFocus(n);
                        document.getElementById(`ask-src-${n}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                      }}
                      aria-label={`Show source ${n}`}
                      className={cx(
                        "mx-0.5 inline-grid min-w-5 place-items-center rounded-[4px] border px-1 align-[2px] font-mono text-[11px] tabular-nums",
                        focus === n ? "border-ink bg-ink text-paper" : "border-line-strong text-muted hover:text-ink",
                      )}
                    >
                      {n}
                    </button>
                  ))}
                  {s.kind === "interpretation" && (
                    <Tag tone="amber" className="ml-1 align-[1px]">
                      No source
                    </Tag>
                  )}
                  {s.kind === "cited" && !s.verified && (
                    <Tag tone="amber" className="ml-1 align-[1px]">
                      {s.unsupported_numbers.join(", ")} not in cited lines
                    </Tag>
                  )}
                </li>
              ))}
            </ol>
            {result.withheld_local_only > 0 && (
              <p className="mt-3 text-xs text-muted">
                {result.withheld_local_only} lines from local-only documents were kept off the remote model.
              </p>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="mb-2 text-xs font-medium text-muted">Sources, quoted from the stored page text</h3>
            <ol className="flex max-h-[420px] flex-col overflow-y-auto rounded-control border border-line">
              {result.sources.map((s) => (
                <li
                  key={s.id}
                  id={`ask-src-${s.id}`}
                  className={cx(
                    "border-b border-line px-3 py-2 last:border-b-0",
                    focus === s.id && "bg-raised",
                  )}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] text-muted tabular-nums">{s.id}</span>
                    <button
                      type="button"
                      onClick={() => onOpenDocument(s.document_id)}
                      className="break-all text-left font-mono text-[12.5px] font-medium text-blue underline-offset-4 hover:underline"
                    >
                      {s.filename}
                    </button>
                    {s.page != null && <span className="text-xs text-muted">p. {s.page}</span>}
                  </div>
                  <p className="mt-0.5 break-words font-mono text-[12px] leading-relaxed text-ink/85">{s.quote}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Panel>
  );
}
