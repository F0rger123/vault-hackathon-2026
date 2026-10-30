// Turns recorded agent events into "who touched which document". Only real events produce activity, so anything drawn
// from this shows work that happened: live during a run, or replayed from the record afterwards.

import type { AgentEvent } from "./api";

export type Worker = "coordinator" | "security" | "reviewer" | `reader:${string}`;

export interface Activity {
  id: number;
  ts: number;
  worker: Worker;
  verb: "planned" | "screened" | "read" | "retried" | "reviewed" | "finished";
  document_id: number | null;
  /** The lane for a reader. */
  lane?: string;
}

export function activityOf(e: AgentEvent): Activity | null {
  const base = { id: e.id, ts: e.ts, document_id: e.document_id };
  if (e.agent === "coordinator" && e.action === "plan") return { ...base, worker: "coordinator", verb: "planned" };
  if (e.agent === "coordinator" && e.action === "finish") return { ...base, worker: "coordinator", verb: "finished" };
  if (e.agent === "security" && e.document_id != null) return { ...base, worker: "security", verb: "screened" };
  if (e.agent.startsWith("extractor:") && (e.action === "extract" || e.action === "extract.retry")) {
    const lane = e.agent.slice("extractor:".length);
    return { ...base, worker: `reader:${lane}`, verb: e.action === "extract" ? "read" : "retried", lane };
  }
  if (e.agent === "reviewer" && e.action === "review") return { ...base, worker: "reviewer", verb: "reviewed" };
  return null;
}

/** Plays activity at a steady pace: live events at once, a finished run compressed into `seconds`. */
export function replayDelays(items: Activity[], seconds: number): number[] {
  if (items.length < 2) return items.map(() => 0);
  const first = items[0].ts;
  const span = Math.max(items[items.length - 1].ts - first, 0.001);
  return items.map((a) => ((a.ts - first) / span) * seconds * 1000);
}

/** Readers per lane, from the coordinator's plan, so an agent is never named beyond what really ran. */
export function laneSlots(events: AgentEvent[]): Map<string, number> {
  const plan = events.find((e) => e.agent === "coordinator" && e.action === "plan");
  const lanes = (plan?.detail.lanes as { lane: string; slots: number }[] | undefined) ?? [];
  return new Map(lanes.map((l) => [l.lane, Math.max(1, l.slots)]));
}
