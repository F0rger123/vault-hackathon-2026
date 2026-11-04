"use client";

import { useState } from "react";
import { errorText, needsStep, post, type SignedIn, type SignInResult, type SignInStep, type StepNeeded } from "@/lib/api";
import { faceChallengeForStep, faceStep, type LiveAnswer } from "@/lib/face";
import { passkeysSupported, signInWithPasskey } from "@/lib/passkeys";
import { voiceStep } from "@/lib/voice";
import { playVaultDoor } from "@/lib/vault-door";
import { FaceCapture, type FaceOutcome } from "./face-capture";
import { Button, cx, inputClass } from "./ui";
import { VoiceCapture } from "./voice-capture";

export const STEP_NAMES: Record<SignInStep, string> = {
  password: "Password",
  passkey: "Passkey",
  face: "Face check",
  voice: "Key phrase",
};

const STEP_HINT: Record<SignInStep, string> = {
  password: "Type your password.",
  passkey: "Use this computer's Windows Hello, your security key or your phone.",
  face: "Look at the camera, then follow the two moves it asks for.",
  voice: "Say the key phrase you set up.",
};

/** The sign-in steps as a trail: done ones ticked, the current one lit, the rest waiting. Moves only on real answers. */
export function StepTrail({ steps, done, current }: { steps: SignInStep[]; done: SignInStep[]; current?: SignInStep }) {
  const progress = steps.length > 1 ? done.length / (steps.length - 1) : 1;
  return (
    <ol className="relative flex items-start justify-between" aria-label="Sign-in steps">
      <span className="absolute left-8 right-8 top-4 border-t border-dashed border-line-strong" aria-hidden />
      <span
        className="absolute left-8 top-4 h-0.5 -translate-y-px bg-green transition-[width] duration-500 ease-out"
        style={{ width: `calc((100% - 4rem) * ${Math.min(1, progress)})` }}
        aria-hidden
      />
      {steps.map((s) => {
        const isDone = done.includes(s);
        const isNow = s === current;
        return (
          <li key={s} className="relative z-10 flex w-16 flex-col items-center gap-1.5 text-center" aria-current={isNow ? "step" : undefined}>
            <span
              className={cx(
                "grid h-8 w-8 place-items-center rounded-[9px] border bg-panel transition-colors duration-300",
                isDone ? "border-green bg-green text-black" : isNow ? "border-green text-green ring-4 ring-green/15" : "border-line-strong text-muted",
              )}
            >
              {isDone ? <Tick /> : <StepIcon step={s} />}
            </span>
            <span className={cx("text-[11px] leading-tight", isNow ? "font-medium text-ink" : "text-muted")}>{STEP_NAMES[s]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 16 16" className="pop-in h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function StepIcon({ step, className = "h-4 w-4" }: { step: SignInStep; className?: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, className, "aria-hidden": true } as const;
  if (step === "password")
    return (
      <svg {...common}>
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    );
  if (step === "passkey")
    return (
      <svg {...common}>
        <circle cx="8" cy="12" r="4" />
        <path d="M12 12h9M18 12v3M21 12v2" />
      </svg>
    );
  if (step === "face")
    return (
      <svg {...common}>
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
        <path d="M9 10h.01M15 10h.01M9 15c1.6 1.3 4.4 1.3 6 0" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/**
 * F10.21: the camera failed its checks during a sign-in face step. The account's steps are set on the server
 * (backend/security/steps.py), and a face step cannot be swapped for another one mid-sign-in, so this only says
 * what to do; it never offers a way round the step.
 */
function FaceRequired({ problems, username }: { problems: string[]; username: string }) {
  return (
    <div role="alert" className="rounded-card border border-line-strong bg-raised p-4 text-sm">
      <p className="display text-[15px] leading-snug">Your camera isn&apos;t good enough for the face check</p>
      <ul className="mt-1.5 list-disc pl-4 text-xs text-muted">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="mt-3">
        {username}&apos;s account requires a face check, so VAULT can&apos;t skip it or accept another step instead. What
        you can do:
      </p>
      <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-muted">
        <li>Fix the light or lens, or use a better webcam, then press Cancel and sign in again.</li>
        <li>Ask an administrator to change your sign-in steps.</li>
        <li>
          Once you are in, add your phone as a passkey under Security, How you sign in, and swap Face check for Passkey.
          Your phone then does its own Face ID or fingerprint check.
        </li>
      </ul>
    </div>
  );
}

/**
 * F09.20: the rest of a sign-in after the first step was right. Shows every step this account chose and asks for the
 * next one. A session is stored only when the server issues one, after the last step.
 */
export function SignInSteps({
  start,
  onSignedIn,
  onCancel,
}: {
  start: StepNeeded;
  onSignedIn: (s: SignedIn) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(start);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [ended, setEnded] = useState(false);
  const all = [...step.done, ...step.remaining];

  // `hold` keeps the accepted face or key phrase on screen for a moment (its check mark) before moving on.
  const answer = async (fn: () => Promise<SignInResult>, hold = 0): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setPassword("");
      const apply = async () => {
        if (needsStep(r)) setStep(r);
        else await onSignedIn(r);
      };
      if (hold) window.setTimeout(() => void apply(), hold);
      else await apply();
      return true;
    } catch (e) {
      const text = e instanceof DOMException ? "The passkey was cancelled or not allowed on this device." : errorText(e);
      setError(text);
      if (/start again|took too long/.test(text)) setEnded(true);
      else setAttempt((n) => n + 1);
      return false;
    } finally {
      setBusy(false);
    }
  };

  // F09.22: the face step shows its own result (granted, or a red lock-down with the reason and a retry), so its errors
  // stay inside the camera view. A session after the face opens the vault door; another step follows with a tick.
  const answerFace = async (a: LiveAnswer): Promise<FaceOutcome> => {
    try {
      const r = await faceStep(step.handle, a);
      if (needsStep(r)) window.setTimeout(() => setStep(r), 900);
      else playVaultDoor(() => onSignedIn(r));
      return { ok: true };
    } catch (e) {
      const text = errorText(e);
      const final = /start again|took too long/.test(text);
      if (final) setEnded(true);
      return { ok: false, reason: text, final };
    }
  };
  const challenge = () => faceChallengeForStep(step.handle).catch((e) => Promise.reject(new Error(errorText(e))));

  return (
    <div className="flex flex-col gap-4">
      <StepTrail steps={all} done={step.done} current={ended ? undefined : step.step} />
      <div key={`${step.step}-${step.done.length}`} className="animate-rise">
        <h2 className="display flex items-center gap-2 text-lg">
          <StepIcon step={step.step} className="h-5 w-5 text-green" />
          {STEP_NAMES[step.step]}
          <span className="font-mono text-xs font-normal text-muted">
            step {step.done.length + 1} of {all.length}
          </span>
        </h2>
        <p className="mb-3 mt-1 text-sm text-muted">
          {step.username}&apos;s account asks for {all.length} steps. {STEP_HINT[step.step]}
        </p>
        {error && (
          <p className="mb-3 text-sm text-redline" role="alert">
            {error}
          </p>
        )}
        {ended && step.step !== "face" ? (
          <Button variant="primary" onClick={onCancel}>
            Start again
          </Button>
        ) : step.step === "face" ? (
          <>
            <FaceCapture
              key={attempt}
              mode="verify"
              challenge={challenge}
              onCancel={onCancel}
              onDone={answerFace}
              poorCamera={(problems) => <FaceRequired problems={problems} username={step.username} />}
            />
            {ended && (
              <Button variant="primary" onClick={onCancel}>
                Start again
              </Button>
            )}
          </>
        ) : step.step === "voice" ? (
          <VoiceCapture key={attempt} mode="verify" onCancel={onCancel} onDone={(t) => answer(() => voiceStep(step.handle, t[0]), 900)} />
        ) : step.step === "password" ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              answer(() => post<SignInResult>("/auth/password-step", { handle: step.handle, password }));
            }}
          >
            <label htmlFor="step-password" className="sr-only">
              Password
            </label>
            <input
              id="step-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" busy={busy} disabled={!password}>
                Continue
              </Button>
              <Button variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="primary"
              busy={busy}
              disabled={!passkeysSupported()}
              onClick={() => answer(() => signInWithPasskey(step.username, step.handle))}
            >
              {busy ? "Follow your device's prompt" : "Use my passkey"}
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
