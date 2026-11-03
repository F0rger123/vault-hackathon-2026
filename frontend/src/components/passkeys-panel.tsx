"use client";

import { useState } from "react";
import { ApiError, del, errorText, needsFace, put, api, setToken, vault, type SignedIn } from "@/lib/api";
import { enrollFace, faceStep } from "@/lib/face";
import { dateTime } from "@/lib/format";
import { addPasskey, passkeysSupported, signInWithPasskey, type PasskeyKind } from "@/lib/passkeys";
import { useLoad } from "@/lib/use-load";
import { FaceCapture } from "./face-capture";
import { useMaybeSession } from "./session";
import { Button, cx, Field, inputClass, Notice, Panel } from "./ui";

interface Mine {
  passkeys: { id: number; name: string; created_at: number; last_used_at: number | null }[];
  required: boolean;
}
interface FaceStatus {
  enrolled: boolean;
  samples: number;
  set_up_at: number | null;
  required: boolean;
}

const KINDS: { kind: PasskeyKind; label: string; name: string; hint: string }[] = [
  { kind: "device", label: "This computer", name: "This computer", hint: "Windows Hello face, fingerprint or PIN; Touch ID on a Mac" },
  { kind: "key", label: "Security key", name: "Security key", hint: "A USB or NFC key such as a YubiKey: plug it in and touch it" },
  { kind: "phone", label: "Phone", name: "Phone", hint: "Scan a QR code with your phone and confirm there" },
];

/** Stale-session answers from the server: changing how you sign in needs a sign-in in the last 15 minutes. */
function needsConfirm(e: unknown) {
  return e instanceof ApiError && e.status === 403 && /sign in again/.test(e.message);
}

/**
 * F09.14 and F09.19: how this account signs in. Passkeys (Windows Hello, a security key, a phone) and a face check
 * by webcam, each optional, and how strict to be. Every level is real: the server refuses sign-ins that skip a step.
 */
