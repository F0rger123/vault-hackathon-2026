"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MatrixRain } from "./matrix-rain";
import { cx } from "./ui";

export type UnlockPhase = "scanning" | "granted" | "denied" | "locking";

const DONE_MS: Partial<Record<UnlockPhase, number>> = { granted: 1900, denied: 1500, locking: 1100 };

const TITLE: Record<UnlockPhase, string> = {
  scanning: "Verifying identity",
  granted: "Identity verified",
  denied: "Not verified",
  locking: "Locking",
};

/** A head as a cloud of points: an ellipsoid pushed in at the eyes and mouth and out at the nose and brow. */
function buildHead(): [number, number, number][][] {
  const rows: [number, number, number][][] = [];
  const bump = (u: number, v: number, cu: number, cv: number, su: number, sv: number, h: number) =>
    h * Math.exp(-(((u - cu) / su) ** 2) - ((v - cv) / sv) ** 2);
  for (let r = 0; r <= 44; r++) {
    const v = r / 44; // 0 at the crown, 1 under the chin
    const lat = (v - 0.5) * Math.PI;
    const row: [number, number, number][] = [];
    for (let c = 0; c < 60; c++) {
      const lon = (c / 60) * Math.PI * 2 - Math.PI;
      const u = lon / Math.PI;
      let radius = 1;
      radius -= 0.22 * Math.max(0, v - 0.62) * 2; // jaw narrows toward the chin
      radius += bump(u, v, 0, 0.53, 0.09, 0.14, 0.2); // nose
      radius += bump(u, v, 0, 0.38, 0.32, 0.035, 0.05); // brow
      radius -= bump(u, v, -0.17, 0.43, 0.09, 0.035, 0.1); // eye sockets
      radius -= bump(u, v, 0.17, 0.43, 0.09, 0.035, 0.1);
      radius -= bump(u, v, 0, 0.7, 0.14, 0.018, 0.06); // mouth
      radius += bump(u, v, 0, 0.87, 0.14, 0.05, 0.05); // chin
      const cosLat = Math.cos(lat);
      row.push([radius * cosLat * Math.sin(lon) * 0.74, radius * Math.sin(lat) * 1.04, radius * cosLat * Math.cos(lon) * 0.86]);
    }
    rows.push(row);
  }
  return rows;
}

function FaceScan({ phase }: { phase: UnlockPhase }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = getComputedStyle(canvas);
    const ink = css.getPropertyValue("--ink").trim() || "#fff";
    const green = css.getPropertyValue("--green").trim() || "#0f6";
    const red = css.getPropertyValue("--redline").trim() || "#f44";
    const head = buildHead();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 340;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    const start = performance.now();
    let frame = 0;

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const current = phaseRef.current;
      const settled = current === "granted";
      const yaw = reduced ? 0.2 : settled ? 0 : Math.sin(t * 0.9) * 0.55;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const scale = size * 0.36;
      const sweep = reduced ? 0 : Math.sin(t * 1.7);
      const color = current === "denied" ? red : settled ? green : ink;
      ctx.clearRect(0, 0, size, size);
      for (let r = 0; r < head.length; r++) {
        for (let c = 0; c < head[r].length; c++) {
          const [x, y, z] = head[r][c];
          const rx = x * cosY + z * sinY;
          const rz = -x * sinY + z * cosY;
          const px = size / 2 + rx * scale;
          const py = size / 2 + y * scale;
          const depth = (rz + 1) / 2;
          const onSweep = Math.max(0, 1 - Math.abs(y - sweep) * 6);
          const lit = settled ? 0.25 + depth * 0.75 : depth * depth * 0.55 + onSweep * 0.9;
          if (lit < 0.04) continue;
          ctx.globalAlpha = Math.min(1, lit);
          ctx.fillStyle = onSweep > 0.5 && !settled ? green : color;
          const dot = rz > 0 ? 1.5 : 0.9;
          ctx.fillRect(px, py, dot, dot);
        }
      }
      if (!settled && !reduced && current !== "denied") {
        const y = size / 2 + sweep * scale;
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = green;
        ctx.fillRect(size * 0.14, y, size * 0.72, 1);
      }
      ctx.globalAlpha = 1;
      if (!reduced) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className={cx("unlock-reticle relative", phase === "granted" && "unlock-reticle-granted", phase === "denied" && "unlock-reticle-denied")}>
      <canvas ref={ref} aria-hidden style={{ width: 340, height: 340, maxWidth: "76vw", maxHeight: "76vw" }} />
      <span aria-hidden className="unlock-corner left-0 top-0 border-l-2 border-t-2" />
      <span aria-hidden className="unlock-corner right-0 top-0 border-r-2 border-t-2" />
      <span aria-hidden className="unlock-corner bottom-0 left-0 border-b-2 border-l-2" />
      <span aria-hidden className="unlock-corner bottom-0 right-0 border-b-2 border-r-2" />
    </div>
  );
}

/**
 * F10.16: the moment of signing in or locking. It is theatre around the real check: the face or key is verified by the
 * device and the server, and this only shows the result. VAULT never turns on or sees the camera.
 */
export function UnlockSequence({
  phase,
  who,
  detail,
  onDone,
}: {
  phase: UnlockPhase;
  who?: string;
  detail?: string;
  onDone?: () => void;
}) {
  const [typed, setTyped] = useState(0);
  const target = who ?? "";

  useEffect(() => {
    const wait = DONE_MS[phase];
    if (!wait || !onDone) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(onDone, reduced ? 150 : wait);
    return () => window.clearTimeout(timer);
  }, [phase, onDone]);

  useEffect(() => {
    if (phase !== "granted") return;
    const timer = window.setInterval(() => setTyped((n) => n + 1), 45);
    return () => window.clearInterval(timer);
  }, [phase]);

  const open = phase === "granted";
  return createPortal(
    <div role="status" aria-live="assertive" className="unlock-stage fixed inset-0 z-[100] overflow-hidden">
      <div aria-hidden className={cx("unlock-door unlock-door-left", open && "unlock-door-open", phase === "locking" && "unlock-door-closing")} />
      <div aria-hidden className={cx("unlock-door unlock-door-right", open && "unlock-door-open", phase === "locking" && "unlock-door-closing")} />
      <MatrixRain className={cx("absolute inset-0 h-full w-full opacity-30", open && "unlock-fade")} fps={20} />
      <div className={cx("absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center", open && "unlock-content-out")}>
        {phase !== "locking" && <FaceScan phase={phase} />}
        <p className={cx("font-mono text-xl font-medium", phase === "denied" ? "text-redline" : phase === "granted" ? "text-green" : "text-ink")}>
          {TITLE[phase]}
        </p>
        {phase === "granted" && target && <p className="font-mono text-sm text-ink">{target.slice(0, typed)}</p>}
        {detail && <p className="max-w-md text-sm text-muted">{detail}</p>}
      </div>
    </div>,
    document.body,
  );
}
