"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { VaultMark } from "./vault-mark";
import { ApiError, errorText, getToken, setToken, vault, type Collection, type Me, type Stats } from "@/lib/api";

const COLLECTION_KEY = "vault.collection";
const MODE_KEY = "vault.mode";

export type Mode = "demo" | "real";

interface Session {
  me: Me;
  /** Collections for the current mode only: demo collections in Demo mode, the rest in Real mode. */
  collections: Collection[];
  allCollections: Collection[];
  mode: Mode;
  setMode: (mode: Mode) => void;
  collection: Collection | null;
  setCollectionId: (id: number) => void;
  refresh: () => void;
  stats: Stats | null;
  signOut: () => void;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
}

type State =
  | { phase: "loading" }
  | { phase: "signed_out"; message?: string }
  | { phase: "error"; message: string }
  | { phase: "ready"; me: Me; collections: Collection[] };

interface SessionState {
  state: State;
  refresh: () => void;
}

const StateContext = createContext<SessionState | null>(null);

/** Whether a signed-in session is ready; null while loading or signed out. */
export function useMaybeSession(): Session | null {
  return useContext(SessionContext);
}

export function useSessionState(): SessionState {
  const s = useContext(StateContext);
  if (!s) throw new Error("useSessionState must be used inside SessionProvider");
  return s;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [collectionId, setCollectionIdState] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [nonce, setNonce] = useState(0);
  const [storedMode, setStoredMode] = useState<Mode | null>(() => {
    try {
      const m = sessionStorage.getItem(MODE_KEY);
      return m === "demo" || m === "real" ? m : null;
    } catch {
      return null;
    }
  });
  const setMode = useCallback((m: Mode) => {
    setStoredMode(m);
    try {
      sessionStorage.setItem(MODE_KEY, m);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    if (!getToken()) {
      Promise.resolve().then(() => alive && setState({ phase: "signed_out" }));
      return () => {
        alive = false;
      };
    }
    Promise.all([vault.me(), vault.collections()]).then(
      ([me, collections]) => {
        if (!alive) return;
        setState({ phase: "ready", me, collections });
        let stored: number | null = null;
        try {
          stored = Number(sessionStorage.getItem(COLLECTION_KEY)) || null;
        } catch {
          /* storage unavailable */
        }
        setCollectionIdState((cur) => {
          const want = cur ?? stored;
          return collections.some((c) => c.id === want) ? want : (collections[0]?.id ?? null);
        });
      },
      (e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) {
          setToken(null);
          setState({ phase: "signed_out", message: "That token was not accepted. Paste a current token." });
        } else setState({ phase: "error", message: errorText(e) });
      },
    );
    return () => {
      alive = false;
    };
  }, [nonce]);

  // Header counters (active runs, pending approvals) stay fresh while signed in.
  const ready = state.phase === "ready";
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const run = () => vault.stats().then((s) => alive && setStats(s), () => undefined);
    run();
    const t = setInterval(run, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [ready, nonce]);

  useEffect(() => {
    // Only a session that was signed in can "end". While a pasted token is being checked, the sign-in
    // handler above reports the rejection itself; letting this listener win the race would show the wrong message.
    const onUnauthorized = () => {
      setToken(null);
      setState((s) =>
        s.phase === "ready" ? { phase: "signed_out", message: "Your session ended. Paste your token again." } : s,
      );
    };
    window.addEventListener("vault:unauthorized", onUnauthorized);
    return () => window.removeEventListener("vault:unauthorized", onUnauthorized);
  }, []);

  const setCollectionId = useCallback((id: number) => {
    setCollectionIdState(id);
    try {
      sessionStorage.setItem(COLLECTION_KEY, String(id));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const signOut = useCallback(() => {
    // End the session on the server too, so the token stops working everywhere. Best effort.
    vault.logout().catch(() => undefined);
    setToken(null);
    setState({ phase: "signed_out" });
  }, []);

  const value = useMemo<Session | null>(() => {
    if (state.phase !== "ready") return null;
    // Default to Real mode once the organization has its own collections; until then, Demo mode.
    const mode: Mode = storedMode ?? (state.collections.some((c) => !c.is_demo) ? "real" : "demo");
    const shown = state.collections.filter((c) => Boolean(c.is_demo) === (mode === "demo"));
    return {
      me: state.me,
      collections: shown,
      allCollections: state.collections,
      mode,
      setMode,
      collection: shown.find((c) => c.id === collectionId) ?? shown[0] ?? null,
      setCollectionId,
      refresh,
      stats,
      signOut,
    };
  }, [state, collectionId, setCollectionId, refresh, stats, signOut, storedMode, setMode]);

  const stateValue = useMemo(() => ({ state, refresh }), [state, refresh]);
  return (
    <StateContext.Provider value={stateValue}>
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    </StateContext.Provider>
  );
}

/** Renders its children only for a signed-in user; otherwise the loading, sign-in or error screen. */
export function SessionGate({
  children,
  signIn,
}: {
  children: ReactNode;
  signIn: (props: { onSignedIn: () => void; message?: string }) => ReactNode;
}) {
  const { state, refresh } = useSessionState();
  if (state.phase === "ready") return <>{children}</>;
  if (state.phase === "loading")
    return (
      <div className="grid min-h-[70dvh] place-items-center text-sm text-muted" role="status">
        <span className="vault-dial-spin flex flex-col items-center gap-3">
          <VaultMark className="h-10 w-10 animate-pulse" />
          Opening the vault
        </span>
      </div>
    );
  if (state.phase === "signed_out") return <>{signIn({ onSignedIn: refresh, message: state.message })}</>;
  return (
    <div className="mx-auto mt-24 max-w-md rounded-card border border-line bg-panel p-6 text-sm" role="alert">
      <h1 className="text-lg font-semibold">VAULT can&apos;t reach its server</h1>
      <p className="mt-2 text-muted">{state.message}</p>
      <button className="mt-4 text-blue underline underline-offset-4" onClick={refresh}>
        Try again
      </button>
    </div>
  );
}
