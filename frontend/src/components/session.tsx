"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, errorText, getToken, setToken, vault, type Collection, type Me, type Stats } from "@/lib/api";

const COLLECTION_KEY = "vault.collection";

interface Session {
  me: Me;
  collections: Collection[];
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
    setToken(null);
    setState({ phase: "signed_out" });
  }, []);

  const value = useMemo<Session | null>(() => {
    if (state.phase !== "ready") return null;
    return {
      me: state.me,
      collections: state.collections,
      collection: state.collections.find((c) => c.id === collectionId) ?? null,
      setCollectionId,
      refresh,
      stats,
      signOut,
    };
  }, [state, collectionId, setCollectionId, refresh, stats, signOut]);

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
        Opening the vault
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
