import type { ActivityEvent, TeamEvent, TeamHelperId } from "./api";
import { helperStates, type HelperState } from "./keeper-turn";
import { documentIds } from "./live-activity";

// F10.25: what one Keeper reply did to the collection, folded from its streamed events and the activity rows recorded
// under its run id. Moved out of the old SVG brain so the 3D brain beside the chat reads exactly the same facts.

/** Recorded activity rows name the helper by its display name. */
export const HELPER_BY_ACTOR: Record<string, TeamHelperId> = {
  Finder: "finder",
  Sorter: "sorter",
  "Conflict checker": "conflicts",
  "Answer writer": "answer",
  "Fact checker": "facts",
  Classifier: "classifier",
};

/** Each helper's colour, as CSS for the list and as a hex number for its craft in the 3D brain. */
export const HELPER_COLOUR: Record<TeamHelperId, { css: string; hex: number }> = {
  finder: { css: "#00e676", hex: 0x00e676 },
  conflicts: { css: "#ff5252", hex: 0xff5252 },
  sorter: { css: "#ffb300", hex: 0xffb300 },
  answer: { css: "#64b5f6", hex: 0x64b5f6 },
  facts: { css: "#f5f5f5", hex: 0xf5f5f5 },
  models: { css: "#9e9e9e", hex: 0x9e9e9e },
  navigator: { css: "#9e9e9e", hex: 0x9e9e9e },
  classifier: { css: "#ce93d8", hex: 0xce93d8 },
};

type Ev<K extends TeamEvent["type"]> = Extract<TeamEvent, { type: K }>;

export interface KeeperBrainState {
  run: string | null;
  plan: Ev<"plan"> | undefined;
  answer: Ev<"answer"> | undefined;
  helpers: Map<TeamHelperId, HelperState>;
  /** What each helper really touched: the recorded rows (full lists), else the preview in its finished event. */
  touched: Map<TeamHelperId, number[]>;
  /** Documents the answer cites (and its first rows for a list), once the answer is in. */
  cited: number[];
  /** Cited documents behind a sentence the Fact checker verified. */
  verified: Set<number>;
  /** Each touched document and the helper whose colour it takes (the Conflict checker wins). */
  lit: Map<number, TeamHelperId>;
}

export function keeperBrainState(events: TeamEvent[], rows: ActivityEvent[]): KeeperBrainState {
  const start = events.find((e): e is Ev<"start"> => e.type === "start");
  const plan = events.find((e): e is Ev<"plan"> => e.type === "plan");
  const answer = events.find((e): e is Ev<"answer"> => e.type === "answer");
  const helpers = helperStates(events, plan?.helpers ?? []);

  const touched = new Map<TeamHelperId, number[]>();
  for (const e of rows) {
    const id = HELPER_BY_ACTOR[e.actor];
    if (id) touched.set(id, [...new Set([...(touched.get(id) ?? []), ...documentIds(e)])]);
  }
  for (const [id, h] of helpers) {
    if (touched.has(id) || h.status !== "finished" || !h.result) continue;
    const list = [...((h.result.documents as { document_id?: number }[]) ?? []), ...((h.result.first as { document_id?: number }[]) ?? [])];
    const ids = list.map((r) => r.document_id).filter((d): d is number => typeof d === "number");
    if (ids.length) touched.set(id, [...new Set(ids)]);
  }
  if (answer?.sources?.length) {
    const sourced = [...new Set(answer.sources.map((s) => s.document_id))];
    if (!touched.has("answer")) touched.set("answer", sourced);
    const fromFindings = [...new Set(answer.sources.filter((s) => s.origin === "finding").map((s) => s.document_id))];
    if (!touched.has("conflicts") && fromFindings.length) touched.set("conflicts", fromFindings);
  }
  if (answer?.rows?.length && !touched.has("finder")) touched.set("finder", answer.rows.map((r) => r.document_id));

  const cited = answer
    ? [...new Set((answer.sources ?? []).map((s) => s.document_id).concat((answer.rows ?? []).slice(0, 12).map((r) => r.document_id)))]
    : [];
  const verified = new Set<number>();
  if (answer?.sentences && answer.sources) {
    const byId = new Map(answer.sources.map((s) => [s.id, s.document_id]));
    for (const s of answer.sentences) if (s.verified) for (const n of s.sources) if (byId.has(n)) verified.add(byId.get(n)!);
  } else if (helpers.get("facts")?.status === "finished") for (const d of touched.get("facts") ?? []) verified.add(d);

  const lit = new Map<number, TeamHelperId>();
  for (const [id, docs] of touched) for (const d of docs.slice(0, 24)) if (!lit.has(d) || id === "conflicts") lit.set(d, id);

  return { run: start?.run ?? null, plan, answer, helpers, touched, cited, verified, lit };
}
