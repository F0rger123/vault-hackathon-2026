"use client";

import { useCallback, useMemo, useState } from "react";
import { vault, type Finding } from "@/lib/api";
import { humanize } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { DocumentDrawer } from "../document-drawer";
import { FindingRedline } from "../finding-redline";
import { useSession } from "../session";
import { TitleBlock } from "../title-block";
import { Button, cx, Empty, Field, inputClass, LoadError, Panel } from "../ui";

function Snippet({ text }: { text: string }) {
  const parts = text.split(/\[\[(.*?)\]\]/g);
  return (
    <p className="mt-1 whitespace-pre-line break-words font-mono text-[12.5px] leading-relaxed text-ink/90">
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </p>
  );
}

interface Query {
  q: string;
  doc_type: string;
  project: string;
  part_number: string;
}
const EMPTY: Query = { q: "", doc_type: "", project: "", part_number: "" };

export function InvestigateView() {
  const { collection } = useSession();
  const [openDoc, setOpenDoc] = useState<number | null>(null);
  const close = useCallback(() => setOpenDoc(null), []);
  const [form, setForm] = useState<Query>(EMPTY);
  const [query, setQuery] = useState<Query | null>(null);
  const [kind, setKind] = useState<"all" | Finding["kind"]>("all");

  const vocab = useLoad(collection ? `vocab:${collection.id}` : null, () =>
    vault.search({ q: "", limit: "200", collection_id: String(collection!.id) }),
  );
  const types = useMemo(() => [...new Set((vocab.data?.results ?? []).map((r) => r.doc_type).filter(Boolean) as string[])].sort(), [vocab.data]);
  const projects = useMemo(() => [...new Set((vocab.data?.results ?? []).map((r) => r.project).filter(Boolean) as string[])].sort(), [vocab.data]);

  const results = useLoad(query && collection ? `search:${collection.id}:${JSON.stringify(query)}` : null, () =>
    vault.search({ ...query!, collection_id: String(collection!.id), limit: "50" }),
  );
  const findings = useLoad(collection ? `findings:${collection.id}` : null, () => vault.findings(collection!.id));
  const shownFindings = (findings.data ?? []).filter((f) => kind === "all" || f.kind === kind);
  const counts = {
    all: findings.data?.length ?? 0,
    rating_conflict: findings.data?.filter((f) => f.kind === "rating_conflict").length ?? 0,
    part_number_collision: findings.data?.filter((f) => f.kind === "part_number_collision").length ?? 0,
  };

  const searchFor = (q: Query) => {
    setForm(q);
    setQuery(q);
  };

  return (
    <>
      <TitleBlock
        href="/investigate"
        title="Investigate"
        description="Search the archive and check each finding against verbatim quotes from the original documents."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-labelledby="findings-h" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="findings-h" className="text-lg font-semibold">
              Findings
            </h2>
            <div role="group" aria-label="Filter findings" className="flex flex-wrap gap-1">
              {(
                [
                  ["all", "All"],
                  ["rating_conflict", "Rating conflicts"],
                  ["part_number_collision", "Part number collisions"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={kind === id}
                  onClick={() => setKind(id)}
                  className={cx(
                    "rounded-[3px] border px-2.5 py-1 text-sm",
                    kind === id ? "border-ink bg-ink text-panel" : "border-line bg-panel text-muted hover:text-ink",
                  )}
                >
                  {label} <span className="tabular-nums">{counts[id]}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="mb-4 max-w-3xl text-sm text-muted">
            Values marked in red disagree with each other. Each quote is checked against the stored page text; a quote that
            can&apos;t be found there is marked so you know to look at the original.
          </p>
          <LoadError error={findings.error} status={findings.status} what="findings" />
          {findings.data && shownFindings.length === 0 && (
            <Empty>
              {counts.all === 0
                ? "No findings yet. Findings are recorded at the end of a run, when the reviewer cross-checks every document."
                : "No findings of this kind. Choose All to see the rest."}
            </Empty>
          )}
          <div className="flex flex-col gap-4">
            {shownFindings.map((f) => (
              <FindingRedline key={f.id} finding={f} onOpenDocument={setOpenDoc} />
            ))}
          </div>
        </section>

        <div className="min-w-0 xl:sticky xl:top-6 xl:self-start">
          <Panel title="Search the archive">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery({ ...form });
              }}
            >
              <Field label="Words or phrases" htmlFor="q">
                <input
                  id="q"
                  type="search"
                  className={inputClass}
                  placeholder="For example hydrostatic test"
                  value={form.q}
                  onChange={(e) => setForm({ ...form, q: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Document type" htmlFor="f-type">
                  <select id="f-type" className={inputClass} value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })}>
                    <option value="">Any</option>
                    {types.map((t) => (
                      <option key={t} value={t}>
                        {humanize(t)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Project" htmlFor="f-project">
                  <select id="f-project" className={inputClass} value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })}>
                    <option value="">Any</option>
                    {projects.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Part number" htmlFor="f-part">
                <input
                  id="f-part"
                  className={cx(inputClass, "font-mono")}
                  placeholder="BV-7891"
                  value={form.part_number}
                  onChange={(e) => setForm({ ...form, part_number: e.target.value })}
                />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" variant="primary">
                  Search
                </Button>
                {query && (
                  <Button
                    type="button"
                    onClick={() => {
                      setForm(EMPTY);
                      setQuery(null);
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </form>

            <div className="mt-4 border-t border-line pt-3">
              {!query && <p className="text-sm text-muted">Search by words, or narrow by type, project or part number.</p>}
              {query && <LoadError error={results.error} status={results.status} what="search results" />}
              {query && results.loading && !results.data && <p className="text-sm text-muted">Searching</p>}
              {query && results.data && (
                <>
                  <p className="mb-2 text-sm text-muted" role="status">
                    {results.data.count === 0
                      ? "Nothing matched. Try fewer words or clear a filter."
                      : `${results.data.count} ${results.data.count === 1 ? "document" : "documents"} matched${results.data.count >= 50 ? " (showing the first 50)" : ""}.`}
                  </p>
                  <ul className="flex max-h-[640px] flex-col overflow-y-auto">
                    {results.data.results.map((r) => (
                      <li key={`${r.document_id}-${r.page}`} className="border-b border-line py-2.5 last:border-b-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                          <button
                            className="break-all text-left font-mono text-[13px] font-medium text-blue underline-offset-4 hover:underline"
                            onClick={() => setOpenDoc(r.document_id)}
                          >
                            {r.filename}
                          </button>
                          {r.page != null && <span className="text-xs text-muted">Page {r.page}</span>}
                        </div>
                        <p className="text-xs text-muted">
                          {humanize(r.doc_type)}
                          {r.project && `, project ${r.project}`}
                          {r.doc_date && `, ${r.doc_date}`}
                        </p>
                        {r.snippet && <Snippet text={r.snippet.trim()} />}
                        {r.part_numbers.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {r.part_numbers.slice(0, 8).map((p) => (
                              <button
                                key={p}
                                onClick={() => searchFor({ ...EMPTY, part_number: p })}
                                className="rounded-[3px] border border-line px-1.5 font-mono text-[11.5px] text-muted hover:border-blue hover:text-blue"
                                title={`Search for ${p}`}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </Panel>
        </div>
      </div>
      <DocumentDrawer documentId={openDoc} onClose={close} />
    </>
  );
}
