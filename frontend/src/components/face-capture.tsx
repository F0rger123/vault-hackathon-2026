"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadFace, measureFace, qualityProblems, read, QUALITY, type CameraQuality, type FaceReading, type FaceSamples } from "@/lib/face";
import { Loader } from "./loader";
import { Button, cx } from "./ui";

const NEED = { enroll: 5, verify: 2 } as const;
const LIVE_MIN = 0.5;
const REAL_MIN = 0.5;
const MIN_SIZE = 0.22; // the face must fill about a fifth of the picture width
const GAP_MS = 350; // readings spaced out, so a set-up captures a few slightly different angles
const POOR_MS = 5000; // light or focus failing this long, with a face in view, means the camera is not good enough here

type Stage = "loading" | "camera" | "looking" | "done" | "accepted" | "poor" | "error";

/**
 * F09.19: the real face check. Shows the camera with the face mesh Human actually found, and live scores. Collects
 * face fingerprints only when one face is close enough, live and real, and (F09.20) only when the camera itself is good
 * enough: resolution, frame rate, light and focus are measured on the real frames. The picture never leaves this page.
 *
 * F10.21: the reticle follows the face box Human returned, one ring segment fills (with a flash) per accepted reading,
 * and a check draws only when `onDone` resolves `true`, meaning the server accepted. When the camera fails its checks,
 * `poorCamera` lets the page offer another way (a phone passkey on set-up; plain advice at sign-in).
 */
