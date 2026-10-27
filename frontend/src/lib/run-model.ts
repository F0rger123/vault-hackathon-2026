// Turns the raw agent event stream of a run into the shape the live board draws.

import type { AgentEvent, Job } from "./api";
import { humanize, laneLabel, laneProvider, statusText } from "./format";

export interface LanePlan {
  lane: string;
  model: string | null;
  locality: "local" | "remote" | null;
  slots: number;
  escalation?: boolean;
  blocked?: string;
}

export interface SlotState {
  last: AgentEvent | null;
  count: number;
}

export interface LaneState extends LanePlan {
  provider: string;
  extracted: number;
  retries: number;
  slotStates: SlotState[];
  lastEventId: number;
  extractTimes: number[];
}

export interface RunModel {
  planned: boolean;
  lanes: LaneState[];
  security: {
    screened: number | null;
    restricted: number;
    internal: number;
    injection: number;
    pinned: AgentEvent[];
    blocked: AgentEvent[];
    lastEventId: number;
  };
  review: {
    accepted: number;
    escalated: number;
    human: number;
    findings: number | null;
    recentHuman: AgentEvent[];
    lastEventId: number;
  };
  coordinatorLastId: number;
  finish: AgentEvent | null;
  lastExtractTs: number | null;
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

export function buildModel(job: Job | undefined, events: AgentEvent[]): RunModel {
  const plan = events.find((e) => e.agent === "coordinator" && e.action === "plan");
  const lanesPlan: LanePlan[] = [];
  if (plan) {
    const ls = (plan.detail.lanes as { lane: string; model: string; locality: "local" | "remote"; slots: number }[]) ?? [];
    for (const l of ls) lanesPlan.push({ lane: l.lane, model: l.model, locality: l.locality, slots: l.slots });
    const esc = plan.detail.escalation as string | null;
    if (esc) lanesPlan.push({ lane: esc, model: null, locality: null, slots: 1, escalation: true });
  } else if (job) {
    const specs = job.params.lanes ?? (job.params.provider ? [{ provider: job.params.provider, concurrency: job.workers }] : []);
    specs.forEach((s, i) =>
      lanesPlan.push({ lane: `${s.provider}#${i + 1}`, model: null, locality: null, slots: s.concurrency }),
    );
    if (job.params.escalate_provider)
      lanesPlan.push({ lane: `${job.params.escalate_provider}#escalation`, model: null, locality: null, slots: 1, escalation: true });
  }
  for (const e of events) {
    if (e.agent === "coordinator" && (e.action === "lane.blocked" || e.action === "lane.unavailable")) {
      const name = String(e.detail.lane ?? "");
      const existing = lanesPlan.find((l) => l.lane === name);
      const reason = String(e.detail.reason ?? "not available");
      if (existing) existing.blocked = reason;
      else
        lanesPlan.push({
          lane: name,
          model: null,
          locality: null,
          slots: 0,
          blocked: reason,
          escalation: name.endsWith("#escalation"),
        });
    }
  }

  const lanes: LaneState[] = lanesPlan.map((l) => ({
    ...l,
    provider: laneProvider(l.lane),
    extracted: 0,
    retries: 0,
    slotStates: Array.from({ length: Math.max(l.slots, 0) }, () => ({ last: null, count: 0 })),
    lastEventId: 0,
    extractTimes: [],
  }));
  const byName = new Map(lanes.map((l) => [l.lane, l]));

  const model: RunModel = {
    planned: !!plan,
    lanes,
    security: { screened: null, restricted: 0, internal: 0, injection: 0, pinned: [], blocked: [], lastEventId: 0 },
    review: { accepted: 0, escalated: 0, human: 0, findings: null, recentHuman: [], lastEventId: 0 },
    coordinatorLastId: 0,
    finish: null,
    lastExtractTs: null,
  };

  for (const e of events) {
    if (e.agent === "coordinator") {
      model.coordinatorLastId = e.id;
      if (e.action === "finish") model.finish = e;
    } else if (e.agent === "security") {
      model.security.lastEventId = e.id;
      if (e.action === "screening.summary") {
        model.security.screened = num(e.detail.screened);
        model.security.restricted = num(e.detail.restricted);
        model.security.internal = num(e.detail.internal);
        model.security.injection = num(e.detail.injection);
      } else if (e.action === "route.local_only") model.security.pinned.push(e);
      else if (e.action === "route.blocked") model.security.blocked.push(e);
    } else if (e.agent.startsWith("extractor:")) {
      const name = e.agent.slice("extractor:".length);
      let lane = byName.get(name);
      if (!lane) {
        lane = {
          lane: name,
          model: null,
          locality: null,
          slots: 1,
          provider: laneProvider(name),
          extracted: 0,
          retries: 0,
          slotStates: [{ last: null, count: 0 }],
          lastEventId: 0,
          extractTimes: [],
          escalation: name.endsWith("#escalation"),
        };
        lanes.push(lane);
        byName.set(name, lane);
      }
      lane.lastEventId = e.id;
      if (e.action === "extract") {
        // Events do not say which slot did the work; documents are shown filling slots in turn.
        const slots = lane.slotStates.length || 1;
        if (!lane.slotStates.length) lane.slotStates.push({ last: null, count: 0 });
        const s = lane.slotStates[lane.extracted % slots];
        s.last = e;
        s.count += 1;
        lane.extracted += 1;
        lane.extractTimes.push(e.ts);
        model.lastExtractTs = e.ts;
      } else if (e.action === "extract.retry") lane.retries += 1;
    } else if (e.agent === "reviewer") {
      model.review.lastEventId = e.id;
      if (e.action === "escalate") model.review.escalated += 1;
      else if (e.action === "findings.analyse") model.review.findings = num(e.detail.findings);
      else if (e.action === "review") {
        const d = e.detail.decision;
        if (d === "accepted") model.review.accepted += 1;
        else if (d === "needs_human_review") {
          model.review.human += 1;
          model.review.recentHuman.push(e);
        }
      }
    }
  }
  return model;
}

/** Documents per minute over the trailing minute (or the whole span if shorter). */
export function docsPerMinute(times: number[], end: number, windowS = 60): number | null {
  if (!times.length) return null;
  const start = Math.max(end - windowS, times[0]);
  const span = end - start;
  if (span < 3) return null;
  const n = times.filter((t) => t >= start && t <= end).length;
  return (n / span) * 60;
}

export type EventTone = "neutral" | "security" | "problem" | "denied" | "good";

export function eventTone(e: AgentEvent): EventTone {
  if (e.outcome === "denied") return "denied";
  if (e.outcome === "error") return "problem";
  if (e.agent === "security") return "security";
  if (e.agent === "reviewer" && e.detail.decision === "accepted") return "good";
  return "neutral";
}

export function agentName(agent: string): string {
  if (agent.startsWith("extractor:")) return laneLabel(agent.slice("extractor:".length));
  return humanize(agent);
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

/** One plain-English sentence per event. */
export function describeEvent(e: AgentEvent, file: (id: number | null) => string): string {
  const d = e.detail;
  const f = file(e.document_id);
  if (e.agent === "coordinator") {
    switch (e.action) {
      case "plan": {
        const ls = (d.lanes as { lane: string; model: string; locality: string; slots: number }[]) ?? [];
        const parts = ls.map(
          (l) =>
            `${laneLabel(l.lane)} runs ${l.model} ${l.locality === "local" ? "on this machine" : "on a remote service"} with ${l.slots} ${l.slots === 1 ? "slot" : "slots"}`,
        );
        const esc = d.escalation ? ` Unclear results go to the ${laneLabel(String(d.escalation)).toLowerCase()}.` : " No escalation lane.";
        return `Coordinator planned the run. ${parts.join("; ")}.${esc}`;
      }
      case "lane.blocked":
        return `Coordinator blocked ${laneLabel(String(d.lane))} (${laneProvider(String(d.lane))}): ${d.reason}.`;
      case "lane.unavailable":
        return `Coordinator could not start ${laneLabel(String(d.lane))} (${laneProvider(String(d.lane))}): ${d.reason}.`;
      case "reconcile":
        return `Coordinator marked ${d.lost} unfinished documents as failed so the totals add up.`;
      case "finish":
        return `Run finished: ${statusText(d.status as Job["status"]).toLowerCase()}, ${d.done} done, ${d.failed} failed.`;
    }
  }
  if (e.agent === "security") {
    switch (e.action) {
      case "route.local_only": {
        const reasons = [...list(d.markings), ...(list(d.pii).length ? [`personal data (${list(d.pii).join(", ")})`] : [])];
        return `Security pinned ${f} to local lanes: ${reasons.length ? reasons.join(", ") : "sensitive content"}.`;
      }
      case "route.blocked":
        return `Security blocked ${f}: ${d.reason}.`;
      case "screening.summary":
        return `Security screened ${d.screened} documents: ${d.restricted} restricted, ${d.internal} internal, ${d.injection} with instruction-like text.`;
    }
  }
  if (e.agent.startsWith("extractor:")) {
    const lane = laneLabel(e.agent.slice("extractor:".length));
    if (e.action === "extract") {
      const secs = (num(d.ms) / 1000).toFixed(1);
      const ex = num(d.examples);
      return `${lane} read ${f} as ${humanize(String(d.doc_type ?? "")).toLowerCase()} in ${secs} s${ex ? `, guided by ${ex} ${ex === 1 ? "example" : "examples"}` : ""}.`;
    }
    if (e.action === "extract.retry") return `${lane} is retrying ${f} (attempt ${d.attempt}): ${d.reason}.`;
  }
  if (e.agent === "reviewer") {
    if (e.action === "review") {
      if (d.decision === "accepted") return `Reviewer accepted ${f}.`;
      const reasons = list(d.reasons);
      return `Reviewer flagged ${f} for a person${reasons.length ? `: ${reasons.join("; ")}` : ""}.`;
    }
    if (e.action === "escalate")
      return `Reviewer sent ${f} to the ${laneLabel(String(d.to)).toLowerCase()}${list(d.reasons).length ? `: ${list(d.reasons).join("; ")}` : ""}.`;
    if (e.action === "findings.analyse")
      return `Reviewer cross-checked the collection and recorded ${d.findings} ${d.findings === 1 ? "finding" : "findings"}.`;
  }
  return `${agentName(e.agent)}: ${humanize(e.action)} (${e.outcome}).`;
}
