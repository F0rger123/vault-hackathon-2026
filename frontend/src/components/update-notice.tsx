"use client";

import { vault } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { cx } from "./ui";

/**
 * F12.14: the version in the side rail, and a Download button when GitHub has a newer release. Downloading is
 * the person's own click, in their browser; VAULT never fetches or runs an installer by itself.
 */
export function UpdateNotice() {
  const info = useLoad("update", vault.update);
  const d = info.data;
  if (!d) return null;
  if (d.newer) {
    const setup = d.files?.find((f) => f.name.endsWith(".exe")) ?? d.files?.[0];
    return (
      <div className="update-in rounded-control border border-green/50 bg-green/5 px-3 py-2.5 text-xs">
        <p className="flex items-center gap-2 font-medium text-ink">
          <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-green" />
          VAULT {d.latest?.replace(/^v/, "")} is out
        </p>
        <p className="mt-0.5 text-muted">You have {d.current}. Your documents and settings stay when you update.</p>
        <a
          href={setup?.url ?? d.page ?? d.releases}
          target="_blank"
          rel="noopener noreferrer"
          className="press mt-2 inline-flex rounded-control bg-ink px-2.5 py-1 font-medium text-paper"
        >
          Download{setup?.size_mb ? ` (${Math.round(setup.size_mb)} MB)` : ""}
        </a>
      </div>
    );
  }
  return (
    <p className={cx("px-1 text-[11px] text-muted")} title={d.error}>
      VAULT {d.current}
      {d.enabled && !d.error ? " · up to date" : ""}
    </p>
  );
}
