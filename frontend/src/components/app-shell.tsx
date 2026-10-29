"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { errorText, setToken, vault, type AuthOptions, type SignedIn } from "@/lib/api";
import { VaultMark } from "./vault-mark";
import { SessionGate, SessionProvider, useMaybeSession, useSession } from "./session";
import { Button, cx, inputClass } from "./ui";

// 16px line icons drawn on a 16-unit grid; stroke follows the text colour.
const ICONS: Record<string, ReactNode> = {
  "/": <path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v7H9zM2.5 9h4.5v4.5H2.5zM9 11.5h4.5v2H9z" />,
  "/setup": <path d="M3 4h10M3 8h10M3 12h10M6 2.5v3M10 6.5v3M5 10.5v3" />,
  "/run": <path d="M1.5 8h3l2-4.5 3 9 2-4.5h3" />,
  "/investigate": <path d="M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM10.6 10.6l3.4 3.4" />,
  "/training": <path d="M2 13.5h12M4 13.5V9M8 13.5V5.5M12 13.5V2.5M3 6.5l4-3 3 2 4-3" />,
  "/brain": <path d="M4 4.5a1.5 1.5 0 1 0 0-.01M12 3.5a1.5 1.5 0 1 0 0-.01M8 12.5a1.5 1.5 0 1 0 0-.01M5.3 4.7 10.6 3.8M4.7 5.8l2.6 5.4M11.4 5l-2.7 6" />,
  "/approvals": <path d="M3 2.5h10v11H3zM5.5 8l2 2 3.5-4" />,
  "/security": <path d="M8 1.8 13 4v4c0 3-2.2 5.2-5 6.2C5.2 13.2 3 11 3 8V4l5-2.2Z" />,
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/setup", label: "Set up a run" },
  { href: "/run", label: "Live run board" },
  { href: "/investigate", label: "Investigate" },
  { href: "/training", label: "Training" },
  { href: "/brain", label: "Brain" },
  { href: "/approvals", label: "Approvals" },
  { href: "/security", label: "Security" },
] as const;

export function sheetNumber(href: string): number {
  return NAV.findIndex((n) => n.href === href) + 1;
}
export const SHEET_COUNT = NAV.length;


function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-3 rounded-control">
      <VaultMark className="h-8 w-8" />
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

/** Demo mode shows only fictional collections; Real mode shows only the organization's own (F10.11). */
function ModeSwitch() {
  const { mode, setMode } = useSession();
  return (
    <div role="group" aria-label="Data mode" className="grid grid-cols-2 gap-1 rounded-control border border-line p-0.5">
      {(
        [
          ["demo", "Demo"],
          ["real", "Real"],
        ] as const
      ).map(([m, label]) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => setMode(m)}
          className={cx(
            "rounded-[3px] px-2 py-1 text-xs font-medium",
            mode === m ? (m === "demo" ? "bg-amber text-paper" : "bg-ink text-panel") : "text-muted hover:text-ink",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function DemoBanner() {
  const session = useMaybeSession();
  if (!session || session.mode !== "demo") return null;
  return (
    <p className="mb-5 rounded-control border border-amber/40 bg-amber/10 px-3 py-2 text-sm" role="note">
      <span className="font-medium">Demo mode:</span> every document here is fictional. Switch to{" "}
      <button type="button" className="font-medium underline underline-offset-4" onClick={() => session.setMode("real")}>
        Real
      </button>{" "}
      to work with your own documents.
    </p>
  );
}

function CollectionPicker({ id }: { id: string }) {
  const { collections, collection, setCollectionId, mode } = useSession();
  if (!collections.length)
    return (
      <p className="text-xs text-muted">
        No {mode} collections yet.{" "}
        <Link href="/setup" className="underline underline-offset-4">
          Create one
        </Link>
      </p>
    );
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
            <ModeSwitch />
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
                <ModeSwitch />
                <CollectionPicker id="collection-menu" />
                <UserBox />
                <ThemeToggle />
              </div>
            </nav>
          )}
        </header>
      )}

      <main id="main" className={cx("page-enter min-w-0", ready && "vault-glow mx-auto w-full max-w-[1480px] px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-9")}>
        {ready && <DemoBanner />}
        {children}
      </main>
    </div>
  );
}

function SignIn({ onSignedIn, message }: { onSignedIn: () => void; message?: string }) {
  const [options, setOptions] = useState<AuthOptions | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setTokenValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    vault.authOptions().then(setOptions, () => setOptions({ demo_login: false, password_login: false }));
  }, []);

  const finish = async (label: string, attempt: () => Promise<SignedIn>) => {
    setBusy(label);
    setError(null);
    try {
      const session = await attempt();
      setToken(session.token);
      onSignedIn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="animate-rise w-full max-w-sm rounded-card border border-line bg-panel shadow-lift">
        <div className="vault-dial-intro border-b border-line px-5 py-4">
          <Wordmark />
        </div>
        <div className="flex flex-col gap-4 px-5 py-5">
          <div>
            <h1 className="display text-xl">Sign in</h1>
            <p className="mt-1 text-sm text-muted">
              No API key or internet account needed. VAULT runs on this computer, with Meta Llama through Ollama.
            </p>
          </div>
          {message && <p className="text-sm text-amber">{message}</p>}
          {error && (
            <p className="text-sm text-redline" role="alert">
              {error}
            </p>
          )}

          {options?.demo_login && (
            <section aria-labelledby="demo-h" className="flex flex-col gap-2">
              <h2 id="demo-h" className="text-sm font-medium">
                Try the demo
              </h2>
              <p className="text-xs text-muted">Fictional documents only. Pick a role to see what it can do.</p>
              <div className="grid grid-cols-3 gap-2">
                {(["admin", "analyst", "viewer"] as const).map((role) => (
                  <Button
                    key={role}
                    aria-label={`Demo: ${role}`}
                    variant={role === "analyst" ? "primary" : "secondary"}
                    busy={busy === role}
                    disabled={!!busy}
                    onClick={() => finish(role, () => vault.demoLogin(role))}
                  >
                    <span className="capitalize">{role}</span>
                  </Button>
                ))}
              </div>
            </section>
          )}

          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              finish("password", () => vault.login(username.trim(), password));
            }}
          >
            <h2 className="text-sm font-medium">{options?.demo_login ? "Or sign in with your account" : "Your account"}</h2>
            <label htmlFor="username" className="text-xs text-muted">
              Username
            </label>
            <input
              id="username"
              autoComplete="username"
              className={inputClass}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <label htmlFor="password" className="text-xs text-muted">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button variant={options?.demo_login ? "secondary" : "primary"} type="submit" busy={busy === "password"}>
              Sign in
            </Button>
            {options && !options.password_login && (
              <p className="text-xs text-muted">
                No passwords are set yet. An administrator sets one with <code className="font-mono">vault set-password NAME</code>.
              </p>
            )}
          </form>

          <details className="text-sm">
            <summary className="cursor-pointer text-muted hover:text-ink">Use an API token instead</summary>
            <form
              className="mt-2 flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setToken(token.trim());
                onSignedIn();
              }}
            >
              <label htmlFor="token" className="text-xs text-muted">
                API token
              </label>
              <input
                id="token"
                type="password"
                autoComplete="off"
                className={cx(inputClass, "font-mono")}
                value={token}
                onChange={(e) => setTokenValue(e.target.value)}
                required
              />
              <Button type="submit">Sign in with token</Button>
              <p className="text-xs text-muted">It stays in this browser tab and is cleared when you close it.</p>
            </form>
          </details>
        </div>
      </div>
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
