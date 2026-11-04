"use client";

// F10.25: the brain beside Ask Keeper is the Brain page's own 3D space (brain-space.tsx), not an imitation. What moves
// in it comes from the latest reply only: the activity rows recorded under its run id fly the helpers' craft (once,
// as each row arrives), and its streamed events colour the documents each helper touched and mark the cited ones.
// Nothing moves on a timer. It is mounted only while shown, so hiding it frees the WebGL context and stops polling.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { vault, type TeamHelperId } from "@/lib/api";
import { ASSISTANT_NAME, ASSISTANT_POSSESSIVE } from "@/lib/assistant";
import { HELPER_COLOUR, keeperBrainState } from "@/lib/keeper-brain-state";
import type { HelperState, VaultTurn } from "@/lib/keeper-turn";
import { describe, useActivityFeed } from "@/lib/live-activity";
import { useLoad } from "@/lib/use-load";
import { BrainMap } from "./brain-map";
import { cx, Skeleton } from "./ui";

// three.js loads only when the brain is shown, and only in the browser.
const BrainSpace = dynamic(() => import("./brain-space"), {
  ssr: false,
  loading: () => <Skeleton className="h-[380px] w-full sm:h-[440px]" />,
});

export default function KeeperSpace({ collectionId, turn, onOpen }: { collectionId: number; turn: VaultTurn | null; onOpen: (id: number) => void }) {
  const graph = useLoad(`brain-graph:${collectionId}`, () => vault.brainGraph(collectionId));
  const events = useMemo(() => turn?.events ?? [], [turn]);
  const runOf = events.find((e) => e.type === "start");
  const run = runOf && runOf.type === "start" ? (runOf.run ?? null) : null;
  // Only this reply's recorded rows; polling stops when the brain is hidden (unmounted) or the tab is in the background.
  const feed = useActivityFeed(run ? collectionId : null, run);
  const brain = useMemo(() => keeperBrainState(events, feed.events), [events, feed.events]);
  const { helpers, touched, cited, answer, plan } = brain;
  const lit = useMemo(() => new Map([...brain.lit].map(([d, id]) => [d, HELPER_COLOUR[id].hex])), [brain.lit]);
  const names = useMemo(() => {
    const m = new Map<number, string>();
    for (const n of graph.data?.nodes ?? []) if (n.document_id != null) m.set(n.document_id, n.label);
    return m;
  }, [graph.data]);
  const [failed3d, setFailed3d] = useState(false);
  const idle = !turn;
  const caption = !turn
    ? undefined
    : turn.running
      ? `Live: ${ASSISTANT_POSSESSIVE} reply`
      : answer
        ? `${cited.length} cited document${cited.length === 1 ? "" : "s"} lit`
        : "Record of the latest reply";

  return (
    <section aria-label={`${ASSISTANT_NAME}'s brain`} className="rounded-card border border-line bg-panel shadow-panel" data-run={run ?? undefined}>
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", turn?.running ? "live-dot bg-green" : "bg-line-strong")} />
          Inside the brain
        </h2>
        <span className="text-[11px] text-muted">
          {graph.data ? `${graph.data.documents_total} documents` : "Loading"}
          {turn?.running ? " · working" : idle ? " · waiting for a question" : " · done"}
        </span>
      </header>
      <div className="p-2" data-cited={cited.join(",") || undefined}>
        {graph.data && graph.data.nodes.length > 0 && !failed3d && (
          <BrainSpace
            compact
            graph={graph.data}
            onOpenDocument={onOpen}
            onUnsupported={() => setFailed3d(true)}
            activity={feed.events}
            liveFrom={0}
            highlight={cited}
            lit={lit}
            resetKey={run}
            caption={caption}
          />
        )}
        {graph.data && graph.data.nodes.length > 0 && failed3d && <BrainMap graph={graph.data} onOpenDocument={onOpen} />}
        {graph.data && graph.data.nodes.length === 0 && <p className="p-3 text-sm text-muted">Read the documents first; the brain fills in as VAULT reads.</p>}
        {!graph.data && <Skeleton className="h-[380px] w-full sm:h-[440px]" />}
      </div>

      <div className="border-t border-line px-3 py-2.5 text-xs">
        {idle ? (
          <p className="text-muted">Ask something and watch each helper fly to the documents it really looks at. The cited ones light up when the answer is in.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {[...helpers.values()].map((h) => (
              <HelperLine key={h.plan.id} h={h} count={touched.get(h.plan.id)?.length ?? 0} />
            ))}
            {!plan && <li className="text-muted">{ASSISTANT_NAME} is planning who does what.</li>}
          </ul>
        )}
        {answer && cited.length > 0 && (
          <div className="mt-2 border-t border-line pt-2">
            <p className="mb-1 text-[11px] text-muted">Cited, click to open:</p>
            <ul className="flex flex-wrap gap-1">
              {cited.slice(0, 8).map((d) => (
                <li key={d}>
                  <button
                    type="button"
                    data-cited-doc={d}
                    onClick={() => onOpen(d)}
                    className="press rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-muted hover:border-line-strong hover:text-ink"
                  >
                    {names.get(d) ?? answer.sources?.find((s) => s.document_id === d)?.filename ?? `document ${d}`}
                    {brain.verified.has(d) && <span className="ml-1 text-green" aria-label="verified">✓</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {feed.events.length > 0 && (
          <ol className="mt-2 flex flex-col gap-0.5 border-t border-line pt-2 text-[11px] text-muted" aria-label="Recorded steps for this reply">
            {feed.events.slice(-4).map((e) => (
              <li key={e.id} className="chat-row truncate">
                {describe(e, (id) => names.get(id))}
              </li>
            ))}
          </ol>
        )}
        {run && answer && (
          <Link href={`/brain?run=${encodeURIComponent(run)}`} className="mt-2 inline-block text-[11px] text-muted underline underline-offset-4 hover:text-ink">
            Open this reply on the Brain page
          </Link>
        )}
      </div>
    </section>
  );
}

function HelperLine({ h, count }: { h: HelperState; count: number }) {
  // The Fact checker's craft is white on the black space; on the panel its dot uses the ink colour instead.
  const colour = h.plan.id === "facts" ? "var(--ink)" : (HELPER_COLOUR[h.plan.id as TeamHelperId]?.css ?? "var(--muted)");
  return (
    <li className="flex items-center gap-2" data-helper-line={h.plan.id} data-status={h.status}>
      <span
        aria-hidden
        className={cx("h-2 w-2 shrink-0 rounded-full", h.status === "running" && "live-dot")}
        style={{ background: h.status === "waiting" ? "var(--line-strong)" : h.status === "failed" ? "var(--redline)" : colour }}
      />
      <span className="font-medium">{h.plan.name}</span>
      <span className="min-w-0 flex-1 truncate text-muted">
        {h.status === "waiting" ? "waiting" : h.status === "running" ? "working" : h.status === "failed" ? "could not finish" : count ? `${count} document${count === 1 ? "" : "s"}` : "done"}
      </span>
      {h.duration_ms !== undefined && <span className="font-mono tabular-nums text-muted">{h.duration_ms} ms</span>}
    </li>
  );
}
