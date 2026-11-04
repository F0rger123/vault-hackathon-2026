"use client";

import { useState } from "react";
import { ApiError, del, errorText, needsStep, put, api, setToken, vault, type SignedIn, type SignInResult, type SignInStep, type StepNeeded } from "@/lib/api";
import { enrollFace, faceChallengeForMe, testFace, type FaceTest } from "@/lib/face";
import { dateTime } from "@/lib/format";
import { addPasskey, passkeysSupported, signInWithPasskey, type PasskeyKind } from "@/lib/passkeys";
import { useLoad } from "@/lib/use-load";
import { enrollVoice, voiceStatus } from "@/lib/voice";
import { FaceCapture } from "./face-capture";
import { useMaybeSession } from "./session";
import { SignInSteps, STEP_NAMES, StepIcon, StepTrail } from "./sign-in-steps";
import { Button, cx, Field, inputClass, Notice, Panel } from "./ui";
import { VoiceCapture } from "./voice-capture";

interface Mine {
  passkeys: { id: number; name: string; created_at: number; last_used_at: number | null }[];
  required: boolean;
}
interface FaceStatus {
  enrolled: boolean;
  samples: number;
  set_up_at: number | null;
}
interface StepsStatus {
  required: SignInStep[];
  set_up: Record<SignInStep, boolean>;
}

const ORDER: SignInStep[] = ["password", "passkey", "face", "voice"];

const ABOUT: Record<SignInStep, { what: string; kind: string }> = {
  password: { what: "Something you know. Typed at sign-in.", kind: "know" },
  passkey: { what: "Something you have: this computer, a security key or your phone.", kind: "have" },
  face: { what: "Something you are: your face on the webcam, checked live.", kind: "are" },
  voice: { what: "A phrase only you know, spoken in your voice.", kind: "know+are" },
};

const KINDS: { kind: PasskeyKind; label: string; name: string; hint: string }[] = [
  { kind: "device", label: "This computer", name: "This computer", hint: "Windows Hello face, fingerprint or PIN; Touch ID on a Mac" },
  { kind: "key", label: "Security key", name: "Security key", hint: "A FIDO2 USB or NFC key such as a YubiKey" },
  { kind: "phone", label: "Phone", name: "Phone", hint: "Scan a QR code with your phone and confirm there" },
];

const KEY_STEPS = [
  "Plug the key into a USB port (or hold an NFC key to the reader).",
  "Press Add a passkey below.",
  "If the browser asks where to save it, choose Security key.",
  "Set a PIN for the key if it has none yet, or type its PIN.",
  "Touch the key when it blinks. VAULT shows it in the list when it is saved.",
];

/** Stale-session answers from the server: changing how you sign in needs a sign-in in the last 15 minutes. */
function needsConfirm(e: unknown) {
  return e instanceof ApiError && e.status === 403 && /sign in again/.test(e.message);
}

/** The order the server asks for steps in (backend/security/steps.py), for the preview. */
function chain(chosen: SignInStep[]): SignInStep[] {
  return ORDER.filter((s) => chosen.includes(s));
}

/** Kinds of proof, not just a count: two things you know are weaker than one you know plus one you have. */
function strength(chosen: SignInStep[]): { score: number; label: string } {
  const kinds = new Set<string>();
  for (const s of chosen) for (const k of ABOUT[s].kind.split("+")) kinds.add(k);
  if (!chosen.some((s) => s === "password" || s === "passkey")) kinds.add("know"); // a password or passkey still starts it
  const score = Math.min(4, kinds.size + (chosen.length >= 3 ? 1 : 0));
  return { score, label: ["", "Basic", "Good", "Strong", "Very strong"][score] };
}

/**
 * F09.14, F09.19 and F09.20: how this account signs in. Pick any mix of password, passkey, face check and spoken key
 * phrase; the server asks for every one of them, in order, before it gives a session.
 */
