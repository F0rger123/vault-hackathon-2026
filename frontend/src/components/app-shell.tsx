"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { setToken } from "@/lib/api";
import { SessionGate, SessionProvider, useMaybeSession, useSession } from "./session";
import { Button, cx, inputClass } from "./ui";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/setup", label: "Set up a run" },
  { href: "/run", label: "Live run board" },
  { href: "/investigate", label: "Investigate" },
  { href: "/approvals", label: "Approvals" },
  { href: "/security", label: "Security" },
] as const;

export function sheetNumber(href: string): number {
  return NAV.findIndex((n) => n.href === href) + 1;
}
export const SHEET_COUNT = NAV.length;

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-[3px]">
      <svg aria-hidden viewBox="0 0 28 28" className="h-7 w-7 text-ink">
        <rect x="1" y="1" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="14" cy="14" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M14 7.5v3M14 17.5v3M7.5 14h3M17.5 14h3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="14" cy="14" r="1.6" fill="var(--blue)" />
      </svg>
      <span className="text-lg font-bold tracking-[0.12em]">VAULT</span>
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { stats } = useSession();
  return (
    <ul className="flex flex-col">
      {NAV.map((item, i) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const badge =
          item.href === "/run" && stats?.jobs_active
            ? String(stats.jobs_active)
            : item.href === "/approvals" && stats?.proposals_pending
              ? String(stats.proposals_pending)
              : null;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cx(
                "group flex items-center gap-3 border-l-2 py-2 pl-3 pr-2 text-[15px]",
                active ? "border-blue bg-panel font-semibold text-ink" : "border-transparent text-muted hover:text-ink",
              )}
            >
              <span className="w-5 text-xs tabular-nums text-muted">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex-1 whitespace-nowrap">{item.label}</span>
              {badge && (
                <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-blue">
                  {item.href === "/run" && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-blue" />}
                  <span className="tabular-nums">{badge}</span>
                  <span className="sr-only">{item.href === "/run" ? "running" : "waiting"}</span>
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function CollectionPicker({ id }: { id: string }) {
  const { collections, collection, setCollectionId } = useSession();
  if (!collections.length) return <p className="text-xs text-muted">No collections yet.</p>;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted">
        Collection
      </label>
      <select
        id={id}
        className={inputClass}
        value={collection?.id ?? ""}
        onChange={(e) => setCollectionId(Number(e.target.value))}
      >
        {collections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function UserBox() {
  const { me, signOut } = useSession();
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium">{me.username}</div>
        <div className="text-xs text-muted">Role: {me.role}</div>
      </div>
      <Button variant="quiet" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}

function Chrome({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ready = useMaybeSession() !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={cx("min-h-dvh", ready && "lg:grid lg:grid-cols-[236px_minmax(0,1fr)]")}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-panel focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      {/* Desktop rail */}
      {ready && (
        <nav
          aria-label="Main"
          className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line bg-paper px-3 py-5 lg:flex"
        >
          <div className="px-2">
            <Wordmark />
            <p className="mt-2 text-xs leading-snug text-muted">Private document intelligence. Runs on this machine.</p>
          </div>
          <NavLinks />
          <div className="mt-auto flex flex-col gap-4 border-t border-line px-2 pt-4">
            <CollectionPicker id="collection-rail" />
            <UserBox />
          </div>
        </nav>
      )}

      {/* Phone and tablet top bar */}
      {ready && (
        <header className="sticky top-0 z-30 border-b border-line bg-paper lg:hidden">
          <div className="flex items-center justify-between px-4 py-2.5">
            <Wordmark />
            <Button
              variant="secondary"
              aria-expanded={open}
              aria-controls="mobile-nav"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "Close menu" : "Menu"}
            </Button>
          </div>
          {open && (
            <nav id="mobile-nav" aria-label="Main" className="border-t border-line bg-paper px-2 pb-4 pt-2">
              <NavLinks onNavigate={() => setOpen(false)} />
              <div className="mt-3 flex flex-col gap-3 border-t border-line px-2 pt-3">
                <CollectionPicker id="collection-menu" />
                <UserBox />
              </div>
            </nav>
          )}
        </header>
      )}

      <main id="main" className={cx("min-w-0", ready && "px-4 pb-16 pt-5 sm:px-6 lg:px-8 lg:pt-7")}>
        {children}
      </main>
    </div>
  );
}

function SignIn({ onSignedIn, message }: { onSignedIn: () => void; message?: string }) {
  const [value, setValue] = useState("");
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <form
        className="w-full max-w-sm border border-line-strong bg-panel"
        onSubmit={(e) => {
          e.preventDefault();
          setToken(value.trim());
          onSignedIn();
        }}
      >
        <div className="border-b border-line px-5 py-4">
          <Wordmark />
        </div>
        <div className="flex flex-col gap-3 px-5 py-5">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="text-sm text-muted">
            Paste the API token your administrator gave you. It stays in this browser tab and is cleared when you
            close it.
          </p>
          {message && <p className="text-sm text-amber">{message}</p>}
          <label htmlFor="token" className="text-sm font-medium">
            API token
          </label>
          <input
            id="token"
            type="password"
            autoComplete="off"
            className={cx(inputClass, "font-mono")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
          <Button variant="primary" type="submit" className="mt-1">
            Sign in
          </Button>
        </div>
      </form>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <Chrome>{children}</Chrome>
    </SessionProvider>
  );
}

/** Wrap each page: shows sign-in or loading until the session is ready. */
export function PageGate({ children }: { children: ReactNode }) {
  return <SessionGate signIn={(p) => <SignIn {...p} />}>{children}</SessionGate>;
}
