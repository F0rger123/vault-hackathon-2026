"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Human } from "@vladmandic/human";
import {
  LIVENESS,
  loadFace,
  measureFace,
  pose,
  qualityProblems,
  QUALITY,
  read,
  silhouette,
  type CameraQuality,
  type FaceChallenge,
  type FaceReading,
  type LiveAnswer,
  type LiveFrame,
  type Move,
  type Pose,
} from "@/lib/face";
import { Loader } from "./loader";
import { Button, cx } from "./ui";

/** What the page says once the server answered: passed, or failed with the reason (`final`: no retry here). */
export type FaceOutcome = { ok: true; note?: ReactNode } | { ok: false; reason: string; final?: boolean };

const NEED = { enroll: 5, verify: 3, test: 3 } as const;
const MIN_SIZE = 0.22; // the face must fill about a fifth of the picture width
const DETECT_MS = 66; // a steady 15 readings a second, never two at once
const READING_GAP_MS = 650; // readings spaced so each one is visible, and taken at slightly different moments
const LOCK_FRAMES = 4; // good frames in a row before the outline locks on
const TRACE_MS = 900; // the outline drawing round the face
const POOR_MS = 5000; // light or focus failing this long, with a face in view, means the camera is not good enough here
const SLOW_CAMERA_MS = 4000;
const LOST_MS = 350; // the face may leave the picture this long during a challenge (the server allows 400 ms)
const SMOOTH = 0.32; // per painted frame: how far the drawn outline moves toward the newest reading
const FRONT_YAW = 8;
const GREEN = "#00e676"; // the camera stage is always dark, so the bright green reads in both themes

const ARROW: Record<Move, string> = { left: "←", right: "→", up: "↑", blink: "◡" };
const PROMPT: Record<Move, string> = {
  left: "Turn your head to the left",
  right: "Turn your head to the right",
  up: "Look up",
  blink: "Blink slowly",
};

type Phase = "starting" | "lock" | "asking" | "challenge" | "submit" | "passed" | "failed" | "poor" | "error";

interface Ui {
  phase: Phase;
  cameraOn: boolean;
  modelsReady: boolean;
  slowCamera: boolean;
  reading: FaceReading | null;
  quality: CameraQuality | null;
  poor: string[] | null;
  hint: string;
  readings: number;
  moves: Move[];
  movesDone: number;
  reason: string | null;
  final: boolean;
  note: ReactNode;
  wrongWay: boolean;
}

const START: Ui = {
  phase: "starting",
  cameraOn: false,
  modelsReady: false,
  slowCamera: false,
  reading: null,
  quality: null,
  poor: null,
  hint: "Look at the camera",
  readings: 0,
  moves: [],
  movesDone: 0,
  reason: null,
  final: false,
  note: null,
  wrongWay: false,
};

/**
 * F09.19, rebuilt in F09.22: the face check. One detection loop runs at a steady rate; the picture is the live video
 * (never repainted per detection), and the overlay is painted every display frame from smoothed points, so nothing
 * jitters. The steps: (1) an outline traces the face when it locks on; (2) the screen goes dark round the face mesh and
 * a scan line sweeps while the person follows two random moves the server asked for, one lit segment per move done;
 * (3) the server's answer decides: passed, or a red lock-down with the reason and a retry.
 *
 * Only numbers leave the page: per-frame head turn, tilt, eye openness and Human's scores, plus face fingerprints.
 */