export function PasskeysPanel() {
  const mine = useLoad("passkeys", () => api<Mine>("/auth/passkeys"));
  const face = useLoad("face", () => api<FaceStatus>("/auth/face"));
  const voice = useLoad("voice", voiceStatus);
  const steps = useLoad("steps", () => api<StepsStatus>("/auth/steps"));
  const [chosen, setChosen] = useState<SignInStep[] | null>(null);
  const [kind, setKind] = useState<PasskeyKind>("device");
  const [name, setName] = useState("This computer");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<"face" | "face-test" | "voice" | null>(null);
  const [open, setOpen] = useState<SignInStep | null>(null);
  const [confirm, setConfirm] = useState<(() => Promise<void>) | null>(null);
  const supported = passkeysSupported();

  const saved = steps.data?.required ?? [];
  const picked = chosen ?? saved;
  const ready = steps.data?.set_up;
  const changed = chosen !== null && chain(chosen).join() !== chain(saved).join();
  const s = strength(picked);
  const preview = chain(picked);
  const starts = preview.filter((x) => x === "password" || x === "passkey");
  const trail: SignInStep[] = starts.length ? preview : ["password", ...preview];

  const reload = () => {
    mine.reload();
    face.reload();
    voice.reload();
    steps.reload();
  };

  // Runs a change; if the server says "sign in again", asks the person to confirm and then retries it.
  const act = async (label: string, fn: () => Promise<unknown>, done?: string): Promise<boolean> => {
    setBusy(label);
    setError(null);
    setOk(null);
    try {
      await fn();
      reload();
      if (done) setOk(done);
      return true;
    } catch (e) {
      if (needsConfirm(e)) setConfirm(() => async () => void (await act(label, fn, done)));
      else setError(e instanceof DOMException ? "The passkey was cancelled or not allowed on this device." : errorText(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const toggle = (step: SignInStep) => {
    if (!ready?.[step]) {
      setOpen(step);
      return;
    }
    setChosen(picked.includes(step) ? picked.filter((x) => x !== step) : [...picked, step]);
  };

  const presets: { label: string; steps: SignInStep[] }[] = [
    { label: "One step", steps: [] },
    { label: "Two steps", steps: ready?.passkey ? ["password", "passkey"] : ready?.face ? ["face"] : ["voice"] },
    { label: "Three steps", steps: ["password", ready?.passkey ? "passkey" : "face", ready?.passkey ? "face" : "voice"] },
    { label: "Every step", steps: [...ORDER] },
  ];

  return (
    <Panel title="How you sign in" aside={steps.data ? `${trail.length} step${trail.length === 1 ? "" : "s"} now` : undefined}>
      {confirm && (
        <ConfirmIdentity
          onCancel={() => setConfirm(null)}
          onConfirmed={async () => {
            const retry = confirm;
            setConfirm(null);
            await retry();
          }}
        />
      )}

      <section aria-labelledby="steps-h" className="flex flex-col gap-4">
        <div>
          <h3 id="steps-h" className="font-semibold">
            Pick your sign-in steps
          </h3>
          <p className="text-sm text-muted">
            Tick as many as you like. VAULT asks for each one, in this order, and gives no session until the last is
            right. A step needs setting up first; press it to see how.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="Sign-in steps">
          {ORDER.map((step) => {
            const on = picked.includes(step);
            const isReady = !!ready?.[step];
            return (
              <button
                key={step}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(step)}
                className={cx(
                  "press group relative flex flex-col gap-2 rounded-card border p-3 text-left transition-colors duration-200",
                  on ? "border-green/70 bg-green/5" : "border-line hover:border-line-strong",
                )}
              >
                <span className="flex items-center justify-between">
                  <span className={cx("grid h-9 w-9 place-items-center rounded-full border transition-colors", on ? "border-green text-green" : "border-line text-muted")}>
                    <StepIcon step={step} className="h-5 w-5" />
                  </span>
                  <span
                    className={cx(
                      "grid h-5 w-5 place-items-center rounded-[5px] border text-[11px] transition-colors",
                      on ? "border-green bg-green text-black" : "border-line-strong",
                    )}
                    aria-hidden
                  >
                    {on ? "✓" : ""}
                  </span>
                </span>
                <span className="font-medium">{STEP_NAMES[step]}</span>
                <span className="text-xs text-muted">{ABOUT[step].what}</span>
                <span className={cx("mt-auto text-xs", isReady ? "text-green" : "text-amber")}>{isReady ? "Set up" : "Not set up: press to start"}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2" aria-label="Quick picks">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={!ready || p.steps.some((x) => !ready[x])}
              onClick={() => setChosen(p.steps)}
              className="press rounded-full border border-line px-3 py-1 text-xs hover:border-line-strong disabled:opacity-40"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="rounded-card border border-line bg-raised/40 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">Signing in will ask for</span>
            <span className="flex items-center gap-2" aria-label={`Strength: ${s.label}`}>
              <span className="flex gap-1" aria-hidden>
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className={cx("h-1.5 w-6 rounded-full transition-colors duration-300", i <= s.score ? "bg-green" : "bg-line")} />
                ))}
              </span>
              <span className="text-xs text-muted">{s.label}</span>
            </span>
          </div>
          <StepTrail steps={trail} done={[]} />
          <p className="mt-3 text-xs text-muted">
            {!starts.length
              ? "Your password or a passkey starts it, whichever you use."
              : starts.length === 1 && starts[0] === "passkey"
                ? "A password alone will not get in: only a passkey starts sign-in."
                : starts.length === 2
                  ? "Your password and a passkey, either one first."
                  : "Your password starts it."}{" "}
            Face and key phrase are checked on this computer&apos;s camera and microphone, so they add to a password or
            passkey and never replace one.
          </p>
          {picked.includes("passkey") && (mine.data?.passkeys.length ?? 0) < 2 && (
            <p className="mt-2 text-xs text-amber">Add a second passkey (for example a spare security key) so losing one cannot lock you out.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!changed || busy !== null}
              busy={busy === "steps"}
              onClick={() =>
                act("steps", () => put("/auth/steps", { steps: chain(picked) }), "Saved. The next sign-in asks for these steps.").then((saved) => saved && setChosen(null))
              }
            >
              Save sign-in steps
            </Button>
            {changed && (
              <Button variant="secondary" onClick={() => setChosen(null)}>
                Undo
              </Button>
            )}
          </div>
        </div>
      </section>

      {ok && (
        <Notice tone="info" className="mt-4">
          {ok}
        </Notice>
      )}
      {error && <Notice className="mt-4">{error}</Notice>}

      <h3 className="mt-6 font-semibold">Set up each step</h3>
      <div className="mt-2 flex flex-col divide-y divide-line rounded-card border border-line">
        <Setup
          step="password"
          open={open === "password"}
          onToggle={() => setOpen(open === "password" ? null : "password")}
          status={ready?.password ? "Set" : "No password"}
        >
          <p className="text-sm text-muted">Change your password under Security &gt; Your password. An admin can reset it under People.</p>
        </Setup>

        <Setup
          step="passkey"
          open={open === "passkey"}
          onToggle={() => setOpen(open === "passkey" ? null : "passkey")}
          status={mine.data ? `${mine.data.passkeys.length} added` : ""}
        >
          <p className="text-sm text-muted">
            A passkey proves you have a device. Your face, fingerprint or PIN is checked by the device itself and never leaves
            it; VAULT keeps only a public key.
          </p>
          {!supported && <Notice tone="warning">This browser or window cannot use passkeys.</Notice>}
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Where the passkey lives">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                role="radio"
                aria-checked={kind === k.kind}
                onClick={() => {
                  setKind(k.kind);
                  setName(k.name);
                }}
                className={cx("press rounded-control border px-3 py-2 text-left text-sm", kind === k.kind ? "border-ink bg-raised" : "border-line hover:border-line-strong")}
              >
                <span className="block font-medium">{k.label}</span>
                <span className="block text-xs text-muted">{k.hint}</span>
              </button>
            ))}
          </div>
          {kind === "key" && (
            <ol className="list-decimal rounded-control border border-line px-8 py-3 text-sm" aria-label="Adding a security key">
              {KEY_STEPS.map((t) => (
                <li key={t} className="py-0.5">
                  {t}
                </li>
              ))}
              <li className="py-0.5 text-muted">Needs a FIDO2 key. Very old U2F-only keys cannot check a PIN, so VAULT refuses them.</li>
            </ol>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <Field label="Name for this passkey" htmlFor="passkey-name">
                <input id="passkey-name" className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              </Field>
            </div>
            <Button
              variant="primary"
              disabled={!supported || !name.trim()}
              busy={busy === "add"}
              onClick={() => act("add", () => addPasskey(name.trim(), kind), `${name.trim()} added. Tick Passkey above to require it.`)}
            >
              {busy === "add" ? (kind === "key" ? "Touch your key" : "Follow your device's prompt") : "Add a passkey"}
            </Button>
          </div>
          {mine.data && mine.data.passkeys.length > 0 && (
            <ul className="flex flex-col divide-y divide-line rounded-control border border-line text-sm" aria-label="Your passkeys">
              {mine.data.passkeys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    <span className="font-medium">{k.name}</span>
                    <span className="block text-xs text-muted">
                      Added {dateTime(k.created_at)}
                      {k.last_used_at ? `, last used ${dateTime(k.last_used_at)}` : ", not used yet"}
                    </span>
                  </span>
                  <Button variant="danger" busy={busy === `rm${k.id}`} onClick={() => act(`rm${k.id}`, () => del(`/auth/passkeys/${k.id}`))}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Setup>

        <Setup
          step="face"
          open={open === "face"}
          onToggle={() => setOpen(open === "face" ? null : "face")}
          status={face.data?.enrolled ? `Set up ${dateTime(face.data.set_up_at ?? 0)}` : "Not set up"}
        >
          <p className="text-sm text-muted">
            VAULT checks the camera first (at least 640×360, enough light, in focus), then that you are a live person and
            not a photo, then compares your face with the one you set up. It runs on this computer with the open-source
            Human library; only numbers describing your face are stored, never a picture.
          </p>
          {capturing === "face-test" ? (
            <FaceCapture
              mode="test"
              challenge={() => faceChallengeForMe("test").catch((e) => Promise.reject(new Error(errorText(e))))}
              onCancel={() => setCapturing(null)}
              onDone={async (a) => {
                try {
                  const r = await testFace(a);
                  if (!r.match) return { ok: false, reason: faceTestText(r) };
                  window.setTimeout(() => setCapturing(null), 1800);
                  return { ok: true, note: <FaceTestResult r={r} /> };
                } catch (e) {
                  return { ok: false, reason: errorText(e) };
                }
              }}
            />
          ) : capturing === "face" ? (
            <FaceCapture
              mode="enroll"
              challenge={() => faceChallengeForMe("enroll").catch((e) => Promise.reject(new Error(errorText(e))))}
              onCancel={() => setCapturing(null)}
              onDone={async (f) => {
                // F09.22: a refusal (the reason from the server) stays in the camera view with a retry, and the
                // "confirm it's you" box still shows above when the session is too old to change face unlock.
                try {
                  await enrollFace(f);
                } catch (e) {
                  if (needsConfirm(e)) {
                    setCapturing(null);
                    setConfirm(() => async () => void setCapturing("face"));
                    return { ok: false, reason: "Confirm it's you first, then set up the face check again.", final: true };
                  }
                  return { ok: false, reason: errorText(e) };
                }
                reload();
                setOk("Face check set up. Test it now, then tick Face check above to require it.");
                window.setTimeout(() => setCapturing(null), 1600);
                return { ok: true };
              }}
              poorCamera={(problems) => (
                <PhoneInstead
                  problems={problems}
                  supported={supported}
                  busy={busy === "phone"}
                  onAdd={() =>
                    act("phone", () => addPasskey("Phone", "phone"), "Phone added as a passkey. Tick Passkey above to sign in with it.").then((added) => {
                      if (added) setCapturing(null);
                    })
                  }
                />
              )}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant={face.data?.enrolled ? "secondary" : "primary"} busy={busy === "face"} onClick={() => setCapturing("face")}>
                {face.data?.enrolled ? "Set it up again" : "Set up face check"}
              </Button>
              {face.data?.enrolled && (
                <Button variant="primary" onClick={() => setCapturing("face-test")}>
                  Test my face now
                </Button>
              )}
              {face.data?.enrolled && (
                <Button variant="danger" busy={busy === "face-rm"} onClick={() => act("face-rm", () => del("/auth/face"), "Face data deleted.")}>
                  Delete my face data
                </Button>
              )}
            </div>
          )}
        </Setup>

        <Setup
          step="voice"
          open={open === "voice"}
          onToggle={() => setOpen(open === "voice" ? null : "voice")}
          status={voice.data?.enrolled ? `Set up ${dateTime(voice.data.set_up_at ?? 0)}` : "Not set up"}
        >
          <p className="text-sm text-muted">
            Pick a phrase only you know, three to six words, not your password. Say it three times the same way. At sign-in
            you say it once; VAULT checks it is the same phrase in a voice like yours. Nobody types it, so it is never stored
            as text, and only numbers describing the sound are kept.
          </p>
          <p className="text-xs text-muted">
            Honest limit: a recording of you saying the phrase would pass, which is why it is an extra step and never the
            only one.
          </p>
          {capturing === "voice" ? (
            <VoiceCapture
              mode="enroll"
              onCancel={() => setCapturing(null)}
              onDone={async (takes) => {
                const saved = await act("voice", () => enrollVoice(takes), "Key phrase set up. Tick Key phrase above to require it.");
                if (saved) window.setTimeout(() => setCapturing(null), 1600);
                else setCapturing(null);
                return saved;
              }}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant={voice.data?.enrolled ? "secondary" : "primary"} busy={busy === "voice"} onClick={() => setCapturing("voice")}>
                {voice.data?.enrolled ? "Record it again" : "Set up key phrase"}
              </Button>
              {voice.data?.enrolled && (
                <Button variant="danger" busy={busy === "voice-rm"} onClick={() => act("voice-rm", () => del("/auth/voice"), "Key phrase deleted.")}>
                  Delete my key phrase
                </Button>
              )}
            </div>
          )}
        </Setup>
      </div>
    </Panel>
  );
}

/**
 * F10.21: shown when the webcam fails the face check's quality checks. Adds the phone as a passkey instead: the browser
 * shows a QR code, the phone scans it and unlocks with its own Face ID or fingerprint. That check happens on the phone;
 * VAULT's webcam face check is not involved, and VAULT keeps only the passkey's public key.
 */
function PhoneInstead({ problems, supported, busy, onAdd }: { problems: string[]; supported: boolean; busy: boolean; onAdd: () => void }) {
  return (
    <section aria-labelledby="phone-instead-h" className="trim rounded-card border border-line-strong bg-raised p-4">
      <div className="flex gap-4">
        <PhoneQr />
        <div className="min-w-0 flex-1">
          <h4 id="phone-instead-h" className="display text-[15px] leading-snug">
            Your camera isn&apos;t good enough. Use your phone instead
          </h4>
          <ul className="mt-1.5 list-disc pl-4 text-xs text-muted">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      </div>
      <ol className="mt-3 flex list-decimal flex-col gap-1 pl-5 text-sm">
        <li>Press the button. Your browser shows a QR code.</li>
        <li>Scan it with your phone&apos;s camera and confirm with Face ID or your fingerprint.</li>
        <li>Tick Passkey above and save. Untick Face check if you had it ticked.</li>
      </ol>
      <p className="mt-2 text-xs text-muted">
        Honest note: your phone does that face or fingerprint check itself. It replaces VAULT&apos;s webcam face check; it
        does not improve it. VAULT stores only the passkey&apos;s public key.
      </p>
      <Button variant="primary" className="mt-3" disabled={!supported} busy={busy} onClick={onAdd}>
        {busy ? "Scan the QR code with your phone" : "Add my phone as a passkey"}
      </Button>
      {!supported && <p className="mt-2 text-xs text-amber">This browser or window cannot use passkeys.</p>}
    </section>
  );
}

/** A phone with a QR code on its screen: a drawing of what the browser is about to show, not a real code. */
function PhoneQr() {
  const cells = [0, 1, 2, 4, 6, 8, 9, 12, 13, 14, 15, 17, 19, 21, 22, 24];
  return (
    <svg viewBox="0 0 40 64" className="h-16 w-10 shrink-0 text-ink" aria-hidden>
      <rect x="1" y="1" width="38" height="62" rx="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <g fill="currentColor">
        {cells.map((c) => (
          <rect key={c} x={8 + (c % 5) * 5} y={20 + Math.floor(c / 5) * 5} width="4" height="4" />
        ))}
      </g>
      <path d="M6 18v-3h3M31 15h3v3M34 44v3h-3M9 47H6v-3" fill="none" stroke="var(--green)" strokeWidth="1.6" />
    </svg>
  );
}

function Setup({
  step,
  open,
  onToggle,
  status,
  children,
}: {
  step: SignInStep;
  open: boolean;
  onToggle: () => void;
  status: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`setup-${step}`}>
      <h4 id={`setup-${step}`}>
        <button type="button" aria-expanded={open} onClick={onToggle} className="press flex w-full items-center gap-3 px-3 py-3 text-left">
          <StepIcon step={step} className="h-5 w-5 text-muted" />
          <span className="flex-1 font-medium">{STEP_NAMES[step]}</span>
          <span className="text-xs text-muted">{status}</span>
          <svg viewBox="0 0 16 16" className={cx("h-4 w-4 text-muted transition-transform duration-200", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      </h4>
      {open && <div className="animate-rise flex flex-col gap-3 px-3 pb-4">{children}</div>}
    </section>
  );
}

/**
 * Changing how you sign in needs a recent sign-in, so someone at an unlocked computer cannot add their own passkey.
 * This signs in again in place (password, passkey, then any later steps, or the demo button) and swaps in the session.
 */
function ConfirmIdentity({ onConfirmed, onCancel }: { onConfirmed: () => Promise<void>; onCancel: () => void }) {
  const session = useMaybeSession();
  const me = session?.me;
  const opts = useLoad("auth-options", vault.authOptions);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState<StepNeeded | null>(null);
  const isDemo = !!opts.data?.demo_login && !!me && ["admin", "analyst", "viewer"].includes(me.username);

  const adopt = async (r: SignedIn) => {
    setToken(r.token);
    await onConfirmed();
  };
  const run = async (fn: () => Promise<SignInResult>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (needsStep(r)) setNext(r);
      else await adopt(r);
    } catch (e) {
      setError(e instanceof DOMException ? "The passkey was cancelled." : errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (!me) return null;
  return (
    <div className="mb-5 rounded-card border border-amber/60 bg-raised p-4" role="dialog" aria-label="Confirm it's you">
      <h3 className="font-semibold">Confirm it&apos;s you</h3>
      <p className="mb-3 mt-1 text-sm text-muted">You signed in more than 15 minutes ago. Sign in again to change how {me.username} signs in.</p>
      {next ? (
        <SignInSteps start={next} onSignedIn={adopt} onCancel={onCancel} />
      ) : (
        <div className="flex flex-col gap-2">
          {isDemo ? (
            <Button variant="primary" busy={busy} onClick={() => run(() => vault.demoLogin(me.role))}>
              Confirm with the demo sign-in
            </Button>
          ) : (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => vault.login(me.username, password));
              }}
            >
              <label htmlFor="confirm-pw" className="sr-only">
                Password
              </label>
              <input
                id="confirm-pw"
                type="password"
                autoComplete="current-password"
                placeholder="Your password"
                className={cx(inputClass, "min-w-48 flex-1")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="submit" variant="primary" busy={busy} disabled={!password}>
                Confirm
              </Button>
            </form>
          )}
          {passkeysSupported() && !isDemo && (
            <Button busy={busy} onClick={() => run(() => signInWithPasskey(me.username))}>
              Confirm with a passkey
            </Button>
          )}
          <button type="button" onClick={onCancel} className="self-start text-xs text-muted underline underline-offset-4">
            Cancel
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-redline">{error}</p>}
    </div>
  );
}

function faceTestText(r: FaceTest): string {
  if (r.reason && r.reason !== "the face did not match") return r.reason;
  return `Your face did not match the saved one: closest ${r.best.toFixed(2)}, VAULT needs ${r.threshold.toFixed(2)} (every reading at least ${r.each_min.toFixed(2)}; lowest ${r.worst.toFixed(2)}). Try in the same light as the setup, or set it up again.`;
}

/** F09.22: what "Test my face now" found, with the real numbers, so a pass or a fail can be trusted. */
function FaceTestResult({ r }: { r: FaceTest }) {
  return (
    <p role="status" className="rounded-card border border-green/50 bg-raised p-3 text-sm">
      <span className="font-semibold text-green">It works. </span>
      <span className="text-muted">
        Closest match {r.best.toFixed(2)}, VAULT needs {r.threshold.toFixed(2)}; lowest reading {r.worst.toFixed(2)} (needs{" "}
        {r.each_min.toFixed(2)}). A sign-in would pass.
      </span>
    </p>
  );
}
