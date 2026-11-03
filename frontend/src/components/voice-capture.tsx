"use client";

import { useEffect, useRef, useState } from "react";
import { openMicrophone, type Microphone } from "@/lib/voice";
import { phraseProblems, type PhraseFeatures } from "@/lib/voice-features";
import { Loader } from "./loader";
import { Button, cx } from "./ui";

const NEED = { enroll: 3, verify: 1 } as const;
const MIN_RATE = 16000;
const MIN_SNR_DB = 12;
const SPEECH = 0.08; // level that counts as talking
const QUIET = 0.035;
const END_SILENCE_MS = 900;
const MAX_MS = 7000;
const BARS = 28;

type Stage = "opening" | "ready" | "listening" | "checking" | "done" | "accepted" | "error";

/**
 * F09.20: the spoken key phrase. A real microphone level meter, quality checks on every take, and three takes to set
 * up (one to sign in). Recording stops by itself after a pause. Only speech features leave this page.
 */
export function VoiceCapture({
  mode,
  onDone,
  onCancel,
}: {
  mode: "enroll" | "verify";
  /** Resolve `true` when the server accepted, to show the success moment. */
  onDone: (takes: PhraseFeatures[]) => void | boolean | Promise<void | boolean>;
  onCancel: () => void;
}) {
  const mic = useRef<Microphone | null>(null);
  const bars = useRef<HTMLDivElement>(null);
  const takes = useRef<PhraseFeatures[]>([]);
  const [stage, setStage] = useState<Stage>("opening");
  const [count, setCount] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  const [last, setLast] = useState<PhraseFeatures | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [micInfo, setMicInfo] = useState<Microphone["settings"] | null>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let frame = 0;
    let closed = false;
    openMicrophone().then(
      (m) => {
        if (closed) return m.close();
        mic.current = m;
        setMicInfo(m.settings);
        if ((m.settings.sampleRate ?? 0) < MIN_RATE) {
          setError(`This microphone records at ${m.settings.sampleRate} Hz; VAULT needs ${MIN_RATE.toLocaleString()} or more. Pick another microphone in Windows sound settings.`);
          setStage("error");
          return;
        }
        setStage("ready");
        const meter = () => {
          const level = m.level();
          const el = bars.current;
          if (el) {
            // Shift the bars left and add the live level on the right: a real scrolling meter, not a loop.
            const kids = el.children;
            for (let i = 0; i < kids.length - 1; i++) (kids[i] as HTMLElement).style.transform = (kids[i + 1] as HTMLElement).style.transform;
            (kids[kids.length - 1] as HTMLElement).style.transform = `scaleY(${Math.max(0.06, level)})`;
          }
          frame = requestAnimationFrame(meter);
        };
        frame = requestAnimationFrame(meter);
      },
      (e) => {
        if (closed) return;
        const name = e instanceof DOMException ? e.name : "";
        setError(
          name === "NotAllowedError"
            ? "Microphone access was refused. Allow the microphone for VAULT and try again."
            : name === "NotFoundError"
              ? "No microphone was found on this computer."
              : e instanceof Error
                ? e.message
                : "The microphone could not start.",
        );
        setStage("error");
      },
    );
    return () => {
      closed = true;
      cancelAnimationFrame(frame);
      mic.current?.close();
    };
  }, []);

  const listen = async () => {
    const m = mic.current;
    if (!m) return;
    setProblems([]);
    setStage("listening");
    const rec = m.record();
    const started = performance.now();
    let spoke = false;
    let quietSince = 0;
    await new Promise<void>((resolve) => {
      const watch = () => {
        const t = performance.now();
        const level = m.level();
        if (level > SPEECH) {
          spoke = true;
          quietSince = 0;
        } else if (spoke && level < QUIET) {
          quietSince ||= t;
        }
        if ((spoke && quietSince && t - quietSince > END_SILENCE_MS) || t - started > MAX_MS) return resolve();
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    });
    setStage("checking");
    try {
      const take = await rec.stop();
      setLast(take);
      const found = phraseProblems(take, MIN_SNR_DB);
      if (found.length) {
        setProblems(found);
        setStage("ready");
        return;
      }
      takes.current.push(take);
      setCount(takes.current.length);
      if (takes.current.length >= NEED[mode]) {
        setStage("done");
        mic.current?.close();
        if ((await done.current(takes.current)) === true) setStage("accepted");
        return;
      }
      setStage("ready");
    } catch (e) {
      setProblems([e instanceof Error ? e.message : "The recording failed."]);
      setStage("ready");
    }
  };

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="scan-stage relative w-full max-w-[440px] overflow-hidden rounded-card border border-line-strong p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between font-mono text-[11px] text-white/70">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", stage === "listening" ? "live-dot bg-green text-green" : "bg-white/30")} />
            {stage === "listening" ? "Recording" : "Microphone"}
          </span>
          <span>
            Take {Math.min(count + (stage === "listening" || stage === "checking" ? 1 : 0), NEED[mode])} of {NEED[mode]}
          </span>
        </div>
        {/* A level line through the middle, like the trace on a recorder. */}
        <div className="relative">
          <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
          <div ref={bars} className="relative flex h-20 items-center justify-between gap-[3px]" aria-hidden>
            {Array.from({ length: BARS }, (_, i) => (
              <div
                key={i}
                className={cx("h-full w-full origin-center rounded-full transition-colors", stage === "listening" ? "bg-green" : "bg-white/45")}
                style={{ transform: "scaleY(0.06)" }}
              />
            ))}
          </div>
          {stage === "accepted" && (
            <div className="absolute inset-0 grid place-items-center">
              <svg viewBox="0 0 64 64" className="h-14 w-14" aria-hidden>
                <circle cx="32" cy="32" r="30" fill="rgb(0 0 0 / 0.7)" stroke="var(--green)" strokeWidth="2" />
                <path className="scan-check" d="M19 33l9 9 17-19" fill="none" stroke="var(--green)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>
        <p className={cx("mt-3 text-center text-sm font-medium", stage === "accepted" ? "text-green" : "text-white")} aria-live="polite">
          {stage === "accepted"
            ? mode === "enroll"
              ? "Key phrase saved"
              : "Key phrase accepted"
            : stage === "opening"
            ? "Starting the microphone"
            : stage === "listening"
              ? "Listening. Say your phrase, then pause"
              : stage === "checking"
                ? "Checking the recording"
                : stage === "done"
                  ? mode === "enroll"
                    ? "Saving your key phrase"
                    : "Checking your key phrase"
                  : stage === "error"
                    ? "Microphone not available"
                    : mode === "enroll"
                      ? count === 0
                        ? "Press Speak and say your phrase"
                        : "Again, the same way"
                      : "Press Speak and say your key phrase"}
        </p>
      </div>

      {stage === "opening" && <Loader label="Starting the microphone" />}

      {micInfo && stage !== "error" && (
        <dl className="grid w-full max-w-[420px] grid-cols-3 gap-2 text-xs">
          <Check label="Microphone" ok value={micInfo.label.slice(0, 22)} />
          <Check label="Sample rate" ok={(micInfo.sampleRate ?? 0) >= MIN_RATE} value={`${((micInfo.sampleRate ?? 0) / 1000).toFixed(1)} kHz`} />
          <Check
            label="Above noise"
            ok={!!last && last.snrDb >= MIN_SNR_DB}
            value={last ? `${last.snrDb.toFixed(0)} dB` : "after a take"}
          />
        </dl>
      )}

      {mode === "enroll" && stage !== "error" && (
        <div className="flex gap-1.5" aria-label={`Take ${count} of ${NEED.enroll}`}>
          {Array.from({ length: NEED.enroll }, (_, i) => (
            // A take lights (and flashes once) only after it passed the quality checks.
            <span
              key={i === count - 1 ? `${i}-new` : i}
              className={cx(
                "h-1.5 w-12 rounded-full transition-colors duration-300",
                i < count || stage === "accepted" ? "bg-green" : "bg-line-strong",
                i === count - 1 && "take-new",
              )}
            />
          ))}
        </div>
      )}

      {problems.length > 0 && (
        <ul role="alert" className="w-full max-w-[420px] list-disc pl-5 text-sm text-amber">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="max-w-[420px] text-sm text-redline">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        {(stage === "ready" || stage === "listening" || stage === "checking") && (
          <Button variant="primary" busy={stage !== "ready"} onClick={listen}>
            <MicIcon />
            {stage === "ready" ? "Speak" : "Listening"}
          </Button>
        )}
        {stage !== "accepted" && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <p className="max-w-[420px] text-center text-xs text-muted">
        Only numbers describing how the phrase sounds are sent to VAULT. The recording stays on this page.
      </p>
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function Check({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className={cx("rounded-control border px-2 py-1.5", ok ? "border-green/50 text-green" : "border-line text-muted")}>
      <dt>{label}</dt>
      <dd className="truncate font-mono tabular-nums">{value}</dd>
    </div>
  );
}
