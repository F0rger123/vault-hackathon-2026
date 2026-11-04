"use client";

// F10.23: the brain beside the chat. Every craft, beam and trail here is drawn from what the server sent for the
// latest reply (its NDJSON events) and from the activity rows recorded under that reply's run id (F10.22).
// Nothing moves on its own: with no reply the brain sits still and says so. It is SVG with CSS transitions (no
// WebGL), and it is only mounted while it is shown, so a hidden brain costs nothing.

import Link from "next/link";
import { useMemo } from "react";
import { vault, type ActivityEvent, type TeamEvent, type TeamHelperId } from "@/lib/api";
import { ASSISTANT_NAME } from "@/lib/assistant";
import { describe, documentIds, useActivityFeed } from "@/lib/live-activity";
import { helperStates, type HelperState, type VaultTurn } from "@/lib/keeper-turn";
import { useLoad } from "@/lib/use-load";
import { cx } from "./ui";

const SIZE = 340;
const C = SIZE / 2;
const MAX_NODES = 90;
const LINEUP = 8;

// Recorded activity rows name the helper by its display name.
const ACTOR: Record<string, TeamHelperId> = {
  Finder: "finder",
  Sorter: "sorter",
  "Conflict checker": "conflicts",
  "Answer writer": "answer",
  "Fact checker": "facts",
};
const TONE: Record<TeamHelperId, string> = {
  finder: "var(--green)",
  sorter: "var(--amber)",
  conflicts: "var(--redline)",
  answer: "var(--ink)",
  facts: "var(--green)",
  models: "var(--muted)",
  navigator: "var(--muted)",
};
const SLOT: Record<TeamHelperId, number> = { finder: 0, conflicts: 1, sorter: 2, answer: 3, facts: 4, models: 5, navigator: 6 };

type P = { x: number; y: number };