export function FaceCapture({
  mode,
  onDone,
  onCancel,
  poorCamera,
}: {
  mode: "enroll" | "verify";
  onDone: (s: FaceSamples) => void | boolean | Promise<void | boolean>;
  onCancel: () => void;
  poorCamera?: (problems: string[]) => ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<FaceReading | null>(null);
  const [count, setCount] = useState(0);
  const [quality, setQuality] = useState<CameraQuality | null>(null);
  const [poor, setPoor] = useState<string[] | null>(null);
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
    let ticks = 0;
    let poorStart = 0;
    let poorShown = false;
    let q: CameraQuality = { width: 0, height: 0, fps: 0, brightness: 0, sharpness: 0, face_px: 0 };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This window cannot use a camera.");
        const human = await loadFace();
        if (stopped) return;
        setStage("camera");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          audio: false,
        });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const settings = stream.getVideoTracks()[0]?.getSettings() ?? {};
        q = { ...q, width: video.current.videoWidth, height: video.current.videoHeight, fps: settings.frameRate ?? 0 };
        setQuality(q);
        const camera = qualityProblems({ ...q, face_px: 0 });
        if (camera.length) {
          // The camera itself is below the minimum: no reading can pass, so stop here and say what to do instead.
          stopped = true;
          stream.getTracks().forEach((track) => track.stop());
          setPoor(camera);
          setStage("poor");
          return;
        }
        setStage("looking");
        const tick = async () => {
          if (stopped || !video.current || !canvas.current) return;
          const v = video.current;
          const result = await human.detect(v);
          const r = read(result.face[0], v.videoWidth || 640);
          setReading(r);
          const measured = draw(canvas.current, v, r, ticks++ % 4 === 0);
          if (measured && r.face) {
            q = { ...q, ...measured, face_px: r.face.box[2] };
            setQuality(q);
          }
          const t = performance.now();
          // Light or focus failing for several seconds with a face in view: offer another way, keep the camera on.
          const problems = r.face && q.face_px ? qualityProblems(q) : [];
          if (problems.length) {
            poorStart ||= t;
            if (!poorShown && t - poorStart > POOR_MS) {
              poorShown = true;
              setPoor(problems);
            }
          } else poorStart = 0;
          bestLive = Math.max(bestLive, r.live);
          bestReal = Math.max(bestReal, r.real);
          const good =
            r.face && r.embedding && r.size >= MIN_SIZE && r.live >= LIVE_MIN && r.real >= REAL_MIN && result.face.length === 1 && q.face_px > 0 && qualityProblems(q).length === 0;
          if (good && t - last > GAP_MS) {
            last = t;
            samples.push(r.embedding!);
            setCount(samples.length);
            if (samples.length >= NEED[mode]) {
              stopped = true;
              stream?.getTracks().forEach((track) => track.stop());
              setStage("done");
              const accepted = await done.current({ samples, live: bestLive, real: bestReal, quality: q });
              if (accepted === true) setStage("accepted");
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

  const need = NEED[mode];
  const issues = quality ? qualityProblems(quality) : [];
  const hint =
    stage === "accepted"
      ? mode === "enroll"
        ? "Face check saved"
        : "Face accepted"
      : stage === "done"
        ? mode === "enroll"
          ? "Saving your face check"
          : "Checking your face"
        : !reading?.face
          ? "Look at the camera"
          : issues.length
            ? issues[0]
            : (reading.size ?? 0) < MIN_SIZE
              ? "Come a little closer"
              : reading.real < REAL_MIN
                ? "This looks like a photo or screen"
                : reading.live < LIVE_MIN
                  ? "Blink and move your head a little"
                  : mode === "enroll"
                    ? "Hold still, then turn your head slightly"
                    : "Hold still";
  const ok = !!reading?.face && reading.live >= LIVE_MIN && reading.real >= REAL_MIN && reading.size >= MIN_SIZE && !issues.length;
  const showStage = stage === "looking" || stage === "done" || stage === "accepted";

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div
        className={cx(
          "scan-stage relative w-full max-w-[440px] overflow-hidden rounded-card border border-line-strong",
          stage === "poor" ? "aspect-[2/1]" : "aspect-[4/5] sm:aspect-[4/3]",
        )}
      >
        <video ref={video} playsInline muted className="absolute inset-0 h-full w-full -scale-x-100 object-cover opacity-0" />
        <canvas ref={canvas} className="absolute inset-0 h-full w-full -scale-x-100 object-cover" aria-label="Camera with the face VAULT detected" />
        {showStage && quality && (
          <Reticle w={quality.width} h={quality.height} reading={reading} count={count} need={need} ok={ok} accepted={stage === "accepted"} />
        )}
        {showStage && (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-2.5 pt-2.5 font-mono text-[11px] text-white/85">
              <span className="rounded-full bg-black/60 px-2 py-0.5">
                Reading {count} of {need}
              </span>
              {quality && (
                <span className="rounded-full bg-black/60 px-2 py-0.5">
                  {quality.width}×{quality.height}
                  {quality.fps ? `, ${quality.fps.toFixed(0)} fps` : ""}
                </span>
              )}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-3 pb-3">
              <p
                aria-live="polite"
                className={cx(
                  "rounded-full border px-3 py-1 text-[13px] font-medium backdrop-blur-sm",
                  stage === "accepted" ? "border-green/60 bg-black/70 text-green" : "border-white/15 bg-black/60 text-white",
                )}
              >
                {stage === "done" ? <Loader className="text-[13px] text-white" size={13} label={hint} /> : hint}
              </p>
            </div>
          </>
        )}
        {stage === "accepted" && <AcceptedCheck />}
        {(stage === "loading" || stage === "camera") && (
          <div className="absolute inset-0 grid place-items-center text-white">
            <Loader className="text-white/80" label={stage === "loading" ? "Loading the face models" : "Starting the camera"} />
          </div>
        )}
        {stage === "poor" && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">
            <span className="flex flex-col items-center gap-3">
              <CameraOff />
              This camera is below VAULT&apos;s minimum for a face check.
            </span>
          </div>
        )}
      </div>

      {stage === "looking" && quality && (
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
          <Score label="Face found" ok={!!reading?.face} value={reading?.face ? `${Math.round((reading.size ?? 0) * 100)}% wide` : "no"} fill={Math.min(1, (reading?.size ?? 0) / 0.5)} />
          <Score label="Live person" ok={(reading?.live ?? 0) >= LIVE_MIN} value={(reading?.live ?? 0).toFixed(2)} fill={reading?.live ?? 0} />
          <Score label="Real, not a photo" ok={(reading?.real ?? 0) >= REAL_MIN} value={(reading?.real ?? 0).toFixed(2)} fill={reading?.real ?? 0} />
        </dl>
      )}
      {(stage === "looking" || stage === "done") && (
        <p className="max-w-[440px] text-center text-xs text-muted">
          Only numbers describing your face are sent to VAULT; the picture stays on this page.
        </p>
      )}

      {poor && (stage === "poor" || stage === "looking") && (
        <div className="phone-offer w-full max-w-[440px]">
          {poorCamera ? (
            poorCamera(poor)
          ) : (
            <div role="alert" className="rounded-card border border-line-strong bg-raised p-4 text-sm">
              <p className="font-semibold">This camera isn&apos;t good enough for the face check</p>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {poor.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="max-w-[440px] text-sm text-redline">
          {error}
        </p>
      )}
      {stage !== "accepted" && (
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}

/**
 * The scanning reticle, in the camera's own pixel space and mirrored like the picture, so it sits on the face Human
 * found. Corner marks hug the face box; the ring round it has one segment per reading needed, filled as each is taken.
 */
function Reticle({
  w,
  h,
  reading,
  count,
  need,
  ok,
  accepted,
}: {
  w: number;
  h: number;
  reading: FaceReading | null;
  count: number;
  need: number;
  ok: boolean;
  accepted: boolean;
}) {
  const box = reading?.face?.box;
  const seg = 100 / need;
  const gap = need > 1 ? 2.2 : 0;
  return (
    <svg aria-hidden viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100">
      {count > 0 && <rect key={count} className="scan-flash" width={w} height={h} fill="#ffffff" />}
      {box ? (
        (() => {
          const [x, y, bw, bh] = box;
          const r = Math.max(bw, bh) * 0.66;
          const hw = bw / 2;
          const hh = bh / 2;
          const l = Math.min(bw, bh) * 0.16;
          const edge = ok || accepted ? "var(--green)" : "#ffffff";
          return (
            <g className="scan-track" style={{ transform: `translate(${x + hw}px, ${y + hh}px)` }}>
              <g className={accepted ? "scan-accepted-ring" : undefined}>
                {Array.from({ length: 36 }, (_, i) => (
                  <line
                    key={i}
                    x1={0}
                    y1={-r * 1.07}
                    x2={0}
                    y2={-r * (i % 3 === 0 ? 1.13 : 1.1)}
                    stroke="#ffffff"
                    strokeOpacity={0.35}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                    transform={`rotate(${i * 10})`}
                  />
                ))}
                {Array.from({ length: need }, (_, i) => {
                  const filled = accepted || i < count;
                  const fresh = !accepted && i === count - 1;
                  return (
                    <circle
                      key={fresh ? `${i}-new-${count}` : i}
                      r={r}
                      fill="none"
                      pathLength={100}
                      transform="rotate(-90)"
                      strokeDasharray={`${seg - gap} ${100 - seg + gap}`}
                      strokeDashoffset={-(i * seg) - gap / 2}
                      stroke={filled ? "var(--green)" : "#ffffff"}
                      strokeOpacity={filled ? 1 : 0.3}
                      strokeWidth={5}
                      strokeLinecap="butt"
                      vectorEffect="non-scaling-stroke"
                      className={cx("scan-seg", fresh && "scan-seg-new")}
                    />
                  );
                })}
              </g>
              <path
                d={`M${-hw} ${-hh + l}V${-hh}H${-hw + l}M${hw - l} ${-hh}H${hw}V${-hh + l}M${hw} ${hh - l}V${hh}H${hw - l}M${-hw + l} ${hh}H${-hw}V${hh - l}`}
                fill="none"
                stroke={edge}
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })()
      ) : (
        <ellipse cx={w / 2} cy={h / 2} rx={Math.min(w, h) * 0.22} ry={Math.min(w, h) * 0.29} fill="none" stroke="#ffffff" strokeOpacity={0.45} strokeWidth={2} strokeDasharray="6 8" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

/** Drawn once, when the server said yes. Not mirrored, so the tick reads the right way round. */
function AcceptedCheck() {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <svg viewBox="0 0 64 64" className="h-16 w-16" aria-hidden>
        <circle cx="32" cy="32" r="30" fill="rgb(0 0 0 / 0.55)" stroke="var(--green)" strokeWidth="2" />
        <path className="scan-check" d="M19 33l9 9 17-19" fill="none" stroke="var(--green)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
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

/** The camera frame with the mesh points Human found on this frame (nothing drawn that it did not find). */
/** Also measures light and focus on the clean frame, before anything is drawn over it, when `measure` is set. */
function draw(c: HTMLCanvasElement, v: HTMLVideoElement, r: FaceReading, measure: boolean) {
  const w = v.videoWidth || 640;
  const h = v.videoHeight || 480;
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(v, 0, 0, w, h);
  if (!r.face) return null;
  const measured = measure ? measureFace(ctx, r.face.box) : null;
  const ok = r.live >= LIVE_MIN && r.real >= REAL_MIN && r.size >= MIN_SIZE;
  ctx.fillStyle = ok ? "rgba(0,230,118,0.8)" : "rgba(255,255,255,0.6)";
  for (const [px, py] of r.face.mesh) ctx.fillRect(px - 0.8, py - 0.8, 1.6, 1.6);
  return measured;
}
