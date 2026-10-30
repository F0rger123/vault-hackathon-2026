"use client";

import Link from "next/link";
import { useState } from "react";
import { errorText, vault } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { Button, cx, Notice, Panel } from "./ui";

/** F09.13: a live checklist of VAULT's protections. Each failing check says how to fix it. */
export function SecurityPosture() {
  const data = useLoad("security-posture", vault.securityPosture, 15000);
  const p = data.data;
  const pct = p ? Math.round((p.passed / p.total) * 100) : 0;
  return (
    <Panel title="How protected is this VAULT?" aside={p ? `${p.passed} of ${p.total} checks pass` : undefined}>
      {!p ? (
        <p className="text-sm text-muted">Checking…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <svg viewBox="0 0 36 36" className="h-16 w-16 shrink-0 -rotate-90" aria-hidden>
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--line)" strokeWidth="3" />
              <circle
                cx="18"
                cy="18"
                r="15.9"
                fill="none"
                stroke={pct >= 80 ? "var(--green)" : pct >= 50 ? "var(--amber)" : "var(--redline)"}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${pct} 100`}
                className="transition-[stroke-dasharray] duration-700"
              />
            </svg>
            <p className="text-sm text-muted">
              These are checked live against the real settings. It is a checklist of VAULT&apos;s own controls, not a
              certification. Fix the ones marked below to raise the score.
            </p>
          </div>
          <ul className="grid gap-2 md:grid-cols-2">
            {p.checks.map((c) => (
              <li key={c.id} className={cx("flex gap-2 rounded-control border p-3 text-sm", c.ok ? "border-line" : "border-amber/50 bg-amber/5")}>
                <span aria-hidden className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px]", c.ok ? "bg-green text-paper" : "border border-amber text-amber")}>
                  {c.ok ? "✓" : "!"}
                </span>
                <span>
                  <span className="block font-medium">
                    {c.label}
                    <span className="sr-only">{c.ok ? " (passes)" : " (needs attention)"}</span>
                  </span>
                  <span className="block text-xs text-muted">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/** Files the security gate is holding: nobody reads or downloads them until an administrator releases them. */
export function Quarantine({ isAdmin }: { isAdmin: boolean }) {
  const list = useLoad("quarantine", vault.quarantine);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel title="Held by the security gate" aside={list.data ? `${list.data.length} held` : undefined}>
      <p className="mb-3 text-sm text-muted">
        Files that could run something or reach out when someone opens the original: PDF JavaScript, launch actions,
        embedded files, ActiveX, outside links. No model reads them and nobody can download them until an administrator
        has checked and released them.
      </p>
      {list.data?.length === 0 && <p className="text-sm text-muted">Nothing is held.</p>}
      <ul className="flex flex-col divide-y divide-line text-sm">
        {(list.data ?? []).map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="block font-medium">{d.filename}</span>
              <span className="block text-xs text-muted">
                {d.reason} · added {dateTime(d.created_at)}
              </span>
            </span>
            {isAdmin && (
              <Button
                busy={busy === d.id}
                onClick={async () => {
                  setBusy(d.id);
                  setError(null);
                  try {
                    await vault.releaseDocument(d.id);
                    list.reload();
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                I checked it: release
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && <Notice className="mt-2">{error}</Notice>}
    </Panel>
  );
}

/** A small badge in the side rail: the security score, one click from the Security screen. */
export function PostureBadge() {
  const data = useLoad("security-posture", vault.securityPosture, 30000);
  if (!data.data) return null;
  const { passed, total } = data.data;
  const good = passed / total >= 0.8;
  return (
    <Link href="/security" className="mt-1 flex items-center gap-1.5 text-xs text-muted hover:text-ink">
      <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", good ? "bg-green" : "bg-amber")} />
      Protection: {passed} of {total} checks
    </Link>
  );
}