function hash(n: number): number {
  let h = n * 2654435761;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function slotPoint(id: TeamHelperId, r = 38): P {
  const a = -Math.PI / 2 + SLOT[id] * ((Math.PI * 2) / 7);
  return { x: C + Math.cos(a) * r, y: C + Math.sin(a) * r };
}

export default function KeeperBrain({ collectionId, turn, onOpen }: { collectionId: number; turn: VaultTurn | null; onOpen: (id: number) => void }) {
  const graph = useLoad(`brain-graph:${collectionId}`, () => vault.brainGraph(collectionId));
  const events = useMemo(() => turn?.events ?? [], [turn]);
  const start = events.find((e): e is Extract<TeamEvent, { type: "start" }> => e.type === "start");
  const plan = events.find((e): e is Extract<TeamEvent, { type: "plan" }> => e.type === "plan");
  const answer = events.find((e): e is Extract<TeamEvent, { type: "answer" }> => e.type === "answer");
  const run = start?.run ?? null;
  // Only this reply's recorded rows; polling stops when the brain is hidden (unmounted) or the tab is in the background.
  const feed = useActivityFeed(run ? collectionId : null, run);
  const helpers = useMemo(() => helperStates(events, plan?.helpers ?? []), [events, plan]);

  // Where each document sits: the collection's documents in a golden-angle disc around Keeper.
  const layout = useMemo(() => {
    const docs = (graph.data?.nodes ?? []).filter((n) => n.kind === "document" && n.document_id != null).slice(0, MAX_NODES);
    const at = new Map<number, P & { label: string; conflict: boolean }>();
    docs.forEach((n, i) => {
      const a = i * 2.39996;
      const r = 52 + 112 * Math.sqrt((i + 0.5) / Math.max(docs.length, 1));
      at.set(n.document_id!, { x: C + Math.cos(a) * r, y: C + Math.sin(a) * r, label: n.label, conflict: !!n.conflict });
    });
    return at;
  }, [graph.data]);

  // What each helper really touched: the recorded rows (full lists), else the preview in its finished event.
  const touched = useMemo(() => {
    const out = new Map<TeamHelperId, number[]>();
    for (const e of feed.events as ActivityEvent[]) {
      const id = ACTOR[e.actor];
      if (id) out.set(id, [...new Set([...(out.get(id) ?? []), ...documentIds(e)])]);
    }
    for (const [id, h] of helpers) {
      if (out.has(id) || h.status !== "finished" || !h.result) continue;
      const rows = [...((h.result.documents as { document_id?: number }[]) ?? []), ...((h.result.first as { document_id?: number }[]) ?? [])];
      const ids = rows.map((r) => r.document_id).filter((d): d is number => typeof d === "number");
      if (ids.length) out.set(id, [...new Set(ids)]);
    }
    if (answer?.sources?.length) {
      const cited = [...new Set(answer.sources.map((s) => s.document_id))];
      if (!out.has("answer")) out.set("answer", cited);
      const fromFindings = [...new Set(answer.sources.filter((s) => s.origin === "finding").map((s) => s.document_id))];
      if (!out.has("conflicts") && fromFindings.length) out.set("conflicts", fromFindings);
    }
    if (answer?.rows?.length && !out.has("finder")) out.set("finder", answer.rows.map((r) => r.document_id));
    return out;
  }, [feed.events, helpers, answer]);

  const sorted = helpers.get("sorter")?.status === "finished" ? (touched.get("sorter") ?? []).slice(0, LINEUP) : [];
  const where = (id: number): P => {
    const rank = sorted.indexOf(id);
    if (rank >= 0) return { x: SIZE - 34, y: 34 + rank * 28 };
    const p = layout.get(id);
    if (p) return p;
    const a = hash(id) * Math.PI * 2;
    return { x: C + Math.cos(a) * 150, y: C + Math.sin(a) * 150 };
  };

  const cited = answer ? [...new Set((answer.sources ?? []).map((s) => s.document_id).concat((answer.rows ?? []).slice(0, 12).map((r) => r.document_id)))] : [];
  const verifiedDocs = new Set<number>();
  if (answer?.sentences && answer.sources) {
    const byId = new Map(answer.sources.map((s) => [s.id, s.document_id]));
    for (const s of answer.sentences) if (s.verified) for (const n of s.sources) if (byId.has(n)) verifiedDocs.add(byId.get(n)!);
  } else if (helpers.get("facts")?.status === "finished") for (const d of touched.get("facts") ?? []) verifiedDocs.add(d);

  const lit = new Map<number, TeamHelperId>();
  for (const [id, docs] of touched) for (const d of docs.slice(0, 24)) if (!lit.has(d) || id === "conflicts") lit.set(d, id);
  const extra = [...new Set([...touched.values()].flat())].filter((d) => !layout.has(d)).slice(0, 30);
  const crafts = [...helpers.values()].filter((h) => h.status !== "waiting");
  // File names the reply itself carried, for documents the map does not show.
  const names = new Map<number, string>();
  for (const r of answer?.rows ?? []) names.set(r.document_id, r.filename);
  for (const src of answer?.sources ?? []) names.set(src.document_id, src.filename);
  for (const h of helpers.values()) {
    const rows = [...((h.result?.documents as { document_id?: number; filename?: string }[]) ?? []), ...((h.result?.first as { document_id?: number; filename?: string }[]) ?? [])];
    for (const r of rows) if (typeof r.document_id === "number" && r.filename) names.set(r.document_id, r.filename);
  }
  const nameOf = (id: number) => layout.get(id)?.label ?? names.get(id) ?? `document ${id}`;
  // Once the answer is in, the helpers dock under Keeper in two columns, so their labels never overlap.
  const dock = (h: HelperState): P => {
    const k = crafts.indexOf(h);
    return { x: C + (k % 2 ? 46 : -46), y: C + 44 + Math.floor(k / 2) * 17 };
  };
  const idle = !turn;

  return (
    <section aria-label={`${ASSISTANT_NAME}'s brain`} className="rounded-card border border-line bg-panel shadow-panel">
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
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block h-auto w-full" role="img" aria-label="The documents each helper looked at for the latest reply">
        <defs>
          <radialGradient id="kb-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--green)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Rings, like a drawing's grid. */}
        {[60, 110, 160].map((r) => (
          <circle key={r} cx={C} cy={C} r={r} fill="none" stroke="var(--line)" strokeDasharray="2 4" />
        ))}

        {/* Beams: helper to each document it reported touching. Drawn when the helper's work is in. */}
        {crafts.map((h) => {
          const docs = (touched.get(h.plan.id) ?? []).slice(0, 12);
          if (h.status !== "finished" || !docs.length || answer) return null;
          const from = craftPoint(h, docs, where);
          return docs.map((d) => {
            const to = where(d);
            return (
              <line
                key={`${h.plan.id}-${d}`}
                className="kb-beam"
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={TONE[h.plan.id]}
                strokeOpacity="0.55"
                strokeWidth="0.9"
              />
            );
          });
        })}

        {/* Pulling back: once the answer is written, a trail runs from each source to Keeper. */}
        {answer &&
          cited.map((d, i) => {
            const p = where(d);
            return (
              <path
                key={`trail-${d}`}
                className="kb-trail"
                d={`M${p.x} ${p.y} Q${(p.x + C) / 2 + (p.y - C) * 0.18} ${(p.y + C) / 2 - (p.x - C) * 0.18} ${C} ${C}`}
                fill="none"
                stroke="var(--green)"
                strokeWidth="1.1"
                style={{ animationDelay: `${Math.min(i, 12) * 60}ms` }}
              />
            );
          })}

        {/* The Sorter's line-up gets a quiet backdrop so the ranked names read clearly. */}
        {sorted.length > 0 && <rect className="kb-rank" x={SIZE - 150} y={20} width={142} height={sorted.length * 28 + 4} rx={6} fill="var(--panel)" fillOpacity="0.88" stroke="var(--line)" />}
        {/* The documents. */}
        {[...layout.keys()].map((id) => (
          <DocDot key={id} id={id} p={where(id)} label={nameOf(id)} lit={lit.get(id)} verified={verifiedDocs.has(id)} rank={sorted.indexOf(id)} onOpen={onOpen} />
        ))}
        {extra.map((id) => (
          <DocDot key={id} id={id} p={where(id)} label={nameOf(id)} lit={lit.get(id)} verified={verifiedDocs.has(id)} rank={sorted.indexOf(id)} onOpen={onOpen} />
        ))}

        {/* Keeper at the centre. A ring goes out when the plan is made and when the answer comes back. */}
        <circle cx={C} cy={C} r={34} fill="url(#kb-core)" opacity={turn?.running || answer ? 1 : 0.4} />
        {plan && <circle key={`plan-${plan.t_ms}-${run}`} className="kb-ring" cx={C} cy={C} r={18} fill="none" stroke="var(--green)" />}
        {answer && <circle key={`ans-${answer.t_ms}-${run}`} className="kb-ring kb-ring-late" cx={C} cy={C} r={18} fill="none" stroke="var(--ink)" />}
        <circle cx={C} cy={C} r={15} fill="var(--panel)" stroke="var(--ink)" strokeWidth="1.4" />
        <text x={C} y={C + 3.5} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--ink)" style={{ fontFamily: "var(--font-data), monospace" }}>
          {ASSISTANT_NAME.slice(0, 1)}
        </text>
        <text x={C} y={C + 28} textAnchor="middle" fontSize="8.5" fill="var(--muted)">
          {ASSISTANT_NAME}
        </text>

        {/* The helpers, as labelled craft. */}
        {crafts.map((h) => {
          const docs = touched.get(h.plan.id) ?? [];
          const p = answer ? dock(h) : craftPoint(h, docs, where);
          const w = h.plan.name.length * 4.6 + 12;
          return (
            <g
              key={h.plan.id}
              className={cx("kb-craft", h.status === "running" && "kb-craft-run")}
              data-craft={h.plan.id}
              data-status={h.status}
              style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
            >
              <rect x={-w / 2} y={-7} width={w} height={14} rx={7} fill="var(--panel)" stroke={TONE[h.plan.id]} strokeWidth="1.2" />
              <text y={3} textAnchor="middle" fontSize="7.5" fill="var(--ink)">
                {h.plan.name}
              </text>
              {h.status === "failed" && <circle cx={w / 2} cy={-7} r={3} fill="var(--redline)" />}
            </g>
          );
        })}
      </svg>

      <div className="border-t border-line px-3 py-2.5 text-xs">
        {idle ? (
          <p className="text-muted">Ask something and watch each helper fly to the documents it really looks at, then bring the answer back to {ASSISTANT_NAME}.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {[...helpers.values()].map((h) => (
              <HelperLine key={h.plan.id} h={h} count={touched.get(h.plan.id)?.length ?? 0} />
            ))}
            {!plan && <li className="text-muted">{ASSISTANT_NAME} is planning who does what.</li>}
          </ul>
        )}
        {feed.events.length > 0 && (
          <ol className="mt-2 flex flex-col gap-0.5 border-t border-line pt-2 text-[11px] text-muted" aria-label="Recorded steps for this reply">
            {feed.events.slice(-4).map((e) => (
              <li key={e.id} className="chat-row truncate">
                {describe(e, (id) => layout.get(id)?.label)}
              </li>
            ))}
          </ol>
        )}
        {run && answer && (
          <Link href={`/brain?run=${encodeURIComponent(run)}`} className="mt-2 inline-block text-[11px] text-muted underline underline-offset-4 hover:text-ink">
            Replay this reply in the 3D brain
          </Link>
        )}
      </div>
    </section>
  );
}

