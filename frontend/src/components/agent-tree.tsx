"use client";

import type { AgentPlan } from "@/lib/api";

const MAX_LANES = 6;

/**
 * F10.15: who would work on this computer, drawn from the real capacity plan. The coordinator delegates to the
 * security gate, one lane per model copy (each with its reader slots), and the reviewer. It builds itself top down.
 */
export function AgentTree({ plan }: { plan: AgentPlan }) {
  const shown = plan.lanes.slice(0, MAX_LANES);
  const hidden = plan.lanes.length - shown.length;
  // Plain timing from each item's position, so the tree builds in the same order on every render.
  const laneAt = (i: number) => 900 + i * 280;
  const end = laneAt(shown.length);
  return (
    <figure className="mt-6" aria-label={plan.summary}>
      <figcaption className="tree-in mb-4 text-[15px] font-medium" style={{ animationDelay: "200ms" }}>
        {plan.summary}
      </figcaption>
      <div className="flex flex-col items-center gap-0">
        <div className="tree-in rounded-control bg-accent px-4 py-1.5 text-sm font-semibold text-on-accent" style={{ animationDelay: "400ms" }}>
          Coordinator
        </div>
        <span aria-hidden className="tree-stem h-4 w-px bg-line-strong" style={{ animationDelay: "550ms" }} />
        <div className="tree-branch flex w-full flex-wrap justify-center gap-2 border-t border-line-strong pt-3" style={{ animationDelay: "650ms" }}>
          <div className="tree-in rounded-control border border-line px-3 py-2 text-xs" style={{ animationDelay: "750ms" }}>
            Security gate
          </div>
          {shown.map((lane, l) => (
            <div key={lane.name} className="tree-in flex flex-col gap-1.5 rounded-control border border-line px-3 py-2 text-xs" style={{ animationDelay: `${laneAt(l)}ms` }}>
              <span className="font-medium">{lane.name}</span>
              <span className="grid grid-cols-4 gap-1" aria-label={`${lane.slots} readers`}>
                {Array.from({ length: Math.min(lane.slots, 8) }, (_, i) => (
                  <span key={i} aria-hidden className="slot-pop h-2 w-2 rounded-full bg-accent" style={{ animationDelay: `${laneAt(l) + 120 + i * 45}ms` }} />
                ))}
              </span>
              <span className="text-muted">{lane.slots} readers</span>
            </div>
          ))}
          {hidden > 0 && (
            <div className="tree-in grid place-items-center rounded-control border border-dashed border-line-strong px-3 py-2 text-xs text-muted" style={{ animationDelay: `${end}ms` }}>
              +{hidden} more lanes
            </div>
          )}
          <div className="tree-in rounded-control border border-line px-3 py-2 text-xs" style={{ animationDelay: `${end + 100}ms` }}>
            Reviewer
          </div>
        </div>
      </div>
      <p className="tree-in mt-4 text-xs text-muted" style={{ animationDelay: `${end + 300}ms` }}>
        This is the most this computer should run, estimated from its memory. VAULT measures real speed before a big run,
        and often uses fewer readers.
      </p>
    </figure>
  );
}
