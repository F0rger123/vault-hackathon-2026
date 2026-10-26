"use client";

import { useState } from "react";
import { atLeast, errorText, vault, type Proposal } from "@/lib/api";
import { dateTime, formatNumber } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { FolderTree } from "../folder-tree";
import { useSession } from "../session";
import { TitleBlock } from "../title-block";
import { Button, cx, Empty, Field, inputClass, LoadError, Notice, Panel, Tag } from "../ui";

const PRESETS = ["{project}/{doc_type}/{year}", "{doc_type}/{year}", "{project}/{year}", "{year}/{project}"];

export function ApprovalsView() {
  const { me, collection, refresh } = useSession();
  const proposals = useLoad("proposals", vault.proposals);
  const [instruction, setInstruction] = useState("Organize by project, document type and year");
  const [pattern, setPattern] = useState(PRESETS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCreate = atLeast(me, "analyst");

  const list = (proposals.data ?? []).filter((p) => !collection || p.collection_id === collection.id);
  const pending = list.filter((p) => p.status === "pending");
  const decided = list.filter((p) => p.status !== "pending");

  return (
    <>
      <TitleBlock
        href="/approvals"
        title="Approvals"
        description="Reorganizing files needs an administrator's approval. Approving exports copies into a new folder; originals are never moved, renamed or changed."
      />
      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Panel title="Propose a new folder layout" className="self-start">
          {!canCreate ? (
            <p className="text-sm text-muted">Analysts and admins can propose a layout. Viewers can&apos;t see proposals.</p>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!collection) return;
                setBusy(true);
                setError(null);
                try {
                  await vault.createProposal(collection.id, instruction, pattern);
                  proposals.reload();
                  refresh();
                } catch (err) {
                  setError(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="What should change" htmlFor="instruction">
                <textarea
                  id="instruction"
                  rows={2}
                  className={inputClass}
                  value={instruction}
                  maxLength={500}
                  onChange={(e) => setInstruction(e.target.value)}
                />
              </Field>
              <Field
                label="Folder pattern"
                htmlFor="pattern"
                hint="Use {project}, {doc_type} and {year}, separated by slashes. Documents with a missing value go to a folder such as undated."
              >
                <input id="pattern" className={cx(inputClass, "font-mono")} value={pattern} onChange={(e) => setPattern(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-1">
                {PRESETS.map((p) => (
                  <button
                    type="button"
                    key={p}
                    aria-pressed={pattern === p}
                    onClick={() => setPattern(p)}
                    className={cx(
                      "rounded-[3px] border px-1.5 py-0.5 font-mono text-[12px]",
                      pattern === p ? "border-blue text-blue" : "border-line text-muted hover:text-ink",
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <Button type="submit" variant="primary" busy={busy} disabled={!collection}>
                Create proposal
              </Button>
              {error && <Notice>Couldn&apos;t create the proposal: {error}</Notice>}
              <p className="text-xs text-muted">Creating a proposal only plans the layout. Nothing is copied until an administrator approves it.</p>
            </form>
          )}
        </Panel>

        <div className="flex min-w-0 flex-col gap-6">
          <LoadError error={proposals.error} status={proposals.status} what="proposals" />
          {proposals.data && (
            <section aria-labelledby="pending-h">
              <h2 id="pending-h" className="mb-3 text-lg font-semibold">
                Waiting for approval
              </h2>
              {pending.length === 0 ? (
                <Empty>Nothing is waiting. Create a proposal to preview a new folder layout.</Empty>
              ) : (
                <div className="flex flex-col gap-4">
                  {pending.map((p) => (
                    <ProposalCard key={p.id} p={p} canDecide={atLeast(me, "admin")} onDecided={() => { proposals.reload(); refresh(); }} />
                  ))}
                </div>
              )}
            </section>
          )}
          {decided.length > 0 && (
            <section aria-labelledby="decided-h">
              <h2 id="decided-h" className="mb-3 text-lg font-semibold">
                Decided
              </h2>
              <div className="flex flex-col gap-4">
                {decided.map((p) => (
                  <ProposalCard key={p.id} p={p} canDecide={false} onDecided={proposals.reload} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function ProposalCard({ p, canDecide, onDecided }: { p: Proposal; canDecide: boolean; onDecided: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = p.plan.items ?? [];
  const folders = new Set(items.map((i) => i.target.split("/").slice(0, -1).join("/"))).size;

  const decide = async (d: "approve" | "reject") => {
    setBusy(d);
    setError(null);
    try {
      await vault.decide(p.id, d, note);
      onDecided();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title={`Proposal ${p.id}`}
      aside={
        p.status === "pending" ? (
          <Tag tone="amber">Waiting for an administrator</Tag>
        ) : p.status === "executed" ? (
          <Tag tone="green">Approved and exported</Tag>
        ) : (
          <Tag tone="red">Rejected</Tag>
        )
      }
    >
      <p className="text-sm">{p.instruction}</p>
      <p className="mt-1 text-sm text-muted">
        Pattern <span className="font-mono text-[13px] text-ink">{p.plan.pattern}</span>, {formatNumber(items.length)} files into{" "}
        {formatNumber(folders)} folders. Proposed {dateTime(p.created_at)}.
      </p>
      {p.status === "executed" && p.result && (
        <p className="mt-2 text-sm">
          Copied <span className="font-semibold tabular-nums">{formatNumber(p.result.copied)}</span> files to{" "}
          <span className="font-mono text-[13px]">{p.result.export_dir}</span>
          {p.decided_at ? ` on ${dateTime(p.decided_at)}` : ""}. The originals were not touched.
        </p>
      )}
      {p.status === "rejected" && p.decided_at && <p className="mt-2 text-sm text-muted">Rejected {dateTime(p.decided_at)}. Nothing was copied.</p>}

      <details className="mt-3 border border-line" open={p.status === "pending"}>
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          {p.status === "pending" ? "Preview the new layout" : "Layout"}
        </summary>
        <div className="border-t border-line px-3 py-2">
          {items.length ? <FolderTree paths={items.map((i) => i.target)} /> : <p className="text-sm text-muted">This plan has no files.</p>}
        </div>
      </details>

      {p.status === "pending" &&
        (canDecide ? (
          <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Note for the audit log (optional)" htmlFor={`note-${p.id}`}>
                <input id={`note-${p.id}`} className={inputClass} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" busy={busy === "approve"} disabled={busy !== null} onClick={() => decide("approve")}>
                Approve and export copies
              </Button>
              <Button variant="danger" busy={busy === "reject"} disabled={busy !== null} onClick={() => decide("reject")}>
                Reject
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">Only an administrator can approve or reject this proposal.</p>
        ))}
      {error && <Notice className="mt-3">Couldn&apos;t record the decision: {error}</Notice>}
    </Panel>
  );
}
