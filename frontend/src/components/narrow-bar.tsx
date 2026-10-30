"use client";

import { useState } from "react";
import type { SearchResult } from "@/lib/api";
import { humanize } from "@/lib/format";
import { cx, inputClass } from "./ui";

export interface NarrowQuery {
  q: string;
  doc_type: string;
  project: string;
  part_number: string;
  exclude: string;
  year: string;
  media: string;
}

/**
 * Turn "only inspection reports from 2023 about Alpha without FAIL" into filters, using the collection's own
 * document types and projects. Runs in the browser; nothing is sent anywhere.
 */
export function parseNarrowing(text: string, types: string[], projects: string[]): Partial<NarrowQuery> {
  const t = ` ${text.toLowerCase()} `;
  const out: Partial<NarrowQuery> = {};
  const type = types.find((d) => t.includes(d.replace(/_/g, " ")) || t.includes(d.replace(/_/g, " ").replace(/s?$/, "s")));
  if (type) out.doc_type = type;
  const project = projects.find((p) => new RegExp(`\\b${p.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t));
  if (project) out.project = project;
  const year = t.match(/\b(19|20)\d{2}\b/);
  if (year) out.year = year[0];
  if (/\b(photos?|pictures?|images?)\b/.test(t)) out.media = "image";
  else if (/\bdocuments? only\b|\bno (photos|pictures|images)\b/.test(t)) out.media = "document";
  const without = [...t.matchAll(/\b(?:without|not|except|excluding|leave out)\s+("([^"]+)"|[\w.-]+)/g)].map((m) => m[2] ?? m[1]);
  if (without.length) out.exclude = without.join(" ");
  const part = t.match(/\b[a-z]{2,4}-\d{3,5}\b/);
  if (part) out.part_number = part[0].toUpperCase();
  const mention = [...t.matchAll(/\b(?:mentioning|about|with|containing)\s+"([^"]+)"/g)].map((m) => m[1]);
  if (mention.length) out.q = mention.join(" ");
  return out;
}

const LABELS: Record<keyof NarrowQuery, (v: string) => string> = {
  q: (v) => `mentions “${v}”`,
  doc_type: (v) => humanize(v),
  project: (v) => `Project ${v}`,
  part_number: (v) => `Part ${v}`,
  exclude: (v) => `without “${v}”`,
  year: (v) => `from ${v}`,
  media: (v) => (v === "image" ? "Pictures only" : "Documents only"),
};

/** F06.7: narrow results step by step: chips for what the results contain, plain words, and removable steps. */
export function NarrowBar({
  query,
  results,
  types,
  projects,
  onChange,
}: {
  query: NarrowQuery;
  results: SearchResult[];
  types: string[];
  projects: string[];
  onChange: (q: NarrowQuery) => void;
}) {
  const [words, setWords] = useState("");
  const active = (Object.keys(LABELS) as (keyof NarrowQuery)[]).filter((k) => query[k]);
  const count = (pick: (r: SearchResult) => string | null) => {
    const m = new Map<string, number>();
    for (const r of results) {
      const v = pick(r);
      if (v) m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  };
  const facets: { key: keyof NarrowQuery; value: string; label: string; n: number }[] = [
    ...(query.doc_type ? [] : count((r) => r.doc_type).map(([v, n]) => ({ key: "doc_type" as const, value: v, label: humanize(v), n }))),
    ...(query.project ? [] : count((r) => r.project).map(([v, n]) => ({ key: "project" as const, value: v, label: `Project ${v}`, n }))),
    ...(query.year ? [] : count((r) => r.doc_date?.slice(0, 4) ?? null).map(([v, n]) => ({ key: "year" as const, value: v, label: v, n }))),
  ];
  const pictures = results.filter((r) => r.media_type.startsWith("image/")).length;

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-control border border-line bg-raised/50 p-3">
      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          <span className="text-xs text-muted">Narrowed to</span>
          {active.map((k, i) => (
            <span key={k} className="pop-in inline-flex items-center gap-1 rounded-full border border-line-strong bg-panel px-2 py-0.5 text-xs">
              {i > 0 && <span aria-hidden className="text-muted">›</span>}
              {LABELS[k](query[k])}
              <button type="button" aria-label={`Remove ${LABELS[k](query[k])}`} className="text-muted hover:text-redline" onClick={() => onChange({ ...query, [k]: "" })}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {(facets.length > 0 || pictures > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Narrow down</span>
          {facets.map((f) => (
            <button
              key={`${f.key}:${f.value}`}
              type="button"
              onClick={() => onChange({ ...query, [f.key]: f.value })}
              className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:border-ink hover:text-ink"
            >
              {f.label} <span className="tabular-nums">{f.n}</span>
            </button>
          ))}
          {!query.media && pictures > 0 && (
            <button type="button" onClick={() => onChange({ ...query, media: "image" })} className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:border-ink hover:text-ink">
              Pictures only <span className="tabular-nums">{pictures}</span>
            </button>
          )}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const patch = parseNarrowing(words, types, projects);
          if (Object.keys(patch).length) onChange({ ...query, ...patch });
          setWords("");
        }}
      >
        <input
          className={cx(inputClass, "text-xs")}
          value={words}
          onChange={(e) => setWords(e.target.value)}
          placeholder='Narrow in plain words: "only inspection reports from 2023 without FAIL"'
          aria-label="Narrow the results in plain words"
          maxLength={200}
        />
        <button type="submit" disabled={!words.trim()} className="press rounded-control border border-line-strong px-3 text-xs font-medium disabled:opacity-50">
          Narrow
        </button>
      </form>
    </div>
  );
}
