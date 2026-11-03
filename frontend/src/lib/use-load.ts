"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorText, getToken } from "./api";

export interface Loaded<T> {
  data: T | undefined;
  error: string | null;
  /** HTTP status of the last error (403 = role not allowed, 0 = server unreachable). */
  status: number | null;
  loading: boolean;
  /** When the server last answered this request (ms since 1970), or null before the first answer on this page. */
  at: number | null;
  reload: () => void;
}

// F12.13: the last answer for each request, in memory only. A page opened before shows at once and refreshes behind
// the scenes. The token is part of the key, so nothing carries over to the next person who signs in.
const MAX_REMEMBERED = 120;
const remembered = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown>>();

const slot = (key: string) => `${getToken() ?? ""}|${key}`;

function remember(key: string, value: unknown): void {
  remembered.delete(key);
  remembered.set(key, value);
  if (remembered.size > MAX_REMEMBERED) remembered.delete(remembered.keys().next().value as string);
}

/** Two screens asking for the same thing at the same moment share one request. */
function fetchShared<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const request = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

/** Load something ahead of time, so the first visit to a page can be instant too. Failures are ignored. */
export function preload<T>(key: string, fn: () => Promise<T>): void {
  const id = slot(key);
  if (remembered.has(id)) return;
  fetchShared(id, fn).then((value) => remember(id, value), () => undefined);
}

/**
 * Fetch data for a client component and optionally poll it.
 * `key` identifies the request: when it changes the data is fetched again. Pass null to skip.
 */
export function useLoad<T>(key: string | null, fn: () => Promise<T>, intervalMs?: number): Loaded<T> {
  const id = key === null ? null : slot(key);
  const [result, setResult] = useState<{ id: string; data: T; at: number } | null>(null);
  const [error, setError] = useState<{ text: string; status: number } | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (id === null) return;
    let alive = true;
    const run = () =>
      fetchShared(id, () => fnRef.current()).then(
        (d) => {
          remember(id, d);
          if (!alive) return;
          setResult({ id, data: d, at: Date.now() });
          setError(null);
          setSettled(id);
        },
        (e: unknown) => {
          if (!alive) return;
          setError({ text: errorText(e), status: e instanceof ApiError ? e.status : -1 });
          setSettled(id);
        },
      );
    run();
    const t = intervalMs ? setInterval(run, intervalMs) : undefined;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [id, intervalMs, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const data = id === null ? undefined : result?.id === id ? result.data : (remembered.get(id) as T | undefined);
  return {
    data,
    error: error?.text ?? null,
    status: error?.status ?? null,
    loading: id !== null && settled !== id && data === undefined,
    at: result?.id === id ? result.at : null,
    reload,
  };
}
