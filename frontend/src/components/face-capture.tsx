"use client";

import { useEffect, useRef, useState } from "react";
import { loadFace, read, type FaceReading, type FaceSamples } from "@/lib/face";
import { Loader } from "./loader";
import { Button, cx } from "./ui";

const NEED = { enroll: 5, verify: 2 } as const;
const LIVE_MIN = 0.5;
const REAL_MIN = 0.5;
const MIN_SIZE = 0.22; // the face must fill about a fifth of the picture width
const GAP_MS = 350; // readings spaced out, so a set-up captures a few slightly different angles

type Stage = "loading" | "camera" | "looking" | "done" | "error";

/**
 * F09.19: the real face check. Shows the camera with the face mesh Human actually found, and live scores. Collects
 * face fingerprints only when one face is close enough, live and real; the picture itself never leaves this page.
 */
export function FaceCapture({
  mode,
  onDone,
  onCancel,
}: {
  mode: "enroll" | "verify";
  onDone: (s: FaceSamples) => void | Promise<void>;
  onCancel: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<FaceReading | null>(null);
  const [count, setCount] = useState(0);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let frame = 0;
    const samples: number[][] = [];
    let bestLive = 0;
    let bestReal = 0;
    let last = 0;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This window cannot use a camera.");
        const human = await loadFace();
        if (stopped) return;
        setStage("camera");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 }, audio: false });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        setStage("looking");
        const tick = async () => {
          if (stopped || !video.current || !canvas.current) return;
          const v = video.current;
          const result = await human.detect(v);
          const r = read(result.face[0], v.videoWidth || 640);
          setReading(r);
          draw(canvas.current, v, r);
          bestLive = Math.max(bestLive, r.live);
          bestReal = Math.max(bestReal, r.real);
          const good = r.face && r.embedding && r.size >= MIN_SIZE && r.live >= LIVE_MIN && r.real >= REAL_MIN && result.face.length === 1;
          const t = performance.now();
          if (good && t - last > GAP_MS) {
            last = t;
            samples.push(r.embedding!);
            setCount(samples.length);
            if (samples.length >= NEED[mode]) {
              stopped = true;
              stream?.getTracks().forEach((track) => track.stop());
              setStage("done");
              await done.current({ samples, live: bestLive, real: bestReal });
              return;
            }
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch (e) {
        if (stopped) return;
        const name = e instanceof DOMException ? e.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera access was refused. Allow the camera for VAULT and try again."
            : name === "NotFoundError"
              ? "No camera was found on this computer."
              : e instanceof Error
                ? e.message
                : "The face check could not start.",
        );
        setStage("error");
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [mode]);

  const hint = !reading?.face
    ? "Look at the camera"
    : (reading.size ?? 0) < MIN_SIZE
      ? "Come a little closer"
      : reading.real < REAL_MIN
        ? "This looks like a photo or screen"
        : reading.live < LIVE_MIN
          ? "Blink and move your head a little"
          : mode === "enroll"
            ? "Hold still, then turn your head slightly"
            : "Hold still";

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative aspect-[4/3] w-full max-w-[420px] overflow-hidden rounded-card border border-line-strong bg-black">
        <video ref={video} playsInline muted className="absolute inset-0 h-full w-full -scale-x-100 object-cover opacity-0" />
        <canvas ref={canvas} className="absolute inset-0 h-full w-full -scale-x-100" aria-label="Camera with the face VAULT detected" />
        {stage !== "looking" && stage !== "done" && (
          <div className="absolute inset-0 grid place-items-center">
            {stage === "error" ? null : <Loader label={stage === "loading" ? "Loading the face models" : "Starting the camera"} />}
          </div>
        )}
      </div>

      {stage === "looking" && (
        <div className="w-full max-w-[420px] text-sm">
          <p className="mb-2 font-medium">{hint}</p>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <Score label="Face found" ok={!!reading?.face} value={reading?.face ? `${Math.round((reading.size ?? 0) * 100)}% wide` : "no"} />
            <Score label="Live person" ok={(reading?.live ?? 0) >= LIVE_MIN} value={(reading?.live ?? 0).toFixed(2)} />
            <Score label="Real, not a photo" ok={(reading?.real ?? 0) >= REAL_MIN} value={(reading?.real ?? 0).toFixed(2)} />
          </dl>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
            <div className="h-full bg-green transition-all" style={{ width: `${(count / NEED[mode]) * 100}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">
            Reading {count} of {NEED[mode]}. Only numbers describing your face are sent to VAULT; the picture stays here.
          </p>
        </div>
      )}
      {stage === "done" && <Loader label={mode === "enroll" ? "Saving your face unlock" : "Checking your face"} />}
      {error && (
        <p role="alert" className="text-sm text-redline">
          {error}
        </p>
      )}
      <Button variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function Score({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className={cx("rounded-control border px-2 py-1.5", ok ? "border-green/50 text-green" : "border-line text-muted")}>
      <dt>{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

/** The camera frame, with the box and mesh points Human found on this frame (nothing drawn that it did not find). */
function draw(c: HTMLCanvasElement, v: HTMLVideoElement, r: FaceReading) {
  const w = v.videoWidth || 640;
  const h = v.videoHeight || 480;
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(v, 0, 0, w, h);
  if (!r.face) return;
  const ok = r.live >= LIVE_MIN && r.real >= REAL_MIN && r.size >= MIN_SIZE;
  ctx.strokeStyle = ok ? "#00e676" : "#e6e6e6";
  ctx.fillStyle = ok ? "rgba(0,230,118,0.85)" : "rgba(230,230,230,0.7)";
  ctx.lineWidth = 2;
  const [x, y, bw, bh] = r.face.box;
  ctx.strokeRect(x, y, bw, bh);
  for (const [px, py] of r.face.mesh) ctx.fillRect(px - 0.8, py - 0.8, 1.6, 1.6);
}
