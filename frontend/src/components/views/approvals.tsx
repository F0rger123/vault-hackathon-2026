"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { atLeast, errorText, vault, type LayoutSuggestion, type Proposal, type ProviderName } from "@/lib/api";
import { dateTime, formatNumber } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { DocumentDrawer } from "../document-drawer";
import { FolderTree } from "../folder-tree";
import { SharePanel, SharePlanView } from "../share-pack";
import { useSession } from "../session";
import { TitleBlock } from "../title-block";
import { Button, cx, Empty, Field, inputClass, LoadError, Notice, Panel, Tag } from "../ui";

const PRESETS = ["{project}/{doc_type}/{year}", "{doc_type}/{year}", "{project}/{year}", "{year}/{project}"];
const HOWTO_KEY = "vault.approvals.howto.hidden";

type Mode = "review" | "view";
type Filter = "all" | "pending" | "executed" | "rejected";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Waiting" },
  { id: "executed", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

/** One row of "what would change": the file as it is now and where its copy goes. */
interface Change {
  document_id: number;
  filename: string;
  after: string | null;
  state: "planned" | "copied" | "removed" | "skipped" | "shared" | "left_out";
  why?: string;
}

function exportFolder(p: Proposal): string {
  return p.result?.export_dir ?? `exports/${p.kind === "share_pack" ? "share" : "proposal"}-${p.id}`;
}

function changesOf(p: Proposal): Change[] {
  if (p.kind === "share_pack") {
    return (p.plan.items ?? []).map((i) => {
      const s = i as { document_id: number; filename: string; action?: string; reason?: string; redactions?: Record<string, number> };
      const hidden = Object.values(s.redactions ?? {}).reduce((a, b) => a + b, 0);
      return {
        document_id: s.document_id,
        filename: s.filename,
        after: s.action === "shared" ? `documents/${s.filename.replace(/\.[^.]+$/, "")}.pdf` : null,
        state: s.action === "shared" ? "shared" : "left_out",
        why: s.action === "shared" ? (hidden ? `${hidden} items blacked out` : "Redacted copy") : s.reason,
      };
    });
  }
  if (p.status === "executed" && p.result?.items) {
    return p.result.items.map((i) => ({
      document_id: i.document_id,
      filename: i.filename,
      after: i.target,
      state: !i.copied ? "skipped" : i.removed ? "removed" : "copied",
      why: i.copied ? undefined : i.reason,
    }));
  }
  return (p.plan.items ?? []).map((i) => ({ document_id: i.document_id, filename: i.filename, after: i.target, state: "planned" }));
}

function statusTag(p: Proposal) {
  if (p.status === "pending") return <Tag tone="amber">Waiting for an administrator</Tag>;
  if (p.status === "executed") return <Tag tone="green">Approved and exported</Tag>;
  return <Tag tone="red">Rejected</Tag>;
}

/** Suggestions use a local Meta model when one is running, otherwise the rule-based reader. Never a remote one. */
function useSuggester(): ProviderName {
  const providers = useLoad("providers", vault.providers);
  return useMemo<ProviderName>(() => {
    const local = (providers.data?.providers ?? []).find((p) => p.available && p.locality === "local" && p.is_ai_model);
    return (local?.name as ProviderName) ?? "heuristic";
  }, [providers.data]);
}

export function ApprovalsView() {
  const { me, collection, refresh } = useSession();
  const suggester = useSuggester();
  const proposals = useLoad("proposals", vault.proposals);
  const isAdmin = atLeast(me, "admin");
  const canCreate = atLeast(me, "analyst");
  // Viewers only ever get view-only. Anyone else can switch to it, and a link can open it (?view=only).
  // Rendered only after sign-in, in the browser, so reading the address during the first render is safe.
  const [mode, setMode] = useState<Mode>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "only" ? "view" : "review",
  );
  const viewOnly = !canCreate || mode === "view";

  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [openDoc, setOpenDoc] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const all = useMemo(
    () => (proposals.data ?? []).filter((p) => !collection || p.collection_id === collection.id),
    [proposals.data, collection],
  );
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: all.length, pending: 0, executed: 0, rejected: 0 };
    for (const p of all) c[p.status] += 1;
    return c;
  }, [all]);
  const shown = filter === "all" ? all : all.filter((p) => p.status === filter);
  const current =
    all.find((p) => p.id === selected) ?? all.find((p) => p.status === "pending") ?? all[0] ?? null;

  const reload = () => {
    proposals.reload();
    refresh();
  };

  const choose = (id: number) => {
    setSelected(id);
    // On a phone the detail sits under the list, so bring it into view.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" }));
    }
  };

  return (
    <>
      <TitleBlock
        href="/approvals"
        title="Approvals"
        description="Moving or sharing files needs an admin's OK. VAULT writes copies; originals never change, and are never deleted."
        actions={
          canCreate ? (
            <div role="tablist" aria-label="How to open approvals" className="inline-flex rounded-control border border-line-strong bg-raised p-0.5">
              {(
                [
                  ["review", isAdmin ? "Review and decide" : "Propose"],
                  ["view", "View only"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={mode === id}
                  onClick={() => setMode(id)}
                  className={cx(
                    "rounded-control px-3 py-1.5 text-sm font-medium transition-colors",
                    mode === id ? "bg-panel text-ink shadow-panel" : "text-muted hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />

      <HowApprovalsWork />

      {viewOnly && (
        <Notice tone="info" className="mb-5">
          <span className="font-semibold">View only.</span> Browse every request, open each file and compare where its copy would
          go. Nothing on this screen can approve, reject or delete anything.
          {!canCreate && " Your role can look but not change; ask an administrator to decide."}
        </Notice>
      )}
      {done && (
        <Notice tone="info" className="mb-5">
          {done}
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] 2xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
          <Panel title="Requests" aside={proposals.data ? `${formatNumber(all.length)} in this collection` : undefined} bodyClassName="p-0 sm:p-0">
            <div role="group" aria-label="Show requests" className="flex flex-wrap gap-1 border-b border-line px-3 py-2.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={cx(
                    "rounded-control border px-2 py-0.5 text-[13px]",
                    filter === f.id ? "border-accent text-ink" : "border-line text-muted hover:text-ink",
                  )}
                >
                  {f.label} <span className="tabular-nums text-muted">{counts[f.id]}</span>
                </button>
              ))}
            </div>
            <LoadError error={proposals.error} status={proposals.status} what="proposals" />
            {proposals.data &&
              (shown.length === 0 ? (
                <div className="p-4">
                  <Empty>
                    {all.length === 0
                      ? "No requests yet. An analyst or admin proposes a folder layout or a share pack, and it waits here."
                      : "No requests match this filter."}
                  </Empty>
                </div>
              ) : (
                <ul aria-label="Requests" className="flex max-h-[min(60vh,640px)] flex-col overflow-auto">
                  {shown.map((p) => {
                    const active = current?.id === p.id;
                    const n = p.kind === "share_pack" ? (p.plan.items ?? []).length : (p.plan.items ?? []).length;
                    return (
                      <li key={p.id} className="border-b border-line last:border-b-0">
                        <button
                          type="button"
                          aria-current={active ? "true" : undefined}
                          onClick={() => choose(p.id)}
                          className={cx(
                            "flex w-full flex-col gap-1 border-l-2 px-4 py-3 text-left transition-colors",
                            active ? "border-l-accent bg-raised" : "border-l-transparent hover:bg-raised/60",
                          )}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold">
                              {p.kind === "share_pack" ? "Share pack" : "Proposal"} {p.id}
                            </span>
                            <StatusDot status={p.status} />
                          </span>
                          <span className="line-clamp-2 text-[13px] text-muted">{p.instruction || "No description"}</span>
                          <span className="text-xs text-muted">
                            {formatNumber(n)} files · asked by {p.created_by_name ?? "someone"} · {dateTime(p.created_at)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ))}
          </Panel>
          {!viewOnly && canCreate && (
            <ProposeForm collectionId={collection?.id ?? null} onCreated={reload} />
          )}
        </div>

        <div ref={detailRef} className="flex min-w-0 scroll-mt-4 flex-col gap-6">
          {current ? (
            <RequestDetail
              key={current.id}
              p={current}
              viewOnly={viewOnly}
              isAdmin={isAdmin}
              onOpenDoc={setOpenDoc}
              onChanged={reload}
              onDeleted={(msg, gone) => {
                if (gone) setSelected(null);
                setDone(msg);
                reload();
              }}
            />
          ) : (
            proposals.data && (
              <Panel title="Nothing selected">
                <p className="text-sm text-muted">Pick a request on the left to see every file it would copy, from where to where.</p>
              </Panel>
            )
          )}
          {!viewOnly && canCreate && collection && (
            <SharePanel collectionId={collection.id} suggester={suggester} onPlanned={reload} />
          )}
        </div>
      </div>
      <DocumentDrawer documentId={openDoc} onClose={() => setOpenDoc(null)} />
    </>
  );
}

function StatusDot({ status }: { status: Proposal["status"] }) {
  const tone = status === "pending" ? "bg-amber" : status === "executed" ? "bg-green" : "bg-redline";
  const label = status === "pending" ? "Waiting" : status === "executed" ? "Approved" : "Rejected";
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
      <span aria-hidden className={cx("h-2 w-2 rounded-full", tone)} />
      {label}
    </span>
  );
}

/** A short "how approvals work" strip. Hidden on request, remembered in this browser only. */
function HowApprovalsWork() {
  const [hidden, setHidden] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(HOWTO_KEY) === "1";
    } catch {
      return false; // storage blocked: just show it
    }
  });
  const set = (h: boolean) => {
    setHidden(h);
    try {
      if (h) localStorage.setItem(HOWTO_KEY, "1");
      else localStorage.removeItem(HOWTO_KEY);
    } catch {
      /* ignore */
    }
  };
  if (hidden)
    return (
      <div className="mb-5">
        <Button variant="quiet" onClick={() => set(false)}>
          Show how approvals work
        </Button>
      </div>
    );
  const steps: [string, ReactNode][] = [
    ["Someone asks", "An analyst or admin proposes a new folder layout or a share pack. Nothing is copied yet."],
    ["Everyone can look", "Pick a request to see each file, where it is now and where its copy would go. View only changes nothing."],
    ["An admin decides", "Approve writes copies into VAULT's own export folder. Reject writes nothing."],
    ["Tidy up", "An admin can delete a request, or the copies VAULT wrote. Originals are never deleted."],
  ];
  return (
    <section aria-labelledby="howto-h" className="mb-6 rounded-card border border-line bg-panel px-4 py-4 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="howto-h" className="display text-[15px]">
          How approvals work
        </h2>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/guide#approve" className="text-blue underline-offset-4 hover:underline">
            Full guide
          </Link>
          <Button variant="quiet" onClick={() => set(true)}>
            Hide these steps
          </Button>
        </div>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map(([title, body], i) => (
          <li key={title} className="flex gap-3">
            <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-xs">
              {i + 1}
            </span>
            <span className="min-w-0 text-sm">
              <span className="block font-medium">{title}</span>
              <span className="text-muted">{body}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ProposeForm({ collectionId, onCreated }: { collectionId: number | null; onCreated: () => void }) {
  const [instruction, setInstruction] = useState("Organize by project, document type and year");
  const [pattern, setPattern] = useState(PRESETS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggester = useSuggester();
  const [suggestion, setSuggestion] = useState<LayoutSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  return (
    <Panel title="Propose a new folder layout">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (collectionId === null) return;
          setBusy(true);
          setError(null);
          try {
            await vault.createProposal(collectionId, instruction, pattern);
            onCreated();
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
        <div className="flex flex-col gap-1.5">
          <Button
            type="button"
            variant="secondary"
            busy={suggesting}
            disabled={instruction.trim().length < 3}
            onClick={async () => {
              setSuggesting(true);
              setError(null);
              try {
                const s = await vault.interpretLayout(instruction.trim(), suggester);
                setSuggestion(s);
                if (s.supported) setPattern(s.pattern);
              } catch (err) {
                setSuggestion(null);
                setError(errorText(err));
              } finally {
                setSuggesting(false);
              }
            }}
          >
            {suggesting ? "Reading the request" : "Suggest a pattern from this request"}
          </Button>
          {suggestion && (
            <p className="text-xs text-muted" role="status">
              {suggestion.supported ? (
                <>
                  Suggested <span className="font-mono text-ink">{suggestion.pattern}</span>. {suggestion.explanation}
                </>
              ) : (
                <>No allowed pattern fits. {suggestion.explanation}</>
              )}{" "}
              {suggestion.is_ai_model ? `Read by ${suggestion.model} on this machine.` : "Rule-based, not AI."} Check it before
              creating the proposal.
            </p>
          )}
        </div>
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
                "rounded-control border px-1.5 py-0.5 font-mono text-[12px]",
                pattern === p ? "border-blue text-blue" : "border-line text-muted hover:text-ink",
              )}
            >
              {p}
            </button>
          ))}
        </div>
        <Button type="submit" variant="primary" busy={busy} disabled={collectionId === null}>
          Create proposal
        </Button>
        {error && <Notice>Couldn&apos;t create the proposal: {error}</Notice>}
        <p className="text-xs text-muted">Creating a proposal only plans the layout. Nothing is copied until an administrator approves it.</p>
      </form>
    </Panel>
  );
}

type Pending =
  | { kind: "request"; withCopies: boolean }
  | { kind: "copies" }
  | { kind: "copy"; target: string; filename: string };

function RequestDetail({
  p,
  viewOnly,
  isAdmin,
  onOpenDoc,
  onChanged,
  onDeleted,
}: {
  p: Proposal;
  viewOnly: boolean;
  isAdmin: boolean;
  onOpenDoc: (id: number) => void;
  onChanged: () => void;
  onDeleted: (message: string, requestGone: boolean) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [query, setQuery] = useState("");
  const share = p.kind === "share_pack";
  const changes = changesOf(p);
  const folder = exportFolder(p);
  const liveCopies = changes.filter((c) => c.state === "copied" || c.state === "shared").length;
  const copiesLeft = p.status === "executed" && !p.result?.copies_removed_at && (share || liveCopies > 0);
  const canDecide = !viewOnly && isAdmin && p.status === "pending";
  const canDelete = !viewOnly && isAdmin;
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? changes.filter((c) => c.filename.toLowerCase().includes(needle) || (c.after ?? "").toLowerCase().includes(needle))
    : changes;
  const targets = changes.filter((c) => c.after).map((c) => c.after as string);

  const decide = async (d: "approve" | "reject") => {
    setBusy(d);
    setError(null);
    try {
      await vault.decide(p.id, d, note);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const runDelete = async (what: Pending) => {
    if (what.kind === "request") {
      const r = await vault.deleteProposal(p.id, what.withCopies);
      onDeleted(
        `Deleted ${share ? "share pack" : "proposal"} ${p.id}${r.copies_removed ? ` and ${formatNumber(r.copies_removed)} copies` : ""}. Originals were not touched.`,
        true,
      );
    } else {
      const r = await vault.deleteCopies(p.id, what.kind === "copy" ? what.target : undefined);
      onDeleted(`Removed ${formatNumber(r.removed)} ${r.removed === 1 ? "copy" : "copies"} from ${folder}. Originals were not touched.`, false);
    }
  };

  return (
    <Panel title={`${share ? "Share pack" : "Proposal"} ${p.id}`} aside={statusTag(p)}>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 2xl:grid-cols-3">
        <Fact label="What was asked">{p.instruction || "No description"}</Fact>
        <Fact label="Asked by">
          {p.created_by_name ?? "Unknown"} on {dateTime(p.created_at)}
        </Fact>
        <Fact label="Decision">
          {p.status === "pending"
            ? "Not decided yet"
            : `${p.status === "executed" ? "Approved" : "Rejected"} by ${p.decided_by_name ?? "an administrator"}${p.decided_at ? ` on ${dateTime(p.decided_at)}` : ""}`}
        </Fact>
        <Fact label="What it does">
          {share ? (
            <>
              Redacted copies for <span className="text-ink">{p.plan.recipient}</span>
            </>
          ) : (
            <>
              Copies files into folders by <span className="font-mono text-[13px]">{p.plan.pattern}</span>
            </>
          )}
        </Fact>
        <Fact label="From">VAULT&apos;s read-only store of originals. They stay where they are.</Fact>
        <Fact label={p.status === "executed" ? "Copies went to" : "Copies would go to"}>
          <span className="font-mono text-[13px] break-all">{folder}</span>
        </Fact>
      </dl>

      {p.status === "executed" && p.result && (
        <p className="mt-4 text-sm">
          Copied <span className="font-semibold tabular-nums">{formatNumber(p.result.copied)}</span> files to{" "}
          <span className="font-mono text-[13px]">{p.result.export_dir}</span>
          {p.decided_at ? ` on ${dateTime(p.decided_at)}` : ""}.{" "}
          {share
            ? `Redacted copies only; ${p.result.left_out ?? 0} left out, ${p.result.redactions ?? 0} items blacked out. SHARE-REPORT.md lists every reason.`
            : "The originals were not touched."}{" "}
          {p.result.copies_removed_at && <span className="text-muted">The copies were removed {dateTime(p.result.copies_removed_at)}.</span>}
          {!share && (
            <Link href={`/brain?run=proposal-${p.id}`} className="ml-1 text-blue underline-offset-4 hover:underline">
              Watch them in the brain
            </Link>
          )}
        </p>
      )}
      {p.status === "rejected" && <p className="mt-4 text-sm text-muted">Rejected. Nothing was copied.</p>}

      <section aria-label="Before and after" className="mt-5">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h3 className="text-sm font-semibold">
            Before and after <span className="font-normal text-muted">({formatNumber(changes.length)} files)</span>
          </h3>
          {changes.length > 8 && (
            <input
              type="search"
              aria-label="Find a file in this request"
              placeholder="Find a file"
              className={cx(inputClass, "w-full sm:w-56")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </div>
        <div className="overflow-hidden rounded-control border border-line">
          <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1.3fr)_8rem] gap-3 border-b border-line bg-raised px-3 py-1.5 text-xs font-medium text-muted md:grid">
            <span>Now (original, unchanged)</span>
            <span />
            <span>After (copy in {folder})</span>
            <span>State</span>
          </div>
          <ol aria-label={`Files in ${share ? "share pack" : "proposal"} ${p.id}`} className="max-h-[min(55vh,560px)] overflow-auto">
            {visible.map((c, n) => (
              <li
                key={`${c.document_id}-${n}`}
                data-copy={c.state === "copied" ? "written" : c.state}
                className="grid gap-x-3 gap-y-1 border-b border-line px-3 py-2 text-sm last:border-b-0 md:grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1.3fr)_8rem] md:items-center"
              >
                <button
                  type="button"
                  onClick={() => onOpenDoc(c.document_id)}
                  className="min-w-0 break-words text-left font-mono text-[13px] text-blue underline-offset-4 hover:underline"
                  aria-label={`Open ${c.filename}`}
                >
                  {c.filename}
                </button>
                <span aria-hidden className="hidden text-muted md:block">
                  {"→"}
                </span>
                <span className="min-w-0 break-words font-mono text-[13px]">
                  <span className="text-muted md:hidden">{"→"} </span>
                  {c.after ? (
                    <span className={cx(c.state === "removed" && "text-muted line-through")}>{c.after}</span>
                  ) : (
                    <span className="font-sans text-muted">not copied{c.why ? `: ${c.why}` : ""}</span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <ChangeState c={c} />
                  {canDelete && !share && c.state === "copied" && c.after && (
                    <Button
                      variant="quiet"
                      className="min-h-0 px-0 py-0 text-xs text-redline"
                      onClick={() => setConfirm({ kind: "copy", target: c.after as string, filename: c.filename })}
                      aria-label={`Delete the copy of ${c.filename}`}
                    >
                      Delete copy
                    </Button>
                  )}
                </span>
              </li>
            ))}
            {visible.length === 0 && <li className="px-3 py-3 text-sm text-muted">No file matches.</li>}
          </ol>
        </div>
      </section>

      {share && p.plan.items && p.plan.summary && <SharePlanView plan={p.plan as Parameters<typeof SharePlanView>[0]["plan"]} />}
      {!share && targets.length > 0 && (
        <details className="mt-3 overflow-hidden rounded-control border border-line">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">The new folders as a tree</summary>
          <div className="border-t border-line px-3 py-2">
            <FolderTree paths={targets} />
          </div>
        </details>
      )}

      {p.status === "pending" &&
        !viewOnly &&
        (canDecide ? (
          <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Note for the audit log (optional)" htmlFor={`note-${p.id}`}>
                <input id={`note-${p.id}`} className={inputClass} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" busy={busy === "approve"} disabled={busy !== null} onClick={() => decide("approve")}>
                {share ? "Approve and write the share pack" : "Approve and export copies"}
              </Button>
              <Button variant="danger" busy={busy === "reject"} disabled={busy !== null} onClick={() => decide("reject")}>
                Reject
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">Only an administrator can approve or reject this proposal.</p>
        ))}
      {error && <Notice className="mt-3">Couldn&apos;t record the decision: {error}</Notice>}

      {canDelete && (
        <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => setConfirm({ kind: "request", withCopies: !!copiesLeft })}>
              Delete this request
            </Button>
            {copiesLeft && (
              <Button variant="secondary" onClick={() => setConfirm({ kind: "copies" })}>
                Delete its copies only
              </Button>
            )}
          </div>
          <p className="text-xs text-muted">
            Deleting removes the request{copiesLeft ? " and, if you choose, the copies VAULT wrote in its export folder" : ""}. Originals are
            never deleted. Every delete is written to the audit log.
          </p>
        </div>
      )}

      {confirm && (
        <ConfirmDelete
          p={p}
          what={confirm}
          folder={folder}
          copies={liveCopies}
          onCancel={() => setConfirm(null)}
          onConfirm={async (what) => {
            await runDelete(what);
            setConfirm(null);
          }}
        />
      )}
    </Panel>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

function ChangeState({ c }: { c: Change }) {
  const map: Record<Change["state"], [string, "neutral" | "green" | "amber" | "red" | "blue"]> = {
    planned: ["Will be copied", "neutral"],
    copied: ["Copied", "green"],
    removed: ["Copy deleted", "neutral"],
    skipped: ["Skipped", "amber"],
    shared: ["Shared, redacted", "blue"],
    left_out: ["Left out", "amber"],
  };
  const [label, tone] = map[c.state];
  return <Tag tone={tone}>{label}</Tag>;
}

/** The confirmation: exactly what goes, and that originals stay. A native modal dialog keeps focus inside. */
function ConfirmDelete({
  p,
  what,
  folder,
  copies,
  onCancel,
  onConfirm,
}: {
  p: Proposal;
  what: Pending;
  folder: string;
  copies: number;
  onCancel: () => void;
  onConfirm: (what: Pending) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [withCopies, setWithCopies] = useState(what.kind === "request" && what.withCopies);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  const name = `${p.kind === "share_pack" ? "share pack" : "proposal"} ${p.id}`;
  const title =
    what.kind === "request" ? `Delete ${name}?` : what.kind === "copies" ? `Delete the copies of ${name}?` : "Delete this copy?";
  const offerCopies = what.kind === "request" && p.status === "executed" && what.withCopies;

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-h"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      className="m-auto w-[min(92vw,520px)] rounded-card border border-line bg-panel p-0 text-ink shadow-lift backdrop:bg-ink/40"
    >
      <div className="p-5">
        <h2 id="confirm-h" className="display text-lg">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted">This will delete:</p>
        <ul className="mt-1 list-disc pl-5 text-sm">
          {what.kind === "request" && (
            <li>
              The request itself (&ldquo;{p.instruction || "no description"}&rdquo;, {p.status === "pending" ? "waiting" : p.status === "executed" ? "approved" : "rejected"}).
            </li>
          )}
          {what.kind === "request" && withCopies && <li>All {formatNumber(copies)} copies in <span className="font-mono text-[13px]">{folder}</span>.</li>}
          {what.kind === "copies" && <li>All {formatNumber(copies)} copies in <span className="font-mono text-[13px]">{folder}</span>. The request stays.</li>}
          {what.kind === "copy" && (
            <li>
              The copy <span className="font-mono text-[13px] break-all">{folder}/{what.target}</span> of {what.filename}.
            </li>
          )}
        </ul>
        {offerCopies && (
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={withCopies} onChange={(e) => setWithCopies(e.target.checked)} />
            <span>Also delete the copies this approval wrote</span>
          </label>
        )}
        <p className="mt-3 rounded-control border border-line border-l-4 border-l-green bg-raised px-3 py-2 text-sm">
          Originals are never deleted. Only copies VAULT itself wrote, inside its own export folder, can be removed. This is written to
          the audit log.
        </p>
        {error && <Notice className="mt-3">Couldn&apos;t delete: {error}</Notice>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button autoFocus disabled={busy} onClick={onCancel}>
            Keep it
          </Button>
          <Button
            variant="danger"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(what.kind === "request" ? { kind: "request", withCopies } : what);
              } catch (e) {
                setError(errorText(e));
                setBusy(false);
              }
            }}
          >
            {what.kind === "copy" ? "Delete copy" : what.kind === "copies" ? "Delete copies" : "Delete request"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
