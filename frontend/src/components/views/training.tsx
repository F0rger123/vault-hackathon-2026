"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  atLeast,
  errorText,
  vault,
  type ProviderName,
  type TrainingHistoryEntry,
  type TrainingReport,
} from "@/lib/api";
import { dateTime, humanize } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { useSession } from "../session";
import { TitleBlock } from "../title-block";
import { Button, cx, Empty, LoadError, Notice, Panel, Tag } from "../ui";

const FIELD_LABEL: Record<string, string> = { doc_type: "Document type", project: "Project", doc_date: "Date" };

function pct(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? "–" : `${(rate * 100).toFixed(1)}%`;
}

/** Grade, teach, re-test: VAULT improves through rules and examples, measured on documents nobody corrected. */
export function TrainingView() {
  const { collection, me, setMode, mode } = useSession();
  const canTeach = atLeast(me, "analyst");
  const data = useLoad(collection ? `training:${collection.id}` : null, () => vault.training(collection!.id));
  const providers = useLoad("providers", vault.providers);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ field: string; value: string; when_contains: string; fixes_train_docs: number }[] | null>(null);
  const [lastJob, setLastJob] = useState<number | null>(null);

  const reader = useMemo<ProviderName>(() => {
    const local = (providers.data?.providers ?? []).find((p) => p.available && p.locality === "local" && p.is_ai_model);
    return (local?.name as ProviderName) ?? "heuristic";
  }, [providers.data]);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (!collection)
    return (
      <>
        <TitleBlock href="/training" title="Training" description="Grade how well VAULT reads your documents, teach it, and re-test." />
        <Empty>
          There is no collection in this mode yet. <Link href="/setup" className="underline underline-offset-4">Set one up</Link> first.
        </Empty>
      </>
    );

  const report = data.data?.report;
  const history = data.data?.history ?? [];

  return (
    <>
      <TitleBlock
        href="/training"
        title="Training"
        description="Grade how well VAULT reads this collection, teach it where it is wrong, and re-test on documents nobody corrected. When the scores are good enough, move on to real documents."
      />
      <p className="mb-6 max-w-3xl text-sm text-muted">
        VAULT does not change the model&apos;s weights. It improves through your corrections, which become versioned rules, and
        through labelled examples, which guide the model. Every change is measured on a held-out set you never touch, so a
        better score means better reading, not memorised answers.
      </p>
      <LoadError error={data.error} status={data.status} what="the training report" />
      {error && <Notice className="mb-4">{error}</Notice>}
      {notice && (
        <p className="mb-4 text-sm" role="status">
          {notice}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel
          title="1. Graded test"
          aside={
            canTeach && (
              <Button
                variant="primary"
                busy={busy === "grade"}
                onClick={() =>
                  act("grade", async () => {
                    await vault.trainingGrade(collection.id);
                    data.reload();
                  })
                }
              >
                Run graded test
              </Button>
            )
          }
        >
          {report ? <Scores report={report} /> : <p className="text-sm text-muted">Loading</p>}
        </Panel>

        <Panel title="Ready for real documents?">
          {report && <Readiness report={report} mode={mode} onSwitch={() => setMode("real")} />}
          <History history={history} />
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel title="2. Teach">
          {!canTeach ? (
            <p className="text-sm text-muted">Analysts and admins can teach VAULT. Viewers can see the scores.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-sm">
                  Let VAULT suggest rules from the practice set. A rule is only suggested when it fixes mistakes and never
                  changes a document it already reads correctly.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    busy={busy === "suggest"}
                    onClick={() =>
                      act("suggest", async () => {
                        setSuggestions(await vault.trainingSuggestions(collection.id));
                      })
                    }
                  >
                    Suggest rules
                  </Button>
                  {suggestions && suggestions.length > 0 && (
                    <Button
                      variant="primary"
                      busy={busy === "apply"}
                      onClick={() =>
                        act("apply", async () => {
                          const r = await vault.trainingApply(collection.id);
                          setSuggestions(null);
                          setNotice(`${r.applied.length} rule${r.applied.length === 1 ? "" : "s"} published. Re-read the collection to see the effect.`);
                        })
                      }
                    >
                      Apply {suggestions.length} rule{suggestions.length === 1 ? "" : "s"}
                    </Button>
                  )}
                </div>
                {suggestions && suggestions.length === 0 && (
                  <p className="text-sm text-muted">No safe rule found. Correct the mistakes below one by one instead.</p>
                )}
                {suggestions && suggestions.length > 0 && (
                  <ul className="flex flex-col gap-1 text-sm">
                    {suggestions.map((s) => (
                      <li key={`${s.field}:${s.when_contains}`}>
                        When a document contains <span className="font-mono">“{s.when_contains}”</span>, set{" "}
                        {FIELD_LABEL[s.field] ?? s.field} to <span className="font-medium">{humanize(s.value)}</span>{" "}
                        <span className="text-muted">(fixes {s.fixes_train_docs})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Mistakes
                report={report}
                busy={busy}
                onTeach={(m) =>
                  act(`teach:${m.document_id}:${m.field}`, async () => {
                    await vault.addExample(m.document_id, { [m.field]: m.expected });
                    setNotice(`${m.filename} saved as a labelled example. The model sees it as guidance on the next read.`);
                  })
                }
              />
            </div>
          )}
        </Panel>

        <Panel title="3. Re-test">
          <p className="text-sm">
            Re-read the collection with the new rules and examples, then run the graded test again. The history shows the
            change on the held-out set.
          </p>
          {canTeach && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                busy={busy === "reread"}
                onClick={() =>
                  act("reread", async () => {
                    const job = await vault.createJob({
                      collection_id: collection.id,
                      lanes: [{ provider: reader, concurrency: reader === "heuristic" ? 4 : 2 }],
                      confirm_remote: false,
                    });
                    setLastJob(job.id);
                  })
                }
              >
                Re-read with {reader === "heuristic" ? "the rules baseline" : "Meta Llama 3 on this machine"}
              </Button>
              {lastJob && (
                <Link href={`/run?job=${lastJob}`} className="text-sm text-blue underline underline-offset-4">
                  Watch run {lastJob}, then run the graded test again
                </Link>
              )}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function Scores({ report }: { report: TrainingReport }) {
  if (!report.graded_documents)
    return (
      <p className="text-sm text-muted">
        Nothing to grade yet. In Demo mode the fictional dataset&apos;s answers are known; for your own documents, label a
        few on <Link href="/setup" className="underline underline-offset-4">Set up a run</Link> (Teach by example) so VAULT
        has right answers to check against.
      </p>
    );
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted">
        {report.read_documents} of {report.graded_documents} graded documents read, against {report.source}
        {report.read_by.length > 0 && <>, by {report.read_by.join(", ")}</>}.
      </p>
      <table className="w-full text-left">
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-1 font-medium">Field</th>
            <th className="py-1 font-medium">Practice set</th>
            <th className="py-1 font-medium">Held-out (honest score)</th>
          </tr>
        </thead>
        <tbody>
          {Object.keys(FIELD_LABEL).map((f) => (
            <tr key={f} className="border-t border-line">
              <td className="py-1.5">{FIELD_LABEL[f]}</td>
              <td className="py-1.5 tabular-nums">{pct(report.fields.train[f]?.rate)}</td>
              <td className="py-1.5 font-semibold tabular-nums">{pct(report.fields.heldout[f]?.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.conflicts && (
        <p>
          Planted conflicts found: <span className="font-semibold tabular-nums">{report.conflicts.found} of {report.conflicts.planted}</span>
          {report.conflicts.false_alarms > 0 ? `, ${report.conflicts.false_alarms} false alarms` : ", no false alarms"}.
        </p>
      )}
    </div>
  );
}

function Readiness({ report, mode, onSwitch }: { report: TrainingReport; mode: string; onSwitch: () => void }) {
  return (
    <div className={cx("mb-4 rounded-control border px-3 py-2 text-sm", report.readiness.ready ? "border-green/50" : "border-line")}>
      <p className="flex items-center gap-2">
        {report.readiness.ready ? <Tag tone="green">Ready</Tag> : <Tag tone="amber">Not yet</Tag>}
        <span>{report.readiness.reason}</span>
      </p>
      {report.readiness.ready && mode === "demo" && (
        <Button variant="primary" className="mt-2" onClick={onSwitch}>
          Switch to Real mode
        </Button>
      )}
    </div>
  );
}

function History({ history }: { history: TrainingHistoryEntry[] }) {
  if (!history.length) return <p className="text-sm text-muted">Run a graded test to start the history.</p>;
  const rows = [...history].reverse().slice(0, 8);
  return (
    <ol className="flex flex-col gap-1 text-sm" aria-label="Graded test history">
      {rows.map((h, i) => {
        const prev = rows[i + 1];
        const delta = prev && h.heldout.doc_type !== null && prev.heldout.doc_type !== null ? h.heldout.doc_type - prev.heldout.doc_type : null;
        return (
          <li key={h.graded_at} className="flex flex-wrap justify-between gap-x-3 border-t border-line py-1">
            <span className="text-muted">{dateTime(h.graded_at)}</span>
            <span className="tabular-nums">
              Held-out type {pct(h.heldout.doc_type)}
              {delta !== null && delta !== 0 && (
                <span className={delta > 0 ? "text-green" : "text-redline"}> ({delta > 0 ? "+" : ""}{(delta * 100).toFixed(1)})</span>
              )}
              , project {pct(h.heldout.project)}, {h.rules} rule{h.rules === 1 ? "" : "s"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Mistakes({
  report,
  busy,
  onTeach,
}: {
  report: TrainingReport | undefined;
  busy: string | null;
  onTeach: (m: TrainingReport["mistakes"][number]) => void;
}) {
  if (!report?.mistakes.length) return null;
  return (
    <div>
      <h3 className="text-sm font-medium">Practice-set mistakes ({report.mistakes.length})</h3>
      <ul className="mt-2 flex max-h-72 flex-col overflow-y-auto rounded-control border border-line text-sm">
        {report.mistakes.slice(0, 40).map((m) => (
          <li key={`${m.document_id}:${m.field}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 last:border-b-0">
            <span className="min-w-0">
              <span className="break-all font-mono text-[13px]">{m.filename}</span>
              <span className="block text-xs text-muted">
                {FIELD_LABEL[m.field] ?? m.field}: read {m.got ? humanize(m.got) : "nothing"}, should be {humanize(m.expected)}
              </span>
            </span>
            <Button variant="quiet" busy={busy === `teach:${m.document_id}:${m.field}`} onClick={() => onTeach(m)}>
              Teach this one
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
