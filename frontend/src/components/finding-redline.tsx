"use client";

import { useState } from "react";
import type { Evidence, Finding } from "@/lib/api";
import { humanize } from "@/lib/format";
import { cx, Tag, VerifiedMark } from "./ui";

function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function groupByValue(evidence: Evidence[]): { value: number; items: Evidence[] }[] {
  const map = new Map<number, Evidence[]>();
  for (const e of evidence) map.set(e.value, [...(map.get(e.value) ?? []), e]);
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([value, items]) => ({ value, items }));
}

/** Revision triangle, as used on drawings to mark a changed value. */
export function RevMark({ n }: { n: number }) {
  return (
    <svg viewBox="0 0 20 18" className="h-[18px] w-5 shrink-0 text-redline" aria-hidden>
      <path d="M10 1.5 18.5 16.5h-17z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <text x="10" y="14" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor">
        {n}
      </text>
    </svg>
  );
}

/** Mark the conflicting number inside a verbatim quote, like a redline on the drawing. */
function Quote({ quote, value }: { quote: string; value: number }) {
  const needle = formatValue(value);
  const re = new RegExp(`(^|[^\\d.])(${needle.replace(".", "\\.")}(?:\\.0)?(?:\\s*psi)?)(?![\\d])`, "i");
  const m = re.exec(quote);
  if (!m) return <>{quote}</>;
  const start = m.index + m[1].length;
  const end = start + m[2].length;
  return (
    <>
      {quote.slice(0, start)}
      <span className="text-redline underline decoration-redline decoration-wavy decoration-1 underline-offset-[3px]">
        {quote.slice(start, end)}
      </span>
      {quote.slice(end)}
    </>
  );
}

const KIND_TEXT: Record<Finding["kind"], string> = {
  rating_conflict: "Rating conflict",
  part_number_collision: "Part number used by several projects",
};

export function FindingRedline({
  finding,
  onOpenDocument,
  compact,
}: {
  finding: Finding;
  onOpenDocument?: (id: number) => void;
  compact?: boolean;
}) {
  const groups = groupByValue(finding.evidence);
  const [expanded, setExpanded] = useState(false);
  const hidden = groups.reduce((n, g) => n + Math.max(0, g.items.length - 2), 0);
  const docs = new Set(finding.evidence.map((e) => e.document_id)).size;
  return (
    <article className="min-w-0 overflow-hidden rounded-card border border-line border-l-2 border-l-redline bg-panel shadow-panel">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-mono text-[17px] font-medium tracking-tight">{finding.key}</h3>
            <span className="text-sm text-muted">{KIND_TEXT[finding.kind] ?? humanize(finding.kind)}</span>
          </div>
          <p className="mt-1 text-sm">
            {groups.map((g, i) => (
              <span key={g.value}>
                {i > 0 && <span className="text-muted"> vs </span>}
                <span className="font-semibold text-redline tabular-nums">{formatValue(g.value)} psi</span>
              </span>
            ))}
            <span className="text-muted"> across {docs} {docs === 1 ? "document" : "documents"}</span>
          </p>
        </div>
        {finding.status === "verified" ? (
          <Tag tone="green">Every quote verified</Tag>
        ) : (
          <Tag tone="amber">Some quotes need review</Tag>
        )}
      </header>
      {!compact && (
        <div className="grid gap-px bg-line sm:grid-cols-2">
          {groups.map((g, gi) => (
            <section key={g.value} className="min-w-0 bg-panel px-4 py-3">
              <h4 className="flex items-center gap-2 text-sm">
                <RevMark n={gi + 1} />
                <span className="font-semibold text-redline tabular-nums">{formatValue(g.value)} psi</span>
                <span className="text-muted">
                  in {g.items.length} {g.items.length === 1 ? "document" : "documents"}
                </span>
              </h4>
              <ul className="mt-2 flex flex-col gap-2.5 border-l border-redline/60 pl-3">
                {(expanded ? g.items : g.items.slice(0, 2)).map((e, i) => (
                  <li key={`${e.document_id}-${i}`} className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      {onOpenDocument ? (
                        <button
                          className="font-mono text-blue underline-offset-4 hover:underline"
                          onClick={() => onOpenDocument(e.document_id)}
                        >
                          {e.filename}
                        </button>
                      ) : (
                        <span className="font-mono">{e.filename}</span>
                      )}
                      <span className="text-muted">
                        {humanize(e.doc_type)}
                        {e.page != null && `, page ${e.page}`}
                        {e.project && `, project ${e.project.charAt(0).toUpperCase()}${e.project.slice(1)}`}
                      </span>
                    </div>
                    {e.quote ? (
                      <blockquote className={cx("mt-1 break-words font-mono text-[13px] leading-relaxed")}>
                        <Quote quote={e.quote} value={e.value} />
                      </blockquote>
                    ) : (
                      <p className="mt-1 text-xs text-muted">No quote located in the page text.</p>
                    )}
                    <div className="mt-1">
                      <VerifiedMark verified={e.verified} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {!compact && hidden > 0 && (
        <div className="border-t border-line px-4 py-2">
          <button
            className="text-sm font-medium text-blue underline-offset-4 hover:underline"
            aria-expanded={expanded}
            onClick={() => setExpanded((x) => !x)}
          >
            {expanded ? "Show fewer quotes" : `Show ${hidden} more ${hidden === 1 ? "quote" : "quotes"}`}
          </button>
        </div>
      )}
    </article>
  );
}
