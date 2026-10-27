"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { setToken } from "@/lib/api";
import { SessionGate, SessionProvider, useMaybeSession, useSession } from "./session";
import { Button, cx, inputClass } from "./ui";

// 16px line icons drawn on a 16-unit grid; stroke follows the text colour.
const ICONS: Record<string, ReactNode> = {
  "/": <path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v7H9zM2.5 9h4.5v4.5H2.5zM9 11.5h4.5v2H9z" />,
  "/setup": <path d="M3 4h10M3 8h10M3 12h10M6 2.5v3M10 6.5v3M5 10.5v3" />,
  "/run": <path d="M1.5 8h3l2-4.5 3 9 2-4.5h3" />,
  "/investigate": <path d="M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM10.6 10.6l3.4 3.4" />,
  "/approvals": <path d="M3 2.5h10v11H3zM5.5 8l2 2 3.5-4" />,
  "/security": <path d="M8 1.8 13 4v4c0 3-2.2 5.2-5 6.2C5.2 13.2 3 11 3 8V4l5-2.2Z" />,
};

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

/** Logo mark: a solid ink tile with a keyhole cut through it. */
function VaultMark({ className }: { className?: string }) {
  // The rail and the phone header both render a mark; each needs its own mask id, or a hidden copy breaks the other.
  const maskId = `vault-keyhole-${useId().replace(/:/g, "")}`;
  return (
    <svg aria-hidden viewBox="0 0 28 28" className={className}>
      <defs>
        <mask id={maskId}>
          <rect width="28" height="28" fill="white" />
          <circle cx="14" cy="11.5" r="3.4" fill="black" />
          <path d="M12.3 13.2h3.4l1.1 7.3h-5.6z" fill="black" />
        </mask>
      </defs>
      <rect width="28" height="28" rx="7" fill="var(--ink)" mask={`url(#${maskId})`} />
    </svg>
  );
}

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-3 rounded-control">
      <VaultMark className="h-7 w-7" />
      <span className="text-[15px] font-semibold tracking-[0.32em] text-ink">VAULT</span>
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { stats } = useSession();
  return (
    <ul className="flex flex-col gap-0.5">
      {NAV.map((item) => {
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
                "group relative flex items-center gap-3 rounded-control py-2 pl-3 pr-2.5 text-sm transition-colors duration-150",
                active ? "bg-raised font-medium text-ink" : "text-muted hover:bg-raised/60 hover:text-ink",
              )}
            >
              {active && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" />}
              <svg
                aria-hidden
                viewBox="0 0 16 16"
                className={cx("h-4 w-4 shrink-0", active ? "text-accent" : "text-muted group-hover:text-ink")}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
                strokeLinecap="round"
              >
                {ICONS[item.href]}
              </svg>
              <span className="flex-1 whitespace-nowrap">{item.label}</span>
              {badge && (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
                  {item.href === "/run" && <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />}
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

const THEME_EVENT = "vault-theme-change";

function subscribeTheme(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

function ThemeToggle() {
  // The theme lives on <html data-theme>; read it as an external store so server and client agree.
  const light = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.dataset.theme === "light",
    () => false,
  );
  const flip = () => {
    const next = !light;
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("vault-theme", next ? "light" : "dark");
    } catch {
      // Storage can be blocked; the theme still applies for this page view.
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  };
  return (
    <button
      type="button"
      onClick={flip}
      aria-pressed={light}
      className="self-start rounded-control py-1 text-xs text-muted hover:text-ink"
    >
      {light ? "Dark theme" : "Light theme"}
    </button>
  );
}

function UserBox() {
  const { me, signOut } = useSession();
  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        aria-hidden
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold uppercase text-ink ring-1 ring-line-strong"
      >
        {me.username.slice(0, 2)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{me.username}</div>
        <div className="text-xs capitalize text-muted">{me.role}</div>
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
    <div className={cx("min-h-dvh", ready && "lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:bg-[linear-gradient(to_right,#000_247px,#1c1c1c_247px,#1c1c1c_248px,transparent_248px)]")}>
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
          className="rail-scope sticky top-0 hidden h-dvh flex-col gap-7 border-r border-line bg-paper px-3 py-5 lg:flex"
        >
          <div className="px-2">
            <Wordmark />
            <p className="mt-3 flex items-center gap-2 text-xs text-muted">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green" />
              Private. Runs on this machine.
            </p>
          </div>
          <NavLinks />
          <div className="mt-auto flex flex-col gap-4 border-t border-line px-2 pt-4">
            <CollectionPicker id="collection-rail" />
            <UserBox />
            <ThemeToggle />
          </div>
        </nav>
      )}

      {/* Phone and tablet top bar */}
      {ready && (
        <header className="rail-scope sticky top-0 z-30 border-b border-line bg-paper lg:hidden">
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
                <ThemeToggle />
              </div>
            </nav>
          )}
        </header>
      )}

      <main id="main" className={cx("min-w-0", ready && "vault-glow mx-auto w-full max-w-[1480px] px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-9")}>
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
        className="w-full max-w-sm rounded-card border border-line bg-panel shadow-lift"
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
          <h1 className="display text-xl">Sign in</h1>
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
