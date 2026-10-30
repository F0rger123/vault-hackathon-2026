"use client";

import { useState } from "react";
import { api, errorText, vault, type DocumentDetail, type TrainingHistoryEntry } from "@/lib/api";
import { humanize } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { Button, cx, inputClass, Notice, Panel } from "./ui";

const DOC_TYPES = [
  "engineering_drawing",
  "inspection_report",
  "contract",
  "parts_list",
  "revision_history",
  "project_memo",
  "other",
];

/** Where you are in the loop: test, look at mistakes, teach, re-read and re-test. */
export function TrainingSteps({ step }: { step: 1 | 2 | 3 | 4 }) {
  const steps = ["Test it", "See its mistakes", "Teach it", "Re-read and re-test"];
  return (
    <ol className="mb-6 grid gap-2 sm:grid-cols-4" aria-label="Training steps">
      {steps.map((s, i) => {
        const n = (i + 1) as 1 | 2 | 3 | 4;
        return (
          <li
            key={s}
            aria-current={n === step ? "step" : undefined}
            className={cx(
              "flex items-center gap-2 rounded-control border px-3 py-2 text-sm transition-colors",
              n < step ? "border-green/40 text-muted" : n === step ? "border-accent bg-accent/5 font-medium" : "border-line text-muted",
            )}
          >
            <span
              aria-hidden
              className={cx(
                "grid h-5 w-5 place-items-center rounded-full text-[11px]",
                n < step ? "bg-green text-paper" : n === step ? "bg-ink text-panel" : "border border-line-strong",
              )}
            >
              {n < step ? "✓" : n}
            </span>
            {s}
          </li>
        );
      })}
    </ol>
  );
}

/** Held-out document-type score over time, so improvement (or not) is visible at a glance. */
export function ScoreTrend({ history }: { history: TrainingHistoryEntry[] }) {
  const pts = history.map((h) => h.heldout.doc_type).filter((v): v is number => v !== null);
  if (pts.length < 2) return null;
  const w = 220;
  const h = 48;
  const min = Math.min(...pts, 0.5);
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / (1 - min || 1)) * (h - 6) - 3;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full max-w-[240px]" role="img" aria-label={`Held-out score over ${pts.length} tests`}>
        <path d={d} fill="none" stroke="var(--ink)" strokeWidth="1.5" className="draw-line" />
        {pts.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={i === pts.length - 1 ? 3 : 1.8} fill={i === pts.length - 1 ? "var(--green)" : "var(--muted)"} />
        ))}
      </svg>
      <figcaption className="text-xs text-muted">Held-out document type, oldest to newest test</figcaption>
    </figure>
  );
}

/**
 * Quiz VAULT: show one document and what VAULT read. A person says "right" or gives the right answer. Either way the
 * answer is saved as a labelled example, which guides the next reading and grows the set the graded test checks.
 */
async function pickDocument(collectionId: number): Promise<{ doc: DocumentDetail; page: string } | null> {
  const rows = (await vault.documents(collectionId, 500, 0)).filter((d) => d.status === "processed" && !d.media_type.startsWith("image/"));
  if (!rows.length) return null;
  const pick = rows[Math.floor(Math.random() * rows.length)];
  const doc = await vault.document(pick.id);
  const first = await api<{ text: string }>(`/documents/${pick.id}/pages/1`).catch(() => ({ text: "" }));
  return { doc, page: first.text.slice(0, 900) };
}

export function QuizCard({ collectionId, canTeach, onAnswered }: { collectionId: number; canTeach: boolean; onAnswered: () => void }) {
  const [round, setRound] = useState(0);
  const [done, setDone] = useState(0);
  const quiz = useLoad(`quiz:${collectionId}:${round}`, () => pickDocument(collectionId));
  return (
    <Panel title="Quiz VAULT" aside={done ? `${done} answered this session` : "One document at a time"}>
      {quiz.error && <Notice>{quiz.error}</Notice>}
      {quiz.data === null && <p className="text-sm text-muted">Read some documents first; the quiz picks from what VAULT has read.</p>}
      {quiz.data && (
        <QuizQuestion
          key={`${quiz.data.doc.id}:${round}`}
          doc={quiz.data.doc}
          page={quiz.data.page}
          canTeach={canTeach}
          onNext={(answered) => {
            if (answered) {
              setDone((n) => n + 1);
              onAnswered();
            }
            setRound((r) => r + 1);
          }}
        />
      )}
    </Panel>
  );
}

function QuizQuestion({
  doc,
  page,
  canTeach,
  onNext,
}: {
  doc: DocumentDetail;
  page: string;
  canTeach: boolean;
  onNext: (answered: boolean) => void;
}) {
  const read = doc.extraction?.data;
  const [type, setType] = useState(read?.doc_type ?? "other");
  const [project, setProject] = useState(read?.project ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await vault.addExample(doc.id, { doc_type: type, ...(project.trim() ? { project: project.trim() } : {}) });
      onNext(true);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <div className="pop-in flex flex-col gap-3 text-sm">
      <p>
        <span className="font-mono text-[13px] font-medium">{doc.filename}</span>
        <span className="text-muted"> · read by {doc.extraction?.model ?? "?"}</span>
      </p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-control border border-line bg-raised p-3 font-mono text-[12px] leading-relaxed">
        {page || "(no text on the first page)"}
      </pre>
      <p>
        VAULT says this is a <span className="font-medium">{humanize(read?.doc_type)}</span>
        {read?.project ? (
          <>
            {" "}for project <span className="font-medium">{read.project}</span>
          </>
        ) : (
          ", with no project"
        )}
        {read?.doc_date ? `, dated ${read.doc_date}` : ""}. Is that right?
      </p>
      {canTeach ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Document type
              <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Project
              <input className={inputClass} value={project} maxLength={80} onChange={(e) => setProject(e.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" busy={busy} onClick={save}>
              {type === (read?.doc_type ?? "other") && project === (read?.project ?? "") ? "Right, save it" : "Save my answer"}
            </Button>
            <Button disabled={busy} onClick={() => onNext(false)}>
              Skip
            </Button>
          </div>
          <p className="text-xs text-muted">
            Each answer becomes a labelled example: the model sees similar ones next time it reads, and the graded test
            checks against them. This is how your own documents get a real test.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted">Analysts and admins can answer.</p>
      )}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
