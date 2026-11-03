"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, errorText, setToken, vault, type InvitePreview } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { useUrl } from "./invite-wizard";
import { useMaybeSession, useSessionState } from "./session";
import { STEP_NAMES } from "./sign-in-steps";
import { Button, Field, inputClass, Notice } from "./ui";
import { VaultMark } from "./vault-mark";

/**
 * The code from `/join#CODE`. Only the part after `#` is read: browsers never send it to any server, and the API
 * receives the code in a request body, so it never appears in a URL that a server or proxy could log.
 */
function codeFrom(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, "")).trim();
  } catch {
    return hash.replace(/^#/, "").trim();
  }
}

/** F09.21: the page an invited person opens. They see who invited them and as what, then pick their password. */
export function JoinView() {
  const { hash } = useUrl();
  const code = codeFrom(hash);
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="animate-rise w-full max-w-md rounded-card border border-line bg-panel shadow-lift">
        <div className="vault-dial-intro flex items-center gap-3 border-b border-line px-5 py-4">
          <VaultMark className="h-8 w-8" />
          <span className="display text-lg">VAULT</span>
        </div>
        <div className="flex flex-col gap-4 px-5 py-5">{code ? <Join key={code} code={code} /> : <EnterCode />}</div>
      </div>
    </div>
  );
}

function EnterCode() {
  const [typed, setTyped] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        window.location.hash = typed.trim();
      }}
    >
      <h1 className="display text-xl">Join VAULT</h1>
      <p className="text-sm text-muted">Open the invite link you were sent, or type the code from it here.</p>
      <Field label="Invite code" htmlFor="join-code">
        <input
          id="join-code"
          className={`${inputClass} font-mono tracking-wider`}
          autoComplete="off"
          autoFocus
          maxLength={64}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" disabled={typed.trim().length < 20}>
        Continue
      </Button>
    </form>
  );
}

function Join({ code }: { code: string }) {
  const router = useRouter();
  const { refresh } = useSessionState();
  const current = useMaybeSession();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    vault.invitePreview(code).then(
      (p) => alive && setPreview(p),
      (e) => alive && setProblem(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [code]);

  if (problem)
    return (
      <>
        <h1 className="display text-xl">This invite cannot be used</h1>
        <Notice>{problem}</Notice>
        <p className="text-sm text-muted">Ask the person who invited you for a new link. Each one works once, for 48 hours.</p>
        <Link href="/" className="text-sm text-blue underline underline-offset-4">
          Go to sign in
        </Link>
      </>
    );
  if (!preview)
    return (
      <p className="text-sm text-muted" role="status">
        Checking your invite...
      </p>
    );

  const min = preview.min_password;
  const mismatch = again.length > 0 && again !== password;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (password.length < min || password !== again) return;
        setBusy(true);
        setError(null);
        try {
          const session = await vault.acceptInvite(code, password);
          setToken(session.token);
          // Drop the code from the address bar and history before moving on; it is used up anyway.
          window.history.replaceState(null, "", "/join");
          refresh();
          router.replace("/security?joined=1");
        } catch (err) {
          setError(err instanceof ApiError && err.status === 422 ? `Use a password of at least ${min} characters.` : errorText(err));
          setBusy(false);
        }
      }}
    >
      <h1 className="display text-xl">Welcome, {preview.username}</h1>
      <p className="text-sm">
        <span className="font-medium">{preview.invited_by}</span> invited you to VAULT as{" "}
        <span className="font-medium">{preview.role}</span>.
      </p>
      <p className="text-xs text-muted">This invite works once, until {dateTime(preview.expires_at)}.</p>
      {current && (
        <Notice tone="info">
          This tab is signed in as {current.me.username}. Choosing a password here signs you in as {preview.username} instead.
        </Notice>
      )}
      <input type="text" name="username" autoComplete="username" value={preview.username} readOnly hidden />
      <Field label="Choose a password" htmlFor="join-password" hint={`At least ${min} characters. A few unrelated words is easy to remember and hard to guess.`}>
        <input
          id="join-password"
          type="password"
          autoComplete="new-password"
          autoFocus
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field label="Type it again" htmlFor="join-password-again" hint={mismatch ? "The two passwords are different." : undefined}>
        <input
          id="join-password-again"
          type="password"
          autoComplete="new-password"
          className={inputClass}
          aria-invalid={mismatch || undefined}
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </Field>
      {error && <Notice>{error}</Notice>}
      <Button type="submit" variant="primary" busy={busy} disabled={password.length < min || password !== again}>
        Set password and sign in
      </Button>
    </form>
  );
}

/**
 * F09.21: on Security, right after joining, and whenever an admin asked for steps this person has not set up yet.
 * The steps themselves are set up in the sign-in steps panel below.
 */
export function JoinedHint() {
  const { search } = useUrl();
  const joined = new URLSearchParams(search).get("joined") === "1";
  const steps = useLoad("my-steps", vault.mySteps, 15000);
  const asked = steps.data?.requested ?? [];
  if (!joined && asked.length === 0) return null;
  return (
    <Notice tone="info" className="mb-6">
      {joined && <p className="font-medium">You are signed in. Welcome to VAULT.</p>}
      {asked.length > 0 ? (
        <p className={joined ? "mt-1" : undefined}>
          Your administrator asked you to also set up {asked.map((s) => STEP_NAMES[s].toLowerCase()).join(" and ")}. Set{" "}
          {asked.length > 1 ? "each one" : "it"} up below. VAULT switches it on as soon as it is ready and asks for it every
          time you sign in after that.
        </p>
      ) : (
        steps.data && (
        <p className="mt-1">
          Your password is your only sign-in step right now. Add a passkey, a face check or a key phrase below to make your
          account harder to break into, and change your password here any time.
        </p>
        )
      )}
    </Notice>
  );
}
