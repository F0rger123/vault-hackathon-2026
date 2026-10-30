"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "./ui";

/** Every place and common action, described in the words people search with. */
const ENTRIES: { href: string; label: string; hint: string; words: string }[] = [
  { href: "/", label: "Overview", hint: "Counts, runs, this computer and its Meta models", words: "home dashboard models install gpu hardware" },
  { href: "/setup", label: "Set up a run", hint: "Add files or a folder, then read them", words: "upload import add documents files folder read start" },
  { href: "/run", label: "Live run board", hint: "Watch the agents work, see the summary, ask the coordinator", words: "progress running job agents chat summary" },
  { href: "/investigate", label: "Investigate", hint: "Ask questions, search, narrow down, see conflicts, export a table", words: "search find ask question conflicts photos export csv" },
  { href: "/training", label: "Training", hint: "Test how well it reads, quiz it, teach it, re-test", words: "quiz grade teach accuracy score test" },
  { href: "/brain", label: "Brain", hint: "What VAULT knows, its questions, the 3D map", words: "knowledge map graph learn meaning questions 3d" },
  { href: "/approvals", label: "Approvals", hint: "Organize folders and share packs, approved by an admin", words: "organize folders share redact buyer export" },
  { href: "/welcome", label: "Setup guide", hint: "Unlock with face or a USB key, check this computer, install models", words: "welcome first run install wizard face fingerprint key" },
  { href: "/security", label: "Security", hint: "Protection checklist, held files, passkeys, audit log", words: "passkey face fingerprint yubikey audit quarantine remote key" },
];

/** Ctrl+K (or Cmd+K) jumps anywhere in VAULT by typing what you are looking for. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    const show = () => setOpen(true);
    window.addEventListener("keydown", key);
    window.addEventListener("vault:palette", show);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("vault:palette", show);
    };
  }, []);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return ENTRIES;
    return ENTRIES.filter((e) => `${e.label} ${e.hint} ${e.words}`.toLowerCase().includes(t));
  }, [q]);

  if (!open) return null;
  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };
  // Portalled to the page root, so it takes the page's colours rather than the dark side rail it is opened from.
  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-start bg-paper/70 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Go to"
        className="pop-in mx-auto w-full max-w-lg rounded-card border border-line bg-panel shadow-lift"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
            if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            if (e.key === "Enter" && results[active]) go(results[active].href);
          }}
          placeholder="Where do you want to go? Try “passkey”, “upload” or “quiz”"
          aria-label="Search VAULT"
          className="w-full rounded-t-card border-b border-line bg-transparent px-4 py-3 text-sm outline-none"
        />
        <ul className="max-h-80 overflow-auto p-1.5" role="listbox" aria-label="Places">
          {results.map((e, i) => (
            <li key={e.href} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(e.href)}
                className={cx("flex w-full flex-col rounded-control px-3 py-2 text-left", i === active && "bg-raised")}
              >
                <span className="text-sm font-medium">{e.label}</span>
                <span className="text-xs text-muted">{e.hint}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="px-3 py-2 text-sm text-muted">Nothing matches. Try another word.</li>}
        </ul>
        <p className="border-t border-line px-4 py-2 text-[11px] text-muted">↑ ↓ to move · Enter to open · Esc to close</p>
      </div>
    </div>,
    document.body,
  );
}
