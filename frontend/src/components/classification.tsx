"use client";

import { useState } from "react";
import {
  atLeast,
  errorText,
  vault,
  type Classification,
  type ClassificationLevel,
  type DocumentDetail,
  type PageText,
  type Proposal,
} from "@/lib/api";
import { useSession } from "./session";
import { Button, cx, Empty, Notice, Tag } from "./ui";

/** F09.23: the four handling labels, lowest first. These are the organisation's own levels, not government ones. */
export const LEVELS: ClassificationLevel[] = ["public", "internal", "confidential", "restricted"];
const TONE = { public: "green", internal: "neutral", confidential: "amber", restricted: "red" } as const;
const WHO = {
  public: "Anyone in VAULT",
  internal: "Everyone in VAULT",
  confidential: "Analysts and admins",
  restricted: "Admins only",
} as const;

export function ClassBadge({ c, className }: { c?: Classification | ClassificationLevel | null; className?: string }) {
  const level = typeof c === "string" ? c : (c?.level ?? "internal");
  const labelled = typeof c === "string" ? true : (c?.labelled ?? false);
  return (
    <Tag tone={TONE[level]} className={className}>
      <span className="sr-only">Classification: </span>
      {level}
      {!labelled && <span className="font-normal opacity-70"> (unlabelled)</span>}
    </Tag>
  );
}

/** Page text with each redaction drawn as a black bar. The kind shows on hover and to screen readers. Put it in a <pre>. */
export function RedactedText({ page, admin }: { page: PageText; admin: boolean }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const s of [...page.redactions].sort((a, b) => a.start - b.start)) {
    if (s.start < at) continue;
    parts.push(page.text.slice(at, s.start));
    const hidden = page.text.slice(s.start, s.end);
    parts.push(
      admin ? (
        <mark
          key={`${s.start}-${s.end}`}
          title={`${s.status === "proposed" ? "Proposed" : "Redacted"}: ${s.label}. Admins see the text; others see a black bar.`}
          className={cx(
            "rounded-[2px] px-0.5 text-ink",
            s.status === "proposed" ? "bg-amber/25 outline outline-1 outline-amber" : "bg-ink/15 outline outline-1 outline-ink",
          )}
          data-redaction={s.status}
        >
          {hidden}
        </mark>
      ) : (
        <span
          key={`${s.start}-${s.end}`}
          title={`Redacted: ${s.label}`}
          aria-label={`redacted ${s.label}`}
          data-redaction="applied"
          // The placeholder text keeps the bar's width; it is drawn in the bar's own colour so only the bar shows.
          className="redaction-bar select-none rounded-[2px] bg-ink text-transparent"
        >
          {hidden}
        </span>
      ),
    );
    at = s.end;
  }
  parts.push(page.text.slice(at));
  return <>{parts}</>;
}

