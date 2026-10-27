"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, errorText, openOriginal, vault, type DocumentDetail, type Screening } from "@/lib/api";
import { formatBytes, humanize, providerLabel } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { Button, Empty, LoadError, Notice, Tag, VerifiedMark } from "./ui";

interface DrawerData {
  doc: DocumentDetail;
  screening: Screening | null;
}

async function loadDrawer(id: number): Promise<DrawerData> {
  const [doc, screening] = await Promise.all([
    vault.document(id),
    vault.screening(id).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),
  ]);
  return { doc, screening };
}

export function DocumentDrawer({ documentId, onClose }: { documentId: number | null; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { data, error, status, loading } = useLoad(
    documentId === null ? null : `doc:${documentId}`,
    () => loadDrawer(documentId as number),
  );
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (documentId === null) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [documentId, onClose]);

  if (documentId === null) return null;
  const current = data && data.doc.id === documentId ? data : undefined;
  const x = current?.doc.extraction;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="Close document details" className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        className="drawer-in relative flex h-full w-full max-w-xl flex-col border-l border-line bg-panel shadow-lift outline-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs text-muted">Document</p>
            <h2 id="drawer-title" className="break-all font-mono text-base font-medium">
              {current?.doc.filename ?? (loading ? "Loading" : `Document ${documentId}`)}
            </h2>
            {current && (
              <p className="mt-1 text-sm text-muted">
                {humanize(x?.data.doc_type)}, {current.doc.page_count} {current.doc.page_count === 1 ? "page" : "pages"},{" "}
                {formatBytes(current.doc.size_bytes)}
              </p>
            )}
          </div>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <LoadError error={error} status={status} what="this document" />
          {current && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  busy={opening}
                  onClick={async () => {
                    setOpenError(null);
                    setOpening(true);
                    try {
                      await openOriginal(documentId);
                    } catch (e) {
                      setOpenError(errorText(e));
                    } finally {
                      setOpening(false);
                    }
                  }}
                >
                  Open the original
                </Button>
                <span className="text-xs text-muted">Opens in a new tab. The download is recorded in the audit log.</span>
              </div>
              {openError && <Notice>Couldn&apos;t open the original: {openError}</Notice>}

              <section>
                <h3 className="mb-2 text-sm font-semibold">Extracted fields</h3>
                {!x ? (
                  <Empty>This document hasn&apos;t been processed yet. Start a run on the Set up a run sheet.</Empty>
                ) : (
                  <>
                    <dl className="grid grid-cols-[8rem_minmax(0,1fr)] border-t border-line text-sm">
                      {(
                        [
                          ["Document type", humanize(x.data.doc_type)],
                          ["Project", x.data.project ?? "Not found"],
                          ["Date", x.data.doc_date ?? "Not found"],
                          ["Title", x.data.title ?? "Not found"],
                          ["Summary", x.data.summary ?? "None"],
                          ["Parties", x.data.parties?.length ? x.data.parties.join(", ") : "None"],
                          ["Stamps", x.data.stamps?.length ? x.data.stamps.join(", ") : "None"],
                        ] as const
                      ).map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="border-b border-line py-1.5 pr-3 text-muted">{k}</dt>
                          <dd className="break-words border-b border-line py-1.5">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-2 text-xs text-muted">
                      Read by {providerLabel(x.provider)} ({x.model}) {x.locality === "local" ? "on this machine" : "on a remote service"}{" "}
                      in {(x.duration_ms / 1000).toFixed(1)} s. {Math.round(x.verified_ratio * 100)}% of quoted evidence was found
                      in the original text.
                    </p>
                  </>
                )}
              </section>

              {x?.data.components && x.data.components.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Components</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line text-left text-xs font-medium text-muted">
                          <th className="py-1.5 pr-3 font-medium">Part number</th>
                          <th className="py-1.5 pr-3 font-medium">Rating</th>
                          <th className="py-1.5 font-medium">Quantity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {x.data.components.map((c, i) => (
                          <tr key={`${c.part_number}-${i}`} className="border-b border-line">
                            <td className="py-1.5 pr-3 font-mono">{c.part_number ?? "None"}</td>
                            <td className="py-1.5 pr-3 tabular-nums">
                              {c.pressure_rating_psi != null ? `${c.pressure_rating_psi} psi` : "Not stated"}
                            </td>
                            <td className="py-1.5 tabular-nums">{c.quantity ?? "Not stated"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {x && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Evidence quotes</h3>
                  {x.evidence.length === 0 ? (
                    <Empty>The model quoted no evidence for this document.</Empty>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {x.evidence.map((ev, i) => (
                        <li key={i} className="rounded-control border border-line bg-raised px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                            <span>
                              {humanize(ev.field)}
                              {ev.page != null && `, page ${ev.page}`}
                            </span>
                            <VerifiedMark verified={ev.verified} />
                          </div>
                          <blockquote className="mt-1 break-words font-mono text-[13px]">{ev.quote}</blockquote>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              <section>
                <h3 className="mb-2 text-sm font-semibold">Security screening</h3>
                {!current.screening ? (
                  <Empty>Not screened yet. Documents are screened at the start of every run.</Empty>
                ) : (
                  <ScreeningView s={current.screening} />
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScreeningView({ s }: { s: Screening }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <Tag tone={s.sensitivity === "restricted" ? "amber" : s.sensitivity === "internal" ? "blue" : "neutral"}>
          Sensitivity: {s.sensitivity === "none" ? "no markings" : s.sensitivity}
        </Tag>
        <Tag tone={s.route === "local_only" ? "blue" : "neutral"}>
          {s.route === "local_only" ? "Kept on local models only" : "May use any enabled model"}
        </Tag>
      </div>
      {s.markings.length > 0 && <p>Markings found: {s.markings.join(", ")}</p>}
      {s.pii.length > 0 && <p>Personal data found: {s.pii.map(humanize).join(", ")}</p>}
      {s.injection.length > 0 && (
        <Notice tone="denied">
          <p className="font-medium">Instruction-like text aimed at AI systems was found. It was not followed.</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {s.injection.map((m, i) => (
              <li key={i}>
                <span className="font-mono text-[13px]">&ldquo;{m.match}&rdquo;</span>
                <span className="text-muted">, page {m.page}</span>
              </li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  );
}