export function FaceCapture({
  mode,
  challenge,
  onDone,
  onCancel,
  poorCamera,
}: {
  mode: "enroll" | "verify" | "test";
  challenge: () => Promise<FaceChallenge>;
  onDone: (a: LiveAnswer) => Promise<FaceOutcome>;
  onCancel: () => void;
  poorCamera?: (problems: string[]) => ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [ui, setUi] = useState<Ui>(START);
  const props = useRef({ mode, challenge, onDone });
  const retry = useRef<() => void>(() => {});
  useEffect(() => {
    props.current = { mode, challenge, onDone };
  }, [mode, challenge, onDone]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let human: Human | null = null;
    let paintFrame = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const measure = document.createElement("canvas");
    const need = NEED[props.current.mode];

    // Everything the loops share lives here, outside React, so a reading never restarts the camera or the loop.
    const s = {
      phase: "starting" as Phase,
      q: { width: 0, height: 0, fps: 0, brightness: 0, sharpness: 0, face_px: 0 } as CameraQuality,
      ticks: 0,
      poorStart: 0,
      poorShown: false,
      good: 0,
      traceStart: 0,
      ch: null as FaceChallenge | null,
      t0: 0,
      frames: [] as LiveFrame[],
      embeds: [] as { t: number; v: number[] }[],
      lastReading: 0,
      base: null as Pose | null,
      moveIdx: 0,
      closedAt: -1,
      lastFace: 0,
      resultAt: 0,
      // Smoothed drawing state.
      box: null as [number, number, number, number] | null,
      outline: [] as [number, number][],
      mesh: [] as [number, number][],
      target: null as { box: [number, number, number, number]; outline: [number, number][]; mesh: [number, number][] } | null,
      ok: false,
    };
    let uiTimer = 0;
    let pending: Partial<Ui> = {};
    const push = (patch: Partial<Ui>, now = false) => {
      pending = { ...pending, ...patch };
      if (now || !uiTimer) {
        const flush = () => {
          uiTimer = 0;
          if (stopped) return;
          const p = pending;
          pending = {};
          setUi((u) => ({ ...u, ...p }));
        };
        if (now) {
          window.clearTimeout(uiTimer);
          flush();
        } else uiTimer = window.setTimeout(flush, 150); // coarse text and scores, a few times a second
      }
    };
    const setPhase = (phase: Phase, extra: Partial<Ui> = {}) => {
      s.phase = phase;
      push({ phase, ...extra }, true);
    };
    const fail = (reason: string, final = false) => {
      s.ch = null;
      s.resultAt = performance.now();
      setPhase("failed", { reason, final });
    };
    const stopCamera = () => stream?.getTracks().forEach((t) => t.stop());

    retry.current = () => {
      s.ch = null;
      s.good = 0;
      s.traceStart = 0;
      s.frames = [];
      s.embeds = [];
      s.base = null;
      setPhase("lock", { reason: null, final: false, readings: 0, movesDone: 0, moves: [], note: null, wrongWay: false });
    };

    const begin = async () => {
      s.phase = "asking";
      push({ phase: "asking" }, true);
      try {
        const ch = await props.current.challenge();
        if (stopped || s.phase !== "asking") return;
        s.ch = ch;
        s.t0 = performance.now();
        s.frames = [];
        s.embeds = [];
        s.lastReading = 0;
        s.base = null;
        s.moveIdx = 0;
        s.closedAt = -1;
        s.lastFace = s.t0;
        setPhase("challenge", { moves: ch.moves, movesDone: 0, readings: 0, wrongWay: false });
      } catch (e) {
        const text = e instanceof Error ? e.message : "The face check could not start.";
        fail(text, /start again|took too long/.test(text));
      }
    };

    const submit = async () => {
      const ch = s.ch!;
      setPhase("submit");
      const a: LiveAnswer = { challenge: ch.id, frames: s.frames, embeddings: s.embeds, quality: s.q };
      s.ch = null;
      try {
        const out = await props.current.onDone(a);
        if (stopped) return;
        s.resultAt = performance.now();
        if (out.ok) {
          setPhase("passed", { note: out.note ?? null });
          stopCamera();
        } else setPhase("failed", { reason: out.reason, final: !!out.final });
      } catch (e) {
        fail(e instanceof Error ? e.message : "VAULT could not check the face.");
      }
    };

    // One reading during a challenge: record the numbers, follow the moves, take fingerprints at the right moments.
    const follow = (t: number, r: FaceReading, p: Pose | null, frontalGood: boolean) => {
      const ch = s.ch;
      if (!ch) return;
      const elapsed = t - s.t0;
      if (elapsed > ch.seconds * 1000 - 1500) return fail("Time ran out. Follow the prompts a little faster, then try again.");
      if (!r.face || !p) {
        if (t - s.lastFace > LOST_MS) fail("Keep your face in the picture until the check is done.");
        return;
      }
      s.lastFace = t;
      if (s.frames.length && elapsed - s.frames[s.frames.length - 1].t < 1) return;
      s.frames.push({ t: Math.round(elapsed), yaw: p.yaw, pitch: p.pitch, eye: p.eye, live: r.live, real: r.real });
      if (s.frames.length === 3) {
        const med = (k: keyof Pose) => [...s.frames.map((f) => f[k])].sort((a, b) => a - b)[1];
        s.base = { yaw: med("yaw"), pitch: med("pitch"), eye: med("eye") };
      }
      const b = s.base;
      if (!b) return;
      const dy = p.yaw - b.yaw;
      const dp = p.pitch - b.pitch;
      const centred = Math.abs(dy) < 6 && Math.abs(dp) < 5;
      const now: Move[] = [];
      if (dy <= -LIVENESS.yaw) now.push("left");
      if (dy >= LIVENESS.yaw) now.push("right");
      if (dp >= LIVENESS.pitch) now.push("up");
      if (b.eye > 0 && p.eye <= LIVENESS.blink * b.eye && Math.abs(dy) < LIVENESS.yaw) {
        if (s.closedAt < 0) s.closedAt = elapsed;
      } else if (s.closedAt >= 0 && p.eye >= LIVENESS.reopen * b.eye) {
        s.closedAt = -1;
        now.push("blink");
      }
      // Readings: before the first move, between moves, and after the last, while looking straight at the camera.
      const doneMoves = s.moveIdx;
      const want = wantFor(need, doneMoves, ch.moves.length);
      const canRead = s.embeds.length < want && frontalGood && centred && r.embedding && elapsed - s.lastReading > READING_GAP_MS;
      if (canRead) {
        s.lastReading = elapsed;
        s.embeds.push({ t: Math.round(elapsed), v: r.embedding! });
        push({ readings: s.embeds.length }, true);
      }
      const ready = s.embeds.length >= want;
      if (doneMoves < ch.moves.length) {
        const asked = ch.moves[doneMoves];
        // A head move nobody asked for spoils the attempt on the server too, so say so now.
        const wrong = now.find((m) => m !== "blink" && m !== asked && !ch.moves.slice(0, doneMoves).includes(m));
        if (wrong) {
          return fail(`That was "${PROMPT[wrong].toLowerCase()}". VAULT asked you to ${PROMPT[asked].toLowerCase()}. Try again and follow the arrow.`);
        }
        if (ready && now.includes(asked)) {
          s.moveIdx += 1;
          push({ movesDone: s.moveIdx }, true);
        }
      } else if (s.embeds.length >= need) void submit();
    };

    const detect = async () => {
      while (!stopped) {
        const started = performance.now();
        const v = video.current;
        if (human && v && v.readyState >= 2 && (s.phase === "lock" || s.phase === "asking" || s.phase === "challenge")) {
          let result;
          try {
            result = await human.detect(v);
          } catch {
            result = null;
          }
          if (stopped) return;
          if (result) {
            const faces = result.face;
            const r = read(faces.length === 1 ? faces[0] : undefined, v.videoWidth || 640);
            const p = r.face ? pose(r.face.mesh) : null;
            if (r.face && s.ticks++ % 4 === 0) {
              if (measure.width !== v.videoWidth) measure.width = v.videoWidth;
              if (measure.height !== v.videoHeight) measure.height = v.videoHeight;
              const ctx = measure.getContext("2d", { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(v, 0, 0, measure.width, measure.height);
                s.q = { ...s.q, ...measureFace(ctx, r.face.box), face_px: r.face.box[2] };
              }
            }
            const t = performance.now();
            const problems = r.face && s.q.face_px ? qualityProblems(s.q) : [];
            if (problems.length) {
              s.poorStart ||= t;
              if (!s.poorShown && t - s.poorStart > POOR_MS) {
                s.poorShown = true;
                push({ poor: problems }, true);
              }
            } else s.poorStart = 0;
            const passive = r.live >= LIVENESS.live && r.real >= LIVENESS.real;
            const good = !!r.face && !!r.embedding && r.size >= MIN_SIZE && !problems.length && s.q.face_px > 0;
            const frontal = !!p && Math.abs(p.yaw) < FRONT_YAW;
            s.ok = good && passive;
            if (r.face) {
              s.target = {
                box: r.face.box,
                outline: silhouette(r.face),
                mesh: r.face.mesh.filter((_, i) => i % 3 === 0).map((m) => [m[0], m[1]] as [number, number]),
              };
            } else s.target = null;
            if (s.phase === "lock") {
              s.good = good && passive && frontal ? s.good + 1 : 0;
              if (s.good >= LOCK_FRAMES && !s.traceStart) s.traceStart = t;
              if (!s.ok) s.traceStart = 0;
              if (s.traceStart && t - s.traceStart >= (reduce ? 0 : TRACE_MS)) void begin();
            } else if (s.phase === "challenge") follow(t, r, p, good && frontal);
            push({ reading: r, quality: s.q, hint: hintFor(r, problems, passive, faces.length) });
          }
        }
        const wait = Math.max(0, DETECT_MS - (performance.now() - started));
        await new Promise((res) => window.setTimeout(res, wait || 16));
      }
    };

    const paint = () => {
      if (stopped) return;
      paintFrame = requestAnimationFrame(paint);
      const c = overlay.current;
      const v = video.current;
      if (!c || !v || !v.videoWidth) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = c.clientWidth;
      const chh = c.clientHeight;
      if (c.width !== Math.round(cw * dpr)) c.width = Math.round(cw * dpr);
      if (c.height !== Math.round(chh * dpr)) c.height = Math.round(chh * dpr);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, chh);
      // The video is shown mirrored and cropped to fill (object-fit: cover); map its pixels the same way.
      const k = Math.max(cw / v.videoWidth, chh / v.videoHeight);
      const ox = (cw - v.videoWidth * k) / 2;
      const oy = (chh - v.videoHeight * k) / 2;
      const X = (x: number) => cw - (ox + x * k);
      const Y = (y: number) => oy + y * k;
      const tg = s.target;
      const ease = (a: number, b: number) => a + (b - a) * SMOOTH;
      if (tg) {
        s.box = s.box ? (s.box.map((x, i) => ease(x, tg.box[i])) as [number, number, number, number]) : tg.box;
        s.outline = s.outline.length === tg.outline.length ? s.outline.map((p, i) => [ease(p[0], tg.outline[i][0]), ease(p[1], tg.outline[i][1])]) : tg.outline;
        s.mesh = s.mesh.length === tg.mesh.length ? s.mesh.map((p, i) => [ease(p[0], tg.mesh[i][0]), ease(p[1], tg.mesh[i][1])]) : tg.mesh;
      }
      const t = performance.now();
      const phase = s.phase;
      const green = GREEN;
      const scanning = phase === "asking" || phase === "challenge" || phase === "submit";
      const ended = phase === "passed" || phase === "failed";
      if (scanning || ended) {
        // (2) Black out the picture round the face; the face shows dimly inside its own outline.
        ctx.fillStyle = "rgba(0,0,0,0.86)";
        ctx.fillRect(0, 0, cw, chh);
        if (s.outline.length > 2 && !ended) {
          ctx.save();
          ctx.globalCompositeOperation = "destination-out";
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.beginPath();
          s.outline.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
      if (!tg && !ended) {
        // No face: a dashed guide where the face should go.
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.setLineDash([6, 8]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cw / 2, chh / 2, Math.min(cw, chh) * 0.24, Math.min(cw, chh) * 0.32, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }
      if (!s.box) return;
      const [bx, by, bw, bh] = s.box;
      const cx0 = X(bx + bw / 2);
      const cy0 = Y(by + bh / 2);
      const R = Math.max(bw, bh) * k * 0.68;
      if (scanning) {
        // Mesh points light up as the scan line passes them.
        const top = Y(by) - bh * k * 0.1;
        const height = bh * k * 1.2;
        const sweep = reduce ? 0.5 : ((t / 1600) % 1);
        const lineY = top + height * sweep;
        for (const [x, y] of s.mesh) {
          const d = Math.abs(Y(y) - lineY);
          const a = reduce ? 0.55 : 0.25 + Math.max(0, 1 - d / 28) * 0.75;
          ctx.fillStyle = `rgba(0,230,118,${a.toFixed(2)})`;
          ctx.fillRect(X(x) - 1, Y(y) - 1, 2, 2);
        }
        if (!reduce) {
          const grad = ctx.createLinearGradient(0, lineY - 26, 0, lineY + 4);
          grad.addColorStop(0, "rgba(0,230,118,0)");
          grad.addColorStop(1, "rgba(0,230,118,0.35)");
          ctx.fillStyle = grad;
          ctx.fillRect(cx0 - R, lineY - 26, R * 2, 30);
          ctx.fillStyle = green;
          ctx.fillRect(cx0 - R, lineY, R * 2, 1.5);
        }
      }
      // (1) The outline: traced once as the face locks on, then held.
      const trace = phase === "lock" ? (s.traceStart ? Math.min(1, (t - s.traceStart) / TRACE_MS) : 0) : 1;
      if (s.outline.length > 2 && (trace > 0 || scanning || ended)) {
        const pts = s.outline.map(([x, y]) => [X(x), Y(y)] as [number, number]);
        pts.push(pts[0]);
        const n = (pts.length - 1) * (reduce ? 1 : trace);
        const color = phase === "failed" ? "#ff4d4d" : green;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        let i = 1;
        for (; i <= Math.floor(n); i++) ctx.lineTo(pts[i][0], pts[i][1]);
        const f = n - Math.floor(n);
        if (f > 0 && i < pts.length) {
          const [ax, ay] = pts[i - 1];
          const [ex, ey] = pts[i];
          ctx.lineTo(ax + (ex - ax) * f, ay + (ey - ay) * f);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        if (trace < 1 && !reduce) {
          const j = Math.min(pts.length - 1, Math.floor(n));
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(pts[j][0], pts[j][1], 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Corner marks round the face (the logo's trim marks), green when the reading is good.
      if (phase === "lock" || phase === "starting") {
        const hw = (bw * k) / 2;
        const hh = (bh * k) / 2;
        const l = Math.min(hw, hh) * 0.32;
        ctx.strokeStyle = s.ok ? green : "rgba(255,255,255,0.9)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          const x = cx0 + sx * hw;
          const y = cy0 + sy * hh;
          ctx.moveTo(x, y - sy * l);
          ctx.lineTo(x, y);
          ctx.lineTo(x - sx * l, y);
        }
        ctx.stroke();
      }
      // The progress ring: one segment per move asked for, lit as each one is done.
      if (scanning || ended) {
        const moves = s.ch?.moves.length ?? 2;
        const done = phase === "passed" ? moves : s.moveIdx;
        const gap = 0.12;
        for (let i = 0; i < moves; i++) {
          const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / moves + gap / 2;
          const a1 = a0 + (2 * Math.PI) / moves - gap;
          ctx.strokeStyle = phase === "failed" ? "#ff4d4d" : i < done ? green : "rgba(255,255,255,0.25)";
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(cx0, cy0, R * 1.08, a0, a1);
          ctx.stroke();
        }
      }
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This window cannot use a camera.");
        // Camera and models start together: the picture shows as soon as the camera is on, not after 12 MB of models.
        const slow = window.setTimeout(() => push({ slowCamera: true }, true), SLOW_CAMERA_MS);
        const models = loadFace().then((h) => {
          human = h;
          push({ modelsReady: true }, true);
          return h;
        });
        models.catch(() => {});
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          audio: false,
        });
        window.clearTimeout(slow);
        if (stopped || !video.current) return stopCamera();
        video.current.srcObject = stream;
        await video.current.play();
        const settings = stream.getVideoTracks()[0]?.getSettings() ?? {};
        s.q = { ...s.q, width: video.current.videoWidth, height: video.current.videoHeight, fps: settings.frameRate ?? 0 };
        push({ cameraOn: true, slowCamera: false, quality: s.q }, true);
        const camera = qualityProblems({ ...s.q, face_px: 0 });
        if (camera.length) {
          // The camera itself is below the minimum: no reading can pass, so stop here and say what to do instead.
          stopCamera();
          setPhase("poor", { poor: camera });
          return;
        }
        paintFrame = requestAnimationFrame(paint);
        await models;
        if (stopped) return;
        setPhase("lock");
        void detect();
      } catch (e) {
        if (stopped) return;
        const name = e instanceof DOMException ? e.name : "";
        setPhase("error", {
          reason:
            name === "NotAllowedError"
              ? "Camera access was refused. Allow the camera for VAULT in the browser's address bar, then try again."
              : name === "NotFoundError"
                ? "No camera was found on this computer."
                : name === "NotReadableError"
                  ? "Another app is using the camera. Close Teams, Zoom or the Camera app, then try again."
                  : e instanceof Error
                    ? e.message
                    : "The face check could not start.",
        });
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(uiTimer);
      cancelAnimationFrame(paintFrame);
      stopCamera();
    };
  }, []);

  const { phase, reading, quality } = ui;
  const need = NEED[mode];
  const live = phase === "lock" || phase === "asking" || phase === "challenge" || phase === "submit";
  const asked = phase === "challenge" && ui.movesDone < ui.moves.length ? ui.moves[ui.movesDone] : null;
  const straight = phase === "challenge" && !asked;
  const caption =
    phase === "submit"
      ? mode === "enroll"
        ? "Saving your face check"
        : "Checking with VAULT"
      : phase === "asking"
        ? "Locked on. Getting your challenge"
        : phase === "challenge"
          ? straight
            ? "Look straight at the camera"
            : ui.readings < wantFor(need, ui.movesDone, ui.moves.length)
              ? "Hold still and look straight at the camera"
              : PROMPT[asked!]
          : ui.hint;

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div
        className={cx(
          "scan-stage relative w-full max-w-[440px] overflow-hidden rounded-card border border-line-strong",
          phase === "poor" ? "aspect-[2/1]" : "aspect-[4/5] sm:aspect-[4/3]",
          phase === "failed" && "face-lockdown",
          phase === "passed" && "face-granted",
        )}
        data-phase={phase}
      >
        <video ref={video} playsInline muted className={cx("absolute inset-0 h-full w-full -scale-x-100 object-cover transition-opacity duration-500", ui.cameraOn ? "opacity-100" : "opacity-0")} />
        <canvas ref={overlay} className="absolute inset-0 h-full w-full" aria-label="Camera with the face VAULT detected" />

        {live && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-2.5 pt-2.5 font-mono text-[11px] text-white/85">
            <span key={ui.readings} className={cx("rounded-full bg-black/60 px-2 py-0.5", ui.readings > 0 && "pop-in")}>
              {ui.readings ? `Reading ${ui.readings} of ${need} accepted` : `Reading 0 of ${need}`}
            </span>
            {ui.moves.length > 0 && (
              <span className="rounded-full bg-black/60 px-2 py-0.5">
                Move {Math.min(ui.movesDone + 1, ui.moves.length)} of {ui.moves.length}
              </span>
            )}
            {!ui.moves.length && quality && (
              <span className="rounded-full bg-black/60 px-2 py-0.5">
                {quality.width}×{quality.height}
                {quality.fps ? `, ${quality.fps.toFixed(0)} fps` : ""}
              </span>
            )}
          </div>
        )}
        {asked && ui.readings >= wantFor(need, ui.movesDone, ui.moves.length) && (
          <div key={`${asked}-${ui.movesDone}`} className="face-prompt pointer-events-none absolute inset-x-0 top-10 flex justify-center" aria-hidden>
            <span className={cx("face-arrow grid h-14 w-14 place-items-center rounded-full border border-green/70 bg-black/70 text-3xl text-green", `face-arrow-${asked}`)}>
              {ARROW[asked]}
            </span>
          </div>
        )}
        {(live || phase === "starting") && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-3 pb-3">
            <p aria-live="polite" className="rounded-full border border-white/15 bg-black/70 px-3 py-1 text-[13px] font-medium text-white backdrop-blur-sm">
              {phase === "submit" ? <Loader className="text-[13px] text-white" size={13} label={caption} /> : phase === "starting" ? "Starting the camera" : caption}
            </p>
          </div>
        )}
        {phase === "lock" && !ui.modelsReady && (
          <div className="pointer-events-none absolute inset-x-0 top-10 flex justify-center">
            <Loader className="rounded-full bg-black/70 px-3 py-1 text-xs text-white/85" size={12} label="Loading the face models (first time only)" />
          </div>
        )}
        {phase === "starting" && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
            <span className="flex max-w-[300px] flex-col items-center gap-3">
              <Loader className="text-white/80" label={ui.modelsReady || ui.cameraOn ? "Starting the camera" : "Starting the camera and loading the face models"} />
              {ui.slowCamera && (
                <span className="text-xs text-white/70">
                  Still waiting for the camera. The browser may be asking for permission (look near the address bar), or another
                  app such as Teams, Zoom or the Camera app is using it.
                </span>
              )}
            </span>
          </div>
        )}
        {phase === "passed" && <Granted mode={mode} />}
        {phase === "failed" && <LockDown reason={ui.reason ?? "The face check did not pass."} />}
        {phase === "poor" && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">
            <span className="flex flex-col items-center gap-3">
              <CameraOff />
              This camera is below VAULT&apos;s minimum for a face check.
            </span>
          </div>
        )}
      </div>

      {phase === "lock" && quality && (
        <dl className="grid w-full max-w-[440px] grid-cols-3 gap-1.5 text-xs" aria-label="Camera quality">
          <Score label="Camera" ok={quality.width >= QUALITY.width && quality.height >= QUALITY.height} value={`${quality.height}p`} fill={1} />
          <Score
            label="Light"
            ok={quality.brightness >= QUALITY.brightness[0] && quality.brightness <= QUALITY.brightness[1]}
            value={quality.face_px ? quality.brightness.toFixed(0) : "–"}
            fill={quality.face_px ? quality.brightness / 255 : 0}
          />
          <Score
            label="Sharp"
            ok={quality.sharpness >= QUALITY.sharpness}
            value={quality.face_px ? quality.sharpness.toFixed(0) : "–"}
            fill={quality.face_px ? Math.min(1, quality.sharpness / (QUALITY.sharpness * 4)) : 0}
          />
          <Score label="Face found" ok={!!reading?.face && reading.size >= MIN_SIZE} value={reading?.face ? `${Math.round((reading.size ?? 0) * 100)}% wide` : "no"} fill={Math.min(1, (reading?.size ?? 0) / 0.5)} />
          <Score label="Live person" ok={(reading?.live ?? 0) >= LIVENESS.live} value={(reading?.live ?? 0).toFixed(2)} fill={reading?.live ?? 0} />
          <Score label="Real, not a photo" ok={(reading?.real ?? 0) >= LIVENESS.real} value={(reading?.real ?? 0).toFixed(2)} fill={reading?.real ?? 0} />
        </dl>
      )}
      {live && (
        <p className="max-w-[440px] text-center text-xs text-muted">
          {phase === "lock"
            ? "When the outline locks on, VAULT asks for two moves in a random order, so a photo or a video cannot pass."
            : "Only numbers describing your face and its movement are sent to VAULT; the picture stays on this page."}
        </p>
      )}

      {phase === "failed" && (
        <div role="alert" className="w-full max-w-[440px] rounded-card border border-redline/60 bg-raised p-3 text-sm">
          <p className="font-semibold text-redline">Face check refused</p>
          <p className="mt-0.5 text-muted">{ui.reason}</p>
        </div>
      )}
      {phase === "passed" && ui.note && <div className="w-full max-w-[440px]">{ui.note}</div>}

      {ui.poor && (phase === "poor" || phase === "lock") && (
        <div className="phone-offer w-full max-w-[440px]">
          {poorCamera ? (
            poorCamera(ui.poor)
          ) : (
            <div role="alert" className="rounded-card border border-line-strong bg-raised p-4 text-sm">
              <p className="font-semibold">This camera isn&apos;t good enough for the face check</p>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {ui.poor.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {phase === "error" && (
        <p role="alert" className="max-w-[440px] text-sm text-redline">
          {ui.reason}
        </p>
      )}
      {phase !== "passed" && (
        <div className="flex gap-2">
          {phase === "failed" && !ui.final && (
            <Button variant="primary" onClick={() => retry.current()}>
              Try again
            </Button>
          )}
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

/** Readings wanted by the time `done` of `moves` moves are made: before the first, one between, the rest at the end. */
function wantFor(need: number, done: number, moves: number) {
  const first = need > 3 ? 2 : 1;
  return done >= moves ? need : Math.min(need, first + done);
}

function hintFor(r: FaceReading, problems: string[], passive: boolean, faces: number): string {
  if (faces > 1) return "Only one face in the picture, please";
  if (!r.face) return "Look at the camera";
  if (problems.length) return problems[0];
  if (r.size < MIN_SIZE) return "Come a little closer";
  if (r.real < LIVENESS.real) return "This looks like a photo or a screen";
  if (!passive) return "Blink and move your head a little";
  return "Hold still while the outline locks on";
}

/** Drawn when the server said yes. Not mirrored, so the tick reads the right way round. */
function Granted({ mode }: { mode: "enroll" | "verify" | "test" }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <span className="flex flex-col items-center gap-2">
        <svg viewBox="0 0 64 64" className="h-16 w-16" aria-hidden>
          <circle cx="32" cy="32" r="30" fill="rgb(0 0 0 / 0.55)" stroke="#00e676" strokeWidth="2" />
          <path className="scan-check" d="M19 33l9 9 17-19" fill="none" stroke="#00e676" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span role="status" className="rounded-full bg-black/70 px-3 py-1 text-[13px] font-medium" style={{ color: "#00e676" }}>
          {mode === "enroll" ? "Face check saved" : mode === "test" ? "Face test finished" : "Access granted"}
        </span>
      </span>
    </div>
  );
}

/** The red lock-down: a padlock shuts and the frame shakes once. The reason is spelt out below the picture. */
function LockDown({ reason }: { reason: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[rgb(80_0_0/0.35)]">
      <span className="flex flex-col items-center gap-2">
        <svg viewBox="0 0 64 64" className="face-lock h-16 w-16" aria-hidden>
          <circle cx="32" cy="32" r="30" fill="rgb(0 0 0 / 0.6)" stroke="#ff4d4d" strokeWidth="2" />
          <path className="face-lock-shackle" d="M24 29v-5a8 8 0 0 1 16 0v5" fill="none" stroke="#ff4d4d" strokeWidth="3.5" strokeLinecap="round" />
          <rect x="20" y="29" width="24" height="17" rx="3" fill="#ff4d4d" />
          <rect x="30.5" y="34" width="3" height="7" rx="1.5" fill="#000" />
        </svg>
        <span className="sr-only">{reason}</span>
        <span className="rounded-full bg-black/75 px-3 py-1 text-[13px] font-medium text-[#ff4d4d]">Locked</span>
      </span>
    </div>
  );
}

function CameraOff() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2 8V2h6M16 2h6v6M22 16v6h-6M8 22H2v-6" />
      <path d="M7 9.5h7.5v6H7zM14.5 11.5l3-1.8v5.6l-3-1.8M5 5l14 14" />
    </svg>
  );
}

function Score({ label, ok, value, fill }: { label: string; ok: boolean; value: string; fill: number }) {
  return (
    <div className={cx("meter-cell rounded-control border px-2 py-1.5", ok ? "border-green/50 text-green" : "border-line text-muted")}>
      <dt className="truncate">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
      <i aria-hidden style={{ width: `${Math.round(Math.max(0, Math.min(1, fill)) * 100)}%` }} />
    </div>
  );
}