/** The drawer section: label, who may open it, page text with redactions, and the controls each role may use. */
export function ClassificationSection({ doc, onChanged }: { doc: DocumentDetail; onChanged: () => void }) {
  const { me, refresh } = useSession();
  const admin = me.role === "admin";
  const canPropose = atLeast(me, "analyst");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [level, setLevel] = useState<ClassificationLevel>(doc.classification?.level ?? "internal");
  const c = doc.classification;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  const applied = doc.redactions.filter((r) => (r.status ?? "applied") === "applied");
  const proposed = doc.redactions.filter((r) => r.status === "proposed");

  return (
    <section aria-labelledby="classification-heading">
      <h3 id="classification-heading" className="mb-2 text-sm font-semibold">
        Classification and redactions
      </h3>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ClassBadge c={c} />
        <span className="text-muted">{WHO[c?.level ?? "internal"]} may open it.</span>
        {applied.length > 0 && <Tag tone="neutral">{applied.length} redacted</Tag>}
        {admin && proposed.length > 0 && <Tag tone="amber">{proposed.length} waiting for approval</Tag>}
      </div>
      {c?.labelled && (
        <p className="mt-1 text-xs text-muted">
          {c.reason}. {c.set_by === "agent" ? `Suggested by Keeper's Classifier, approved by ${c.by_user}` : `Set by ${c.by_user}`}
          {c.set_at ? ` on ${new Date(c.set_at * 1000).toLocaleDateString()}` : ""}.
        </p>
      )}

      {canPropose && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            busy={busy === "classify"}
            onClick={() =>
              run("classify", async () => {
                const p = await vault.classify(doc.collection_id, { document_ids: [doc.id], instruction: `Classify and redact ${doc.filename}` });
                setProposal(p);
                refresh();
              })
            }
          >
            Classify and redact
          </Button>
          <span className="text-xs text-muted">Keeper suggests a label and what to black out. An admin approves it in Approvals.</span>
        </div>
      )}
      {proposal && <ClassifyPlanView proposal={proposal} compact />}

      {admin && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-control border border-line p-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Relabel (admins only, recorded in the audit log)
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as ClassificationLevel)}
              className="min-h-9 rounded-control border border-line bg-panel px-2 text-sm text-ink"
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            busy={busy === "relabel"}
            disabled={level === c?.level && c?.labelled}
            onClick={() =>
              run("relabel", async () => {
                await vault.relabel(doc.id, level, "Set by an administrator");
                setMessage({ tone: "info", text: `Labelled ${level}.` });
                onChanged();
              })
            }
          >
            Set label
          </Button>
        </div>
      )}
      {message && (
        <div className="mt-2">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      {admin && doc.redactions.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-line rounded-control border border-line text-sm">
          {doc.redactions.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
              <span>
                <span className="font-medium">{r.label}</span>
                <span className="text-muted">
                  , page {r.page_no}, {r.hint} {r.status === "proposed" ? "(proposed)" : ""}
                </span>
              </span>
              <Button
                variant="quiet"
                busy={busy === `un-${r.id}`}
                onClick={() =>
                  run(`un-${r.id}`, async () => {
                    await vault.unredact(doc.id, r.id);
                    onChanged();
                  })
                }
              >
                Unredact
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What a classify-and-redact proposal will do, document by document. The plan never repeats a hidden value. */
export function ClassifyPlanView({ proposal, compact = false }: { proposal: Proposal; compact?: boolean }) {
  const plan = proposal.plan;
  const items = plan.items as ClassifyItem[] | undefined;
  if (!items?.length) return <Empty>Nothing to classify.</Empty>;
  const s = plan.summary as { documents: number; relabelled: number; redactions: number } | undefined;
  return (
    <div className={cx("mt-2 text-sm", compact && "rounded-control border border-line p-3")}>
      {s && (
        <p className="mb-2 text-muted">
          {s.documents} document{s.documents === 1 ? "" : "s"} checked, {s.relabelled} to relabel, {s.redactions} thing
          {s.redactions === 1 ? "" : "s"} to black out.
          {compact && " Waiting for an admin in Approvals."}
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {items.slice(0, compact ? 5 : 200).map((i) => (
          <li key={i.document_id} className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[12.5px]">{i.filename}</span>
            <ClassBadge c={i.current} />
            <span aria-hidden className="text-muted">
              →
            </span>
            <span className="sr-only">to</span>
            <ClassBadge c={i.suggested} />
            <span className="text-xs text-muted">
              {i.reason}
              {i.redactions.length > 0 && `; black out ${summarise(i.redactions)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ClassifyItem {
  document_id: number;
  filename: string;
  current: ClassificationLevel;
  suggested: ClassificationLevel;
  reason: string;
  redactions: { label: string }[];
}

function summarise(rs: { label: string }[]): string {
  const counts = new Map<string, number>();
  for (const r of rs) counts.set(r.label, (counts.get(r.label) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`).join(", ");
}
