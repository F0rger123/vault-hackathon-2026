"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clock, describe, IDLE_AFTER_MS, type LiveFeed } from "@/lib/live-activity";
import { cx } from "./ui";

/**
 * F10.22: the brain's side ticker. It lists, newest first, exactly the recorded rows the brain is drawing, with their
 * time. Rows from before the page opened are shown as "earlier" and never replayed. With no new row for a few seconds
 * it says so plainly.
 */
export function ActivityTicker({
  feed,
  run,
  name,
  reduced,
}: {
  feed: LiveFeed;
  run: string | null;
  name: (documentId: number) => string | undefined;
  reduced: boolean;
}) {
  // Re-render once a second so the live/idle line follows the clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const live = feed.lastNewAt != null && now - feed.lastNewAt < IDLE_AFTER_MS;
  const rows = [...feed.events].reverse();
  const fresh = rows.filter((e) => e.id > feed.liveFrom);
  const earlier = rows.filter((e) => e.id <= feed.liveFrom);

  return (
    <section aria-label="What VAULT is doing" className="flex min-h-0 flex-col gap-2 rounded-control border border-line p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">What VAULT is doing</h3>
        {run && (
          <Link href="/brain" className="text-xs text-muted underline underline-offset-4 hover:text-ink">
            Show everything
          </Link>
        )}
      </div>
      <p role="status" data-live={live ? "live" : "idle"} className="flex items-center gap-2 text-xs">
        <span aria-hidden className={cx("size-2 shrink-0 rounded-full", live ? "bg-green" : "bg-line-strong")} />
        {!feed.loaded
          ? "Reading the activity record"
          : live
            ? `Live: ${describe(feed.events[feed.events.length - 1], name)}`
            : run
              ? "The record of this reply. Idle: nothing else is happening for it right now."
              : "Idle: nothing is happening right now"}
      </p>
      {run && (
        <p className="text-xs text-muted">
          Showing only the helpers&apos; work for one reply ({run}), played once from its record.
        </p>
      )}
      {reduced && <p className="text-xs text-muted">Reduced motion is on, so the brain stays still and this list shows the work.</p>}
      {feed.error && <p className="text-xs text-redline">Could not read the activity record: {feed.error}</p>}
      <ol aria-label="Activity" className="flex max-h-72 min-h-0 flex-col gap-1 overflow-auto lg:max-h-[440px]">
        {fresh.map((e) => (
          <Row key={e.id} text={describe(e, name)} ts={e.ts} action={e.action} />
        ))}
        {earlier.length > 0 && (
          <li className="mt-1 text-[11px] uppercase tracking-wide text-muted">{run ? "Recorded" : "Earlier"}</li>
        )}
        {earlier.map((e) => (
          <Row key={e.id} text={describe(e, name)} ts={e.ts} action={e.action} dim />
        ))}
        {feed.loaded && rows.length === 0 && (
          <li className="text-xs text-muted">Nothing recorded yet. Add files, read them, or ask VAULT a question.</li>
        )}
      </ol>
    </section>
  );
}

function Row({ text, ts, action, dim }: { text: string; ts: number; action: string; dim?: boolean }) {
  return (
    <li data-action={action} className={cx("flex min-w-0 gap-2", dim && "text-muted")}>
      <time className="shrink-0 font-mono text-[11px] leading-5 text-muted">{clock(ts)}</time>
      <span className="min-w-0 break-words leading-5">{text}</span>
    </li>
  );
}
