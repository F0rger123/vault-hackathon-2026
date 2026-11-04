"use client";

// F10.25: the Ask Keeper thread lives here, outside the chat page, so a reply keeps streaming while the person visits
// another page of the app. The page subscribes with useSyncExternalStore and re-attaches when it comes back.
// The thread is also kept in sessionStorage. A full reload or a closed tab does end the request, and the server
// stops that reply when its connection closes, so a reply that was running then is marked as stopped, truthfully.

import { askTeam, errorText, type ChatCommand } from "./api";
import type { VaultTurn } from "./keeper-turn";

export type Turn = { id: number; who: "you"; text: string } | VaultTurn;

export interface Saved {
  turns: Turn[];
  last: ChatCommand | null;
}

const EMPTY: Saved = { turns: [], last: null };
const storageKey = (collectionId: number) => `vault.chat.${collectionId}`;

const threads = new Map<number, Saved>();
const listeners = new Map<number, Set<() => void>>();
const inFlight = new Map<number, AbortController>();
/** Called when a reply finishes, so the page can refresh what Keeper has learned. */
const finished = new Map<number, Set<() => void>>();

function fromStorage(collectionId: number): Saved {
  try {
    const raw = sessionStorage.getItem(storageKey(collectionId));
    if (!raw) return EMPTY;
    const saved = JSON.parse(raw) as Saved;
    // Only a reload or a closed tab gets here with a running reply (in-app navigation keeps this module alive),
    // and the server stopped that reply when the connection closed.
    return {
      last: saved.last ?? null,
      turns: (saved.turns ?? []).map((t) =>
        t.who === "vault"
          ? {
              ...t,
              live: false,
              ...(t.running ? { running: false, error: t.error ?? "Stopped when the page was reloaded or closed. Ask again to run it." } : {}),
            }
          : t,
      ),
    };
  } catch {
    return EMPTY;
  }
}

export function getThread(collectionId: number): Saved {
  if (typeof window === "undefined") return EMPTY;
  let t = threads.get(collectionId);
  if (!t) {
    t = fromStorage(collectionId);
    threads.set(collectionId, t);
  }
  return t;
}

export function setThread(collectionId: number, change: Saved | ((s: Saved) => Saved)): void {
  const next = typeof change === "function" ? change(getThread(collectionId)) : change;
  threads.set(collectionId, next);
  try {
    sessionStorage.setItem(storageKey(collectionId), JSON.stringify(next));
  } catch {
    /* storage full or blocked: the thread lives only in memory */
  }
  for (const cb of listeners.get(collectionId) ?? []) cb();
}

export function subscribeThread(collectionId: number, cb: () => void): () => void {
  if (!listeners.has(collectionId)) listeners.set(collectionId, new Set());
  listeners.get(collectionId)!.add(cb);
  return () => listeners.get(collectionId)?.delete(cb);
}

export function onReplyFinished(collectionId: number, cb: () => void): () => void {
  if (!finished.has(collectionId)) finished.set(collectionId, new Set());
  finished.get(collectionId)!.add(cb);
  return () => finished.get(collectionId)?.delete(cb);
}

export function patchTurn(collectionId: number, id: number, change: (t: VaultTurn) => Partial<VaultTurn>): void {
  setThread(collectionId, (s) => ({
    ...s,
    turns: s.turns.map((t) => (t.id === id && t.who === "vault" ? { ...t, ...change(t) } : t)),
  }));
}

export function isAsking(collectionId: number): boolean {
  return inFlight.has(collectionId);
}

export function stopAsking(collectionId: number): void {
  inFlight.get(collectionId)?.abort();
}

/** Send one message. The request belongs to this module, not to the page, so leaving the page does not stop it. */
export async function ask(collectionId: number, message: string): Promise<void> {
  const m = message.trim().slice(0, 300);
  if (!m || inFlight.has(collectionId)) return;
  const s = getThread(collectionId);
  const base = s.turns.reduce((n, t) => Math.max(n, t.id), 0);
  const you = base + 1;
  const me = base + 2;
  const previous = s.last;
  const controller = new AbortController();
  inFlight.set(collectionId, controller);
  setThread(collectionId, (t) => ({
    ...t,
    turns: [...t.turns, { id: you, who: "you", text: m }, { id: me, who: "vault", events: [], running: true, live: true }],
  }));
  try {
    await askTeam(
      collectionId,
      m,
      previous,
      (ev) => {
        patchTurn(collectionId, me, (t) => ({ events: [...t.events, ev] }));
        if (ev.type === "answer" && ev.kind === "find") setThread(collectionId, (t) => ({ ...t, last: ev.command }));
      },
      controller.signal,
    );
    patchTurn(collectionId, me, () => ({ running: false }));
  } catch (e) {
    patchTurn(collectionId, me, () => ({ running: false, error: controller.signal.aborted ? "Stopped." : errorText(e) }));
  } finally {
    inFlight.delete(collectionId);
    for (const cb of finished.get(collectionId) ?? []) cb();
  }
}