export function PasskeysPanel() {
  const mine = useLoad("passkeys", () => api<Mine>("/auth/passkeys"));
  const face = useLoad("face", () => api<FaceStatus>("/auth/face"));
  const [kind, setKind] = useState<PasskeyKind>("device");
  const [name, setName] = useState("This computer");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [confirm, setConfirm] = useState<(() => Promise<void>) | null>(null);
  const supported = passkeysSupported();

  const reload = () => {
    mine.reload();
    face.reload();
  };

  // Runs a change; if the server says "sign in again", asks the person to confirm and then retries it.
  const act = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    setError(null);
    setOk(null);
    try {
      await fn();
      reload();
      if (done) setOk(done);
    } catch (e) {
      if (needsConfirm(e)) setConfirm(() => async () => act(label, fn, done));
      else setError(e instanceof DOMException ? "The passkey was cancelled or not allowed on this device." : errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const level = !mine.data || !face.data ? null : (mine.data.required ? 2 : 0) + (face.data.required ? 1 : 0);
  const LEVELS = ["Password or passkey", "Password or passkey, then face check", "Passkey only", "Passkey, then face check"];

  return (
    <Panel title="How you sign in" aside={level !== null ? `Level ${level + 1} of 4` : undefined}>
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

      <ol className="mb-5 grid gap-2 text-sm sm:grid-cols-2" aria-label="Sign-in levels">
        {LEVELS.map((l, i) => (
          <li key={l} className={cx("rounded-control border px-3 py-2", level === i ? "border-green/60 bg-green/5" : "border-line")}>
            <span className={cx("font-mono text-xs", level === i ? "text-green" : "text-muted")}>Level {i + 1}</span>
            <span className="block font-medium">{l}</span>
            <span className="block text-xs text-muted">
              {
                [
                  "Easiest. A password can be guessed or phished.",
                  "Adds your face on this computer's webcam.",
                  "Phishing-proof: needs your device or key.",
                  "Strongest: your device or key, plus your face.",
                ][i]
              }
            </span>
          </li>
        ))}
      </ol>

      <section className="flex flex-col gap-3 border-t border-line pt-4" aria-labelledby="pk-h">
        <h3 id="pk-h" className="font-semibold">
          1. Passkeys {mine.data ? <span className="font-normal text-muted">({mine.data.passkeys.length} added)</span> : null}
        </h3>
        <p className="text-sm text-muted">
          A passkey signs you in with something you have. Your face, fingerprint or PIN is checked by the device and never
          leaves it; VAULT keeps only a public key.
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
            onClick={() => act("add", () => addPasskey(name.trim(), kind), "Passkey added. Sign out and use it to sign in.")}
          >
            {busy === "add" ? "Follow your device's prompt" : "Add a passkey"}
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
                    {k.last_used_at ? ` · last used ${dateTime(k.last_used_at)}` : " · not used yet"}
                  </span>
                </span>
                <Button variant="danger" busy={busy === `rm${k.id}`} onClick={() => act(`rm${k.id}`, () => del(`/auth/passkeys/${k.id}`))}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {mine.data && (
          <Toggle
            checked={mine.data.required}
            disabled={mine.data.passkeys.length === 0 || busy !== null}
            onChange={(v) => act("req", () => put("/auth/passkeys/required", { required: v }))}
            label="Require a passkey to sign in"
            hint="A password alone stops working. Add two passkeys (for example this computer and a spare key) so you cannot be locked out."
          />
        )}
      </section>

      <section className="mt-5 flex flex-col gap-3 border-t border-line pt-4" aria-labelledby="face-h">
        <h3 id="face-h" className="font-semibold">
          2. Face check by webcam{" "}
          {face.data && <span className="font-normal text-muted">({face.data.enrolled ? `set up ${dateTime(face.data.set_up_at ?? 0)}` : "not set up"})</span>}
        </h3>
        <p className="text-sm text-muted">
          After your password or passkey, VAULT looks at you through the webcam, checks you are a live person and not a
          photo, and compares your face with the one you set up. It runs on this computer with the open-source Human
          library; only numbers describing your face are stored, never a picture. It is an extra step, never a way in by
          itself.
        </p>
        {capturing ? (
          <FaceCapture
            mode="enroll"
            onCancel={() => setCapturing(false)}
            onDone={async (s) => {
              setCapturing(false);
              await act("face", () => enrollFace(s), "Face unlock is set up. Turn on “Require the face check” to use it.");
            }}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant={face.data?.enrolled ? "secondary" : "primary"} busy={busy === "face"} onClick={() => setCapturing(true)}>
              {face.data?.enrolled ? "Set it up again" : "Set up face check"}
            </Button>
            {face.data?.enrolled && (
              <Button variant="danger" busy={busy === "face-rm"} onClick={() => act("face-rm", () => del("/auth/face"), "Face data deleted.")}>
                Delete my face data
              </Button>
            )}
          </div>
        )}
        {face.data && (
          <Toggle
            checked={face.data.required}
            disabled={!face.data.enrolled || busy !== null}
            onChange={(v) => act("face-req", () => put("/auth/face/required", { required: v }))}
            label="Require the face check at every sign-in"
            hint="Needs a webcam at sign-in. If the camera breaks, an admin can turn this off for you under People."
          />
        )}
      </section>

      {ok && (
        <Notice tone="info" className="mt-4">
          {ok}
        </Notice>
      )}
      {error && <Notice className="mt-4">{error}</Notice>}
    </Panel>
  );
}

function Toggle({ checked, disabled, onChange, label, hint }: { checked: boolean; disabled: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Changing how you sign in needs a recent sign-in, so someone at an unlocked computer cannot add their own passkey.
 * This signs in again in place (password, passkey, face check, or the demo button) and swaps in the new session.
 */
function ConfirmIdentity({ onConfirmed, onCancel }: { onConfirmed: () => Promise<void>; onCancel: () => void }) {
  const session = useMaybeSession();
  const me = session?.me;
  const opts = useLoad("auth-options", vault.authOptions);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const isDemo = !!opts.data?.demo_login && !!me && ["admin", "analyst", "viewer"].includes(me.username);

  const adopt = async (r: SignedIn) => {
    setToken(r.token);
    await onConfirmed();
  };
  const run = async (fn: () => Promise<SignedIn | { step: "face"; handle: string; username: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (needsFace(r)) setHandle(r.handle);
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
      {handle ? (
        <FaceCapture
          mode="verify"
          onCancel={onCancel}
          onDone={async (s) => {
            try {
              await adopt(await faceStep(handle, s));
            } catch (e) {
              setError(errorText(e));
              setHandle(null);
            }
          }}
        />
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
