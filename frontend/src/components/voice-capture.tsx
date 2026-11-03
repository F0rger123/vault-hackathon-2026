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

type Stage = "opening" | "ready" | "listening" | "checking" | "done" | "error";

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
  onDone: (takes: PhraseFeatures[]) => void | Promise<void>;
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
        await done.current(takes.current);
        return;
      }
      setStage("ready");
    } catch (e) {
      setProblems([e instanceof Error ? e.message : "The recording failed."]);
      setStage("ready");
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-full max-w-[420px] rounded-card border border-line-strong bg-black p-4">
        <div ref={bars} className="flex h-20 items-center justify-between gap-[3px]" aria-hidden>
          {Array.from({ length: BARS }, (_, i) => (
            <div
              key={i}
              className={cx("h-full w-full origin-center rounded-full transition-colors", stage === "listening" ? "bg-green" : "bg-ink/50")}
              style={{ transform: "scaleY(0.06)" }}
            />
          ))}
        </div>
        <p className="mt-3 text-center text-sm font-medium text-white" aria-live="polite">
          {stage === "opening"
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
        <div className="flex gap-2" aria-label={`Take ${count} of ${NEED.enroll}`}>
          {Array.from({ length: NEED.enroll }, (_, i) => (
            <span key={i} className={cx("h-2 w-10 rounded-full transition-colors duration-300", i < count ? "bg-green" : "bg-raised")} />
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
            {stage === "ready" ? "Speak" : "Listening"}
          </Button>
        )}
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="max-w-[420px] text-center text-xs text-muted">
        Only numbers describing how the phrase sounds are sent to VAULT. The recording stays on this page.
      </p>
    </div>
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