function craftPoint(h: HelperState, docs: number[], where: (id: number) => P): P {
  if (h.status !== "finished" || !docs.length) return slotPoint(h.plan.id);
  const some = docs.slice(0, 6).map(where);
  const x = some.reduce((s, p) => s + p.x, 0) / some.length;
  const y = some.reduce((s, p) => s + p.y, 0) / some.length;
  // Hang just inside the documents, so the label does not cover them.
  return { x: C + (x - C) * 0.72, y: C + (y - C) * 0.72 - 10 };
}

function DocDot({
  id,
  p,
  label,
  lit,
  verified,
  rank,
  onOpen,
}: {
  id: number;
  p: P;
  label: string;
  lit: TeamHelperId | undefined;
  verified: boolean;
  rank: number;
  onOpen: (id: number) => void;
}) {
  return (
    <g className="kb-doc" style={{ transform: `translate(${p.x}px, ${p.y}px)` }} data-doc={id} data-lit={lit}>
      <title>{label}</title>
      <circle
        r={lit ? 4.2 : 2.2}
        fill={lit ? TONE[lit] : "var(--line-strong)"}
        className={cx(lit && "kb-hit")}
        onClick={() => onOpen(id)}
        style={{ cursor: "pointer" }}
      />
      {rank >= 0 && (
        <text x={-9} y={3} textAnchor="end" fontSize="7.5" fill="var(--muted)" className="kb-rank">
          {rank + 1}. {label.length > 22 ? `${label.slice(0, 21)}…` : label}
        </text>
      )}
      {verified && <path className="tick-draw" d="M3.5 -6.5 l1.6 1.6 3 -3.4" fill="none" stroke="var(--green)" strokeWidth="1.3" strokeLinecap="round" />}
    </g>
  );
}

function HelperLine({ h, count }: { h: HelperState; count: number }) {
  return (
    <li className="flex items-center gap-2" data-helper-line={h.plan.id}>
      <span
        aria-hidden
        className={cx("h-2 w-2 shrink-0 rounded-full", h.status === "running" && "live-dot")}
        style={{ background: h.status === "waiting" ? "var(--line-strong)" : h.status === "failed" ? "var(--redline)" : TONE[h.plan.id] }}
      />
      <span className="font-medium">{h.plan.name}</span>
      <span className="min-w-0 flex-1 truncate text-muted">
        {h.status === "waiting" ? "waiting" : h.status === "running" ? "working" : h.status === "failed" ? "could not finish" : count ? `${count} document${count === 1 ? "" : "s"}` : "done"}
      </span>
      {h.duration_ms !== undefined && <span className="font-mono tabular-nums text-muted">{h.duration_ms} ms</span>}
    </li>
  );
}
