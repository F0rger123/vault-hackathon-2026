import type { TeamEvent, TeamHelperId, TeamHelperPlan } from "./api";

/** F10.23: one Keeper reply in the chat, as the events the server streamed for it. Shared by the chat and its brain. */
export type VaultTurn = {
  id: number;
  who: "vault";
  events: TeamEvent[];
  running: boolean;
  error?: string;
  vote?: -1 | 0 | 1;
  /** Set for replies that happened on this page, so only those play their entrance. */
  live?: boolean;
};

export interface HelperState {
  plan: TeamHelperPlan;
  status: "waiting" | "running" | "finished" | "failed";
  thread?: string;
  progress: string[];
  duration_ms?: number;
  summary?: string;
  result?: Record<string, unknown>;
  detail?: string;
  started_ms?: number;
}

/** Each planned helper's state, folded from its real events in arrival order. */
export function helperStates(events: TeamEvent[], helpers: TeamHelperPlan[]): Map<TeamHelperId, HelperState> {
  const out = new Map<TeamHelperId, HelperState>(helpers.map((h) => [h.id, { plan: h, status: "waiting", progress: [] }]));
  for (const ev of events) {
    if (ev.type !== "helper") continue;
    const h = out.get(ev.id);
    if (!h) continue;
    if (ev.status === "started") Object.assign(h, { status: "running", thread: ev.thread, started_ms: ev.t_ms });
    else if (ev.status === "progress" && ev.text) h.progress.push(ev.text);
    else if (ev.status === "finished") Object.assign(h, { status: "finished", duration_ms: ev.duration_ms, summary: ev.summary, result: ev.result });
    else if (ev.status === "failed") Object.assign(h, { status: "failed", duration_ms: ev.duration_ms, detail: ev.detail });
  }
  return out;
}
