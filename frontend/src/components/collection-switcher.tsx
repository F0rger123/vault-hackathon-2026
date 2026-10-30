"use client";

import { useEffect, useId, useRef, useState } from "react";
import { atLeast, errorText, vault } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useSession } from "./session";
import { cx, inputClass } from "./ui";

/**
 * F10.12: pick the collection you are working in, or start a new one, without leaving the page.
 * Each collection is its own archive with its own brain, so the switcher says how big each one is.
 */
export function CollectionSwitcher({ id }: { id: string }) {
  const { collections, collection, setCollectionId, mode, me, refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const canCreate = atLeast(me, "analyst");

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await vault.createCollection(name.trim(), mode === "demo");
      setName("");
      setCreating(false);
      setOpen(false);
      setCollectionId(made.id);
      refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={root} className="relative flex flex-col gap-1">
      <span id={`${id}-label`} className="text-xs text-muted">
        Collection
      </span>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={`${id}-label ${id}`}
        onClick={() => setOpen((o) => !o)}
        className="press flex min-h-10 w-full items-center justify-between gap-2 rounded-control border border-line-strong bg-raised px-3 py-1.5 text-left text-sm hover:border-muted"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{collection?.name ?? `No ${mode} collections yet`}</span>
          {collection && (
            <span className="block text-xs text-muted tabular-nums">
              {formatNumber(collection.documents)} documents · {formatNumber(collection.processed ?? 0)} read
            </span>
          )}
        </span>
        <svg aria-hidden viewBox="0 0 16 16" className={cx("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div className="pop-in absolute bottom-full left-0 z-50 mb-2 w-72 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-panel p-1.5 shadow-lift">
          <ul id={listId} role="listbox" aria-label="Collections" className="flex max-h-72 flex-col overflow-auto">
            {collections.map((c) => (
              <li key={c.id} role="option" aria-selected={c.id === collection?.id}>
                <button
                  type="button"
                  onClick={() => {
                    setCollectionId(c.id);
                    setOpen(false);
                  }}
                  className={cx(
                    "flex w-full items-center justify-between gap-3 rounded-control px-3 py-2 text-left text-sm hover:bg-raised",
                    c.id === collection?.id && "bg-raised",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block text-xs text-muted tabular-nums">
                      {formatNumber(c.documents)} documents · {formatNumber(c.processed ?? 0)} read
                    </span>
                  </span>
                  {c.id === collection?.id && (
                    <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-green">
                      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  )}
                </button>
              </li>
            ))}
            {!collections.length && <li className="px-3 py-2 text-sm text-muted">No {mode} collections yet.</li>}
          </ul>
          {canCreate && (
            <div className="mt-1 border-t border-line pt-1.5">
              {creating ? (
                <form
                  className="flex flex-col gap-2 p-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (name.trim()) void create();
                  }}
                >
                  <label htmlFor={`${id}-new`} className="text-xs text-muted">
                    Name of the new {mode === "demo" ? "demo " : ""}collection
                  </label>
                  <input
                    id={`${id}-new`}
                    autoFocus
                    className={inputClass}
                    value={name}
                    maxLength={120}
                    placeholder="Nuclear division archive"
                    onChange={(e) => setName(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={!name.trim() || busy}
                      className="press flex-1 rounded-control border border-accent bg-accent px-3 py-1.5 text-sm font-semibold text-on-accent disabled:opacity-50"
                    >
                      {busy ? "Creating…" : "Create"}
                    </button>
                    <button type="button" onClick={() => setCreating(false)} className="rounded-control px-3 py-1.5 text-sm text-muted hover:text-ink">
                      Cancel
                    </button>
                  </div>
                  {error && <p className="text-xs text-redline">{error}</p>}
                  <p className="text-xs text-muted">It starts empty, with its own brain. Add documents on Set up a run.</p>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-sm font-medium text-blue hover:bg-raised"
                >
                  <span aria-hidden className="text-base leading-none">+</span> New collection
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
