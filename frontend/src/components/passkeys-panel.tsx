"use client";

import { useState } from "react";
import { del, errorText, put, api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { addPasskey, passkeysSupported } from "@/lib/passkeys";
import { useLoad } from "@/lib/use-load";
import { UnlockSequence, type UnlockPhase } from "./unlock-sequence";
import { Button, Field, inputClass, Notice, Panel } from "./ui";

interface Mine {
  passkeys: { id: number; name: string; created_at: number; last_used_at: number | null }[];
  required: boolean;
}

/** F09.14: register Windows Hello, Touch ID or a hardware security key, and optionally require it. */
export function PasskeysPanel() {
  const mine = useLoad("passkeys", () => api<Mine>("/auth/passkeys"));
  const [name, setName] = useState("This computer");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<UnlockPhase | null>(null);
  const supported = passkeysSupported();

  const enrol = async () => {
    setScan("scanning");
    setBusy("add");
    setError(null);
    try {
      await addPasskey(name.trim());
      mine.reload();
      setScan("granted");
    } catch (e) {
      setScan("denied");
      setError(e instanceof DOMException ? "The passkey was cancelled or not allowed on this device." : errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      mine.reload();
    } catch (e) {
      setError(e instanceof DOMException ? "The passkey was cancelled or not allowed on this device." : errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Face, fingerprint or security key" aside={mine.data ? `${mine.data.passkeys.length} registered` : undefined}>
      <p className="mb-3 text-sm text-muted">
        Sign in with Windows Hello (face or fingerprint), Touch ID, or a hardware key such as a YubiKey. Your face,
        fingerprint or PIN never leaves your device; VAULT only keeps a public key, so a stolen database cannot be used
        to sign in. A hardware key works on servers without a camera.
      </p>
      {scan && (
        <UnlockSequence
          phase={scan}
          face
          title={scan === "granted" ? "Unlock is ready" : scan === "scanning" ? "Registering this device" : "Not registered"}
          detail={scan === "scanning" ? "Follow your device's prompt: your face, fingerprint, PIN or a touch of your key. Your device checks you; VAULT never sees the camera." : undefined}
          onDone={() => setScan(null)}
        />
      )}
      {!supported && <Notice tone="warning">This browser or window cannot use passkeys.</Notice>}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Field label="Name for this passkey" htmlFor="passkey-name">
              <input id="passkey-name" className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Button variant="primary" disabled={!supported || !name.trim()} busy={busy === "add"} onClick={enrol}>
            Add a passkey
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
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={mine.data.required}
              disabled={mine.data.passkeys.length === 0 || busy !== null}
              onChange={(e) => act("req", () => put("/auth/passkeys/required", { required: e.target.checked }))}
            />
            <span>
              Require my passkey to sign in
              <span className="block text-xs text-muted">
                Password alone stops working for this account. Keep a second passkey (for example a spare security key)
                so you cannot be locked out.
              </span>
            </span>
          </label>
        )}
        {error && <Notice>{error}</Notice>}
      </div>
    </Panel>
  );
}
