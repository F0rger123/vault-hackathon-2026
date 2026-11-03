"use client";

// F10.22: the collection's activity feed, polled while the Brain is open. Every line and every movement in the brain
// comes from one of these recorded rows; when no new row arrives the brain says it is idle instead of looping old ones.

import { useEffect, useRef, useState } from "react";
import { vault, type ActivityEvent } from "./api";

const POLL_MS = 1500;
const KEEP = 200;
export const IDLE_AFTER_MS = 6000;

const EMPTY: LiveFeed = { events: [], liveFrom: 0, lastNewAt: null, loaded: false, error: null };

export interface LiveFeed {
  events: ActivityEvent[];
  /** Rows with an id above this happened after the page opened (or, for a single run, all of them). */
  liveFrom: number;
  /** Browser time of the last new row, for the live/idle line. */
  lastNewAt: number | null;
  loaded: boolean;
  error: string | null;
}

/** Poll the feed every 1.5 s while the tab is visible. With `run`, only that run's rows (the record of one reply). */
export function useActivityFeed(collectionId: number | null | undefined, run: string | null): LiveFeed {
  const key = `${collectionId ?? ""}|${run ?? ""}`;
  const [feed, setFeed] = useState<LiveFeed & { key: string }>({ ...EMPTY, key });
  const cursor = useRef(0);

  useEffect(() => {
    if (collectionId == null) return;
    let stopped = false;
    let busy = false;
    cursor.current = 0;

    const tick = async (first: boolean) => {
      if (busy || stopped || (!first && document.hidden)) return;
      busy = true;
      try {
        const page = await vault.activity(collectionId, cursor.current, { limit: first ? 40 : 200, run });
        if (stopped) return;
        cursor.current = Math.max(cursor.current, page.last_id);
        setFeed((prev) => {
          const f = prev.key === key ? prev : { ...EMPTY, key };
          const known = new Set(f.events.map((e) => e.id));
          const fresh = page.events.filter((e) => !known.has(e.id));
          const events = [...f.events, ...fresh].slice(-KEEP);
          return {
            events,
            // A single run's record is shown once from the start; otherwise only what happens from now on moves.
            liveFrom: first ? (run ? 0 : page.latest_id) : f.liveFrom,
            lastNewAt: fresh.length && (!first || run) ? Date.now() : f.lastNewAt,
            loaded: true,
            error: null,
            key,
          };
        });
      } catch (e) {
        if (!stopped)
          setFeed((prev) => ({ ...(prev.key === key ? prev : { ...EMPTY, key }), loaded: true, error: e instanceof Error ? e.message : String(e) }));
      } finally {
        busy = false;
      }
    };
    void tick(true);
    const timer = window.setInterval(() => void tick(false), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [collectionId, run, key]);

  return feed.key === key ? feed : { ...EMPTY };
}

export function documentIds(e: ActivityEvent): number[] {
  if (e.detail.document_ids?.length) return e.detail.document_ids;
  return e.document_id != null ? [e.document_id] : [];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function actorName(actor: string): string {
  if (actor.startsWith("extractor:")) return `Reader (${actor.slice("extractor:".length)})`;
  if (actor === "reviewer") return "Reviewer";
  if (actor === "security") return "Security gate";
  return actor;
}

/** One recorded row in plain words. `name` turns a document id into its file name when the brain knows it. */
export function describe(e: ActivityEvent, name: (documentId: number) => string | undefined): string {
  const d = e.detail;
  const doc = () => (e.document_id != null ? (d.filename ?? name(e.document_id) ?? `document ${e.document_id}`) : "a file");
  const n = documentIds(e).length;
  const many = d.count != null && d.count > n ? `${d.count}` : `${n}`;
  switch (e.action) {
    case "stored":
      return `Stored ${doc()}${d.status === "quarantined" ? ", held by the security gate" : ""}`;
    case "media_stored":
      return `Stored ${d.media_type?.startsWith("image/") ? "picture" : "media file"} ${doc()}`;
    case "read":
      return `${actorName(e.actor)} read ${doc()}`;
    case "reviewed":
      return `Reviewer checked the reading of ${doc()}`;
    case "held":
      return `Security gate held ${doc()} back from the model`;
    case "flagged":
      return `Security gate flagged instruction-like text in ${doc()}`;
    case "looked_at":
      return `${e.actor} looked at ${plural(Number(many), "document")}${d.words?.length ? ` for "${d.words.join(" ")}"` : ""}`;
    case "sorted":
      return `${e.actor} ranked ${plural(Number(many), "document")} by ${d.sort ?? "order"}${d.order ? `, ${d.order}` : ""}`;
    case "checked_conflicts":
      return `${e.actor} matched ${plural(d.count ?? 0, "recorded conflict")}${d.keys?.length ? ` (${d.keys.slice(0, 3).join(", ")})` : ""} across ${plural(n, "document")}`;
    case "cited":
      return `${e.actor} cited ${plural(n, "document")}${d.by ? ` (written by ${d.by})` : ""}`;
    case "fact_checked":
      return `${e.actor} checked ${d.verified ?? 0} of ${plural(d.cited ?? 0, "cited sentence")} against ${plural(n, "document")}`;
    case "copied":
      return `${e.actor} wrote a copy of ${doc()} to ${d.target ?? "the export folder"}`;
    default:
      return `${actorName(e.actor)} ${e.action.replace(/_/g, " ")} ${doc()}`;
  }
}

export function clock(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Rows a chat helper or the Organizer produced: these move craft in the brain (processing reads have their own). */
export function moves(e: ActivityEvent): boolean {
  return ["looked_at", "sorted", "checked_conflicts", "cited", "fact_checked", "copied", "stored", "media_stored"].includes(
    e.action,
  );
}
