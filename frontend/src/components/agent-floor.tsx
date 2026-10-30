"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { activityOf, replayDelays, type Activity } from "@/lib/agent-activity";
import type { AgentEvent } from "@/lib/api";
import { laneLabel } from "@/lib/format";
import type { RunModel } from "@/lib/run-model";
import { Button } from "./ui";

const REPLAY_SECONDS = 40;
const FLIGHT_MS = 650;
const WORK_MS = 1400;

interface Box {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  status: string;
  until: number;
  flash: number;
  count: number;
}

interface Packet {
  from: Box;
  to: Box;
  start: number;
  color: "ink" | "green" | "red";
  land?: () => void;
}

/** Fired by the coordinator chat, so a question visibly goes to the coordinator and the answer comes back. */
export const ASK_EVENT = "vault:run-ask";
export type AskDetail = { stage: "asked" | "answered" };

/**
 * F10.16: the agents at work. You talk to the coordinator, the coordinator hands documents to the security gate, the
 * gate passes them to readers, and readers hand results to the reviewer. Each packet is one recorded event.
 */
export function AgentFloor({
  events,
  model,
  file,
  liveFrom,
  finished,
}: {
  events: AgentEvent[];
  model: RunModel;
  file: (id: number | null) => string;
  liveFrom: number | null;
  finished: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [replaying, setReplaying] = useState(false);
  const lanes = useMemo(
    () => model.lanes.filter((l) => !l.blocked).map((l) => ({ lane: l.lane, slots: Math.max(1, Math.min(l.slots, 8)) })),
    [model.lanes],
  );
  const laneKey = JSON.stringify(lanes);
  const engine = useRef<{ play: (a: Activity) => void; ask: (stage: AskDetail["stage"]) => void } | null>(null);
  const fileRef = useRef(file);
  useEffect(() => {
    fileRef.current = file;
  }, [file]);

  useEffect(() => {
    const el = canvas.current;
    const host = wrap.current;
    const ctx = el?.getContext("2d");
    if (!el || !host || !ctx) return;
    const parsed: { lane: string; slots: number }[] = JSON.parse(laneKey);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    const box = (id: string, title: string): Box => ({ id, title, x: 0, y: 0, w: 0, h: 0, status: "", until: 0, flash: 0, count: 0 });
    const you = box("you", "You");
    const coordinator = box("coordinator", "Coordinator");
    const gate = box("security", "Security gate");
    const reviewer = box("reviewer", "Reviewer");
    const readers = new Map<string, Box[]>();
    for (const l of parsed) {
      readers.set(
        l.lane,
        Array.from({ length: l.slots }, (_, i) => box(`${l.lane}:${i}`, l.slots > 1 ? `Reader ${i + 1}` : laneLabel(l.lane))),
      );
    }
    const allReaders = () => [...readers.values()].flat();
    const turns = new Map<string, number>();
    const packets: Packet[] = [];

    const layout = () => {
      const rect = host.getBoundingClientRect();
      width = rect.width;
      const narrow = width < 640;
      const list = allReaders();
      const rowH = narrow ? 48 : 62;
      height = Math.max(narrow ? 280 : 230, 24 + Math.ceil(list.length / (narrow ? 1 : 2)) * rowH);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = width * dpr;
      el.height = height * dpr;
      el.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const col = width / (narrow ? 4.6 : 6);
      const w = Math.min(col * 0.86, 170);
      const h = narrow ? 44 : 58;
      const mid = height / 2;
      const place = (b: Box, x: number, y: number, bw = w, bh = h) => Object.assign(b, { x, y: y - bh / 2, w: bw, h: bh });
      if (narrow) {
        place(you, 4, 36, w * 0.7);
        place(coordinator, 4, mid);
        place(gate, col, mid);
        place(reviewer, width - w - 4, mid);
        list.forEach((b, i) => place(b, col * 2 + 2, ((i + 0.5) / list.length) * (height - 16) + 8, col - 4, rowH - 6));
      } else {
        place(you, 8, mid, w * 0.6);
        place(coordinator, col * 0.95, mid);
        place(gate, col * 2, mid);
        place(reviewer, width - w - 8, mid);
        const perCol = Math.ceil(list.length / 2) || 1;
        list.forEach((b, i) => {
          const c = i % 2;
          const r = Math.floor(i / 2);
          place(b, col * 3.02 + c * (w * 0.9), ((r + 0.5) / perCol) * (height - 24) + 12, w * 0.84, rowH - 8);
        });
      }
    };

    const centre = (b: Box) => [b.x + b.w / 2, b.y + b.h / 2] as const;
    const send = (from: Box, to: Box, color: Packet["color"], land?: () => void, delay = 0) =>
      packets.push({ from, to, start: performance.now() + delay, color, land });
    const work = (b: Box, status: string) => {
      b.status = status;
      b.until = performance.now() + WORK_MS;
      b.flash = performance.now();
      b.count += 1;
    };

    const play = (a: Activity) => {
      const name = fileRef.current(a.document_id);
      if (a.verb === "planned") {
        work(coordinator, "Planning the run");
        for (const r of allReaders()) send(coordinator, r, "ink");
        send(coordinator, gate, "ink");
      } else if (a.verb === "screened") {
        send(coordinator, gate, "green", () => work(gate, `Held local: ${name}`));
      } else if (a.verb === "read" || a.verb === "retried") {
        const slots = readers.get(a.lane ?? "");
        if (!slots?.length) return;
        const turn = turns.get(a.lane!) ?? 0;
        turns.set(a.lane!, turn + 1);
        const slot = slots[turn % slots.length];
        send(coordinator, gate, "ink", () => {
          work(gate, name);
          send(gate, slot, a.verb === "retried" ? "red" : "ink", () => work(slot, name));
        });
      } else if (a.verb === "reviewed") {
        const from = allReaders().sort((x, y) => y.until - x.until)[0] ?? gate;
        send(from, reviewer, "green", () => work(reviewer, name));
      } else if (a.verb === "finished") {
        send(reviewer, coordinator, "green", () => work(coordinator, "Run closed"));
        send(coordinator, you, "green", () => work(you, "Results are ready"), FLIGHT_MS);
      }
    };
    engine.current = {
      play,
      ask: (stage) => {
        if (stage === "asked") send(you, coordinator, "ink", () => work(coordinator, "Reading the run records"));
        else send(coordinator, you, "green", () => work(you, "Answered"));
      },
    };

    let colors = { ink: "#fff", muted: "#888", line: "#333", panel: "#111", green: "#0f6", red: "#f44", mono: "monospace" };
    const readColors = () => {
      const css = getComputedStyle(host);
      const v = (n: string) => css.getPropertyValue(n).trim();
      colors = {
        ink: v("--ink"),
        muted: v("--muted"),
        line: v("--line-strong"),
        panel: v("--panel"),
        green: v("--green"),
        red: v("--redline"),
        mono: `${getComputedStyle(document.body).getPropertyValue("--font-data")}, monospace`,
      };
    };
    const links = (): [Box, Box][] => {
      const list = allReaders();
      return [[you, coordinator], [coordinator, gate], ...list.map((r) => [gate, r] as [Box, Box]), ...list.map((r) => [r, reviewer] as [Box, Box])];
    };
    const clip = (text: string, max: number) => {
      if (ctx.measureText(text).width <= max) return text;
      let s = text;
      while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
      return `${s}…`;
    };
    const drawBox = (b: Box, now: number) => {
      const busy = now < b.until;
      const hit = Math.max(0, 1 - (now - b.flash) / 500);
      ctx.fillStyle = colors.panel;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = busy ? colors.ink : colors.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      if (hit > 0) {
        ctx.globalAlpha = hit * 0.35;
        ctx.fillStyle = colors.ink;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.globalAlpha = 1;
      }
      if (busy) {
        // A corner tick runs round the box for as long as the agent is on its last recorded job.
        const p = ((now % 1000) / 1000) * (b.w * 2 + b.h * 2);
        ctx.fillStyle = colors.green;
        const [tx, ty] =
          p < b.w ? [b.x + p, b.y] : p < b.w + b.h ? [b.x + b.w, b.y + p - b.w] : p < b.w * 2 + b.h ? [b.x + b.w * 2 + b.h - p, b.y + b.h] : [b.x, b.y + b.w * 2 + b.h * 2 - p];
        ctx.fillRect(tx - 2, ty - 2, 4, 4);
      }
      const pad = 8;
      ctx.textBaseline = "top";
      ctx.font = `600 13px ${colors.mono}`;
      ctx.fillStyle = colors.ink;
      ctx.fillText(clip(b.title, b.w - pad * 2), b.x + pad, b.y + 6);
      ctx.font = `12px ${colors.mono}`;
      ctx.fillStyle = busy ? colors.green : colors.muted;
      const text = busy ? b.status : b.count ? `${b.count} done` : "Idle";
      if (b.h >= 34) ctx.fillText(clip(text, b.w - pad * 2), b.x + pad, b.y + b.h - 18);
    };

    let frame = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (document.hidden) return;
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [a, b] of links()) {
        const [ax, ay] = centre(a);
        const [bx, by] = centre(b);
        ctx.moveTo(ax, ay);
        ctx.bezierCurveTo((ax + bx) / 2, ay, (ax + bx) / 2, by, bx, by);
      }
      ctx.stroke();
      for (const b of [you, coordinator, gate, reviewer, ...allReaders()]) drawBox(b, now);
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i];
        const t = (now - p.start) / FLIGHT_MS;
        if (t < 0) continue;
        if (t >= 1) {
          packets.splice(i, 1);
          p.land?.();
          continue;
        }
        const [ax, ay] = centre(p.from);
        const [bx, by] = centre(p.to);
        const color = p.color === "green" ? colors.green : p.color === "red" ? colors.red : colors.ink;
        for (let k = 0; k < 7; k++) {
          const q = Math.max(0, t - k * 0.025);
          const m = 1 - q;
          const mx = (ax + bx) / 2;
          const x = m * m * m * ax + 3 * m * m * q * mx + 3 * m * q * q * mx + q * q * q * bx;
          const y = m * m * m * ay + 3 * m * m * q * ay + 3 * m * q * q * by + q * q * q * by;
          ctx.globalAlpha = 1 - k / 7;
          ctx.fillStyle = color;
          const s = k === 0 ? 5 : 3;
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
        ctx.globalAlpha = 1;
      }
    };

    readColors();
    layout();
    const sizer = new ResizeObserver(layout);
    sizer.observe(host);
    const theme = new MutationObserver(readColors);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    frame = requestAnimationFrame(draw);
    if (reduced) {
      // Still shows the agents and their totals, without anything flying.
      cancelAnimationFrame(frame);
      draw(performance.now());
      cancelAnimationFrame(frame);
    }
    return () => {
      cancelAnimationFrame(frame);
      sizer.disconnect();
      theme.disconnect();
      engine.current = null;
    };
  }, [laneKey]);

  // Live: each new event plays as it arrives.
  const played = useRef(0);
  useEffect(() => {
    if (liveFrom === null) return;
    for (const e of events) {
      if (e.id <= Math.max(liveFrom, played.current)) continue;
      played.current = e.id;
      const a = activityOf(e);
      if (a) engine.current?.play(a);
    }
  }, [events, liveFrom]);

  useEffect(() => {
    const onAsk = (ev: Event) => engine.current?.ask((ev as CustomEvent<AskDetail>).detail.stage);
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, []);

  // Replay: the record of a finished run, compressed. Starts once by itself, the first time the floor is on screen.
  const timers = useRef<number[]>([]);
  const replay = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    const items = events.map(activityOf).filter((a): a is Activity => a !== null);
    const delays = replayDelays(items, REPLAY_SECONDS);
    setReplaying(true);
    timers.current = items.map((a, i) => window.setTimeout(() => engine.current?.play(a), delays[i]));
    timers.current.push(window.setTimeout(() => setReplaying(false), REPLAY_SECONDS * 1000 + 800));
  };
  const replayRef = useRef(replay);
  useEffect(() => {
    replayRef.current = replay;
  });
  const started = useRef(false);
  const ready = finished && liveFrom !== null && events.length > 0;
  useEffect(() => {
    if (!ready || started.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    started.current = true;
    const handle = window.setTimeout(() => replayRef.current(), 200);
    return () => window.clearTimeout(handle);
  }, [ready]);
  useEffect(() => {
    const list = timers;
    return () => list.current.forEach((t) => window.clearTimeout(t));
  }, []);

  return (
    <section aria-label="Agents at work" className="rounded-card border border-line bg-panel p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-sm">
          {finished ? (replaying ? `Replaying the record of this run, ${REPLAY_SECONDS} s` : "Record of this run") : "Live: each packet is one recorded event"}
        </p>
        {finished && (
          <Button variant="quiet" disabled={!events.length} onClick={replay}>
            Replay the run
          </Button>
        )}
      </div>
      <div ref={wrap} className="relative w-full">
        <canvas
          ref={canvas}
          role="img"
          aria-label="You talk to the coordinator, which hands documents to the security gate, then to the readers, then to the reviewer. The event log below lists the same work as text."
          className="block w-full"
        />
      </div>
    </section>
  );
}
