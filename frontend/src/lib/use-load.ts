"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorText } from "./api";

export interface Loaded<T> {
  data: T | undefined;
  error: string | null;
  /** HTTP status of the last error (403 = role not allowed, 0 = server unreachable). */
  status: number | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Fetch data for a client component and optionally poll it.
 * `key` identifies the request: when it changes the data is fetched again. Pass null to skip.
 */
export function useLoad<T>(key: string | null, fn: () => Promise<T>, intervalMs?: number): Loaded<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<{ text: string; status: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (key === null) return;
    let alive = true;
    const run = () =>
      fnRef.current().then(
        (d) => {
          if (!alive) return;
          setData(d);
          setError(null);
          setLoading(false);
        },
        (e: unknown) => {
          if (!alive) return;
          setError({ text: errorText(e), status: e instanceof ApiError ? e.status : -1 });
          setLoading(false);
        },
      );
    run();
    const t = intervalMs ? setInterval(run, intervalMs) : undefined;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [key, intervalMs, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error: error?.text ?? null, status: error?.status ?? null, loading, reload };
}
