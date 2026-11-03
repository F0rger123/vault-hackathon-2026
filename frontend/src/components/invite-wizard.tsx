"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { errorText, inviteLink, vault, type ExtraStep, type Invite, type InviteCreated, type RoleInfo } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { encodeQr } from "@/lib/qr";
import { useLoad } from "@/lib/use-load";
import { STEP_NAMES, StepIcon } from "./sign-in-steps";
import { Button, cx, Field, inputClass, Notice, Skeleton, Tag } from "./ui";

/** Same rule as the server, so a bad name is caught before the last step. */
export const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._@-]{1,63}$/;
const EXTRAS: ExtraStep[] = ["passkey", "face", "voice"];
const EXTRA_HOW: Record<ExtraStep, string> = {
  passkey: "Windows Hello, Touch ID, a security key or their phone.",
  face: "A webcam check. Only numbers describing the face are kept, never a picture.",
  voice: "A phrase they say aloud. Only numbers describing the sound are kept, never a recording.",
};
const STAGES = ["Who", "What they can do", "How they sign in", "How they get in", "Review"] as const;

type Method = "link" | "password";

/**
 * F09.21: give someone access, one question at a time. Ends with a one-time invite link (they pick their own
 * password) or, if the admin prefers, an account with a temporary password.
 */
export function InviteWizard({ taken, onClose, onCreated }: { taken: string[]; onClose: () => void; onCreated: () => void }) {
  const roles = useLoad("roles", vault.roles);
  const [stage, setStage] = useState(0);
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");
  const [role, setRole] = useState<string>("viewer");
  const [extras, setExtras] = useState<ExtraStep[]>([]);
  const [method, setMethod] = useState<Method>("link");
  const [temp, setTemp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ invite?: InviteCreated; username: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Move focus to each new question so keyboard and screen-reader users land on it (not on first open: the name
  // field has it then).
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) heading.current?.focus();
    opened.current = true;
  }, [stage, made]);

  const name = username.trim();
  const nameProblem = !name
    ? null
    : !USERNAME.test(name)
      ? "Use 2 to 64 letters, numbers, dots, dashes, underscores or @, starting with a letter or number."
      : taken.some((t) => t.toLowerCase() === name.toLowerCase())
        ? "Someone already has that name."
        : null;
  const ok = [name.length >= 2 && !nameProblem, roles.data?.some((r) => r.role === role) ?? false, true, method === "link" || temp.length >= 10, true];
  const chosen = roles.data?.find((r) => r.role === role);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      if (method === "link") {
        setMade({ username: name, invite: await vault.createInvite({ username: name, role, note: note.trim(), steps: extras }) });
      } else {
        await vault.addUser(name, role, temp, extras);
        setMade({ username: name });
      }
      onCreated();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (!ok[stage]) return;
    if (stage < STAGES.length - 1) setStage(stage + 1);
    else void create();
  };

  return (
    <div
      className="animate-rise rounded-card border border-line-strong bg-raised p-4 sm:p-5"
      role="region"
      aria-label="Invite someone"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="display text-base">Invite someone</h3>
        <Button variant="quiet" onClick={onClose}>
          {made ? "Close" : "Cancel"}
        </Button>
      </div>
      <Trail stage={made ? STAGES.length : stage} onPick={made ? undefined : setStage} />

      {made ? (
        <div key="done" className="animate-rise mt-5">
          <h4 ref={heading} tabIndex={-1} className="display text-lg outline-none">
            {made.invite ? `Invite ready for ${made.username}` : `${made.username} can sign in now`}
          </h4>
          {made.invite ? <InviteResult invite={made.invite} /> : <TempPasswordDone extras={extras} />}
          <div className="mt-4">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          key={stage}
          className="animate-rise mt-5 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          <h4 ref={heading} tabIndex={-1} className="display text-lg outline-none">
            <span className="mr-2 font-mono text-xs font-normal text-muted">
              {stage + 1}/{STAGES.length}
            </span>
            {
              [
                "Who are you inviting?",
                "What can they do?",
                "How will they sign in?",
                "How will they get in?",
                "Check and create",
              ][stage]
            }
          </h4>

          {stage === 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Username" htmlFor="invite-name" hint={nameProblem ?? "What they type to sign in. They cannot change it."}>
                <input
                  id="invite-name"
                  className={inputClass}
                  maxLength={64}
                  autoComplete="off"
                  autoFocus
                  aria-invalid={nameProblem ? true : undefined}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </Field>
              <Field label="Note for admins (optional)" htmlFor="invite-note" hint="For example their team or why they need access. Only admins see it.">
                <input id="invite-note" className={inputClass} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
          )}

          {stage === 1 && <RolePicker roles={roles.data} error={roles.error} role={role} setRole={setRole} />}

          {stage === 2 && (
            <fieldset className="flex flex-col gap-3">
              <legend className="sr-only">Sign-in steps</legend>
              <p className="text-sm text-muted">
                Everyone starts with a password they choose themselves. You can also ask for more steps. Each one needs
                their own device, face or voice, so only they can set it up: VAULT asks them to on their Security page
                and switches each step on the moment it is ready. Until then their password is enough.
              </p>
              <label className="flex items-start gap-3 rounded-control border border-line bg-panel p-3 text-sm opacity-80">
                <input type="checkbox" checked disabled className="mt-0.5" />
                <span>
                  <span className="flex items-center gap-1.5 font-medium">
                    <StepIcon step="password" /> Password
                  </span>
                  <span className="block text-xs text-muted">Always on. They pick it when they first open the invite.</span>
                </span>
              </label>
              {EXTRAS.map((s) => (
                <label key={s} className="flex cursor-pointer items-start gap-3 rounded-control border border-line bg-panel p-3 text-sm hover:border-muted">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={extras.includes(s)}
                    onChange={(e) => setExtras(e.target.checked ? EXTRAS.filter((x) => x === s || extras.includes(x)) : extras.filter((x) => x !== s))}
                  />
                  <span>
                    <span className="flex items-center gap-1.5 font-medium">
                      <StepIcon step={s} /> Also ask for {STEP_NAMES[s].toLowerCase()}
                    </span>
                    <span className="block text-xs text-muted">{EXTRA_HOW[s]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {stage === 3 && (
            <fieldset className="flex flex-col gap-3">
              <legend className="sr-only">How they get in</legend>
              <Choice
                name="invite-method"
                checked={method === "link"}
                onChange={() => setMethod("link")}
                title="One-time invite link (recommended)"
                detail="VAULT makes a link and a code. They open it and choose their own password, so you never know it. It works once, for 48 hours, and you can withdraw it until then."
              />
              <Choice
                name="invite-method"
                checked={method === "password"}
                onChange={() => setMethod("password")}
                title="Set a temporary password instead"
                detail="The account is made now. Give them the password in person and ask them to change it on Security."
              />
              {method === "password" && (
                <Field label="Temporary password, 10 characters or more" htmlFor="invite-temp">
                  <input id="invite-temp" type="password" autoComplete="new-password" autoFocus className={inputClass} value={temp} onChange={(e) => setTemp(e.target.value)} />
                </Field>
              )}
            </fieldset>
          )}

          {stage === 4 && (
            <dl className="grid gap-x-6 gap-y-2 rounded-control border border-line bg-panel p-3 text-sm sm:grid-cols-[auto_1fr]">
              <Row label="Username">
                <span className="font-medium">{name}</span>
                {note.trim() && <span className="block text-xs text-muted">{note.trim()}</span>}
              </Row>
              <Row label="Role">
                <span className="capitalize">{role}</span>
                {chosen && <span className="block text-xs text-muted">{chosen.summary}</span>}
              </Row>
              <Row label="Sign-in">
                {["Password", ...extras.map((s) => STEP_NAMES[s])].join(", then ")}
                {extras.length > 0 && <span className="block text-xs text-muted">Extra steps switch on as they set each one up.</span>}
              </Row>
              <Row label="Getting in">{method === "link" ? "One-time link and code, valid 48 hours" : "Temporary password you hand over"}</Row>
            </dl>
          )}

          {error && <Notice>{error}</Notice>}
          <div className="flex flex-wrap gap-2">
            {stage > 0 && (
              <Button type="button" onClick={() => setStage(stage - 1)}>
                Back
              </Button>
            )}
            <Button type="submit" variant="primary" busy={busy} disabled={!ok[stage]}>
              {stage < STAGES.length - 1 ? "Next" : method === "link" ? "Create invite" : "Create account"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** The five questions as a trail. Finished ones can be clicked to go back; the line fills as they are answered. */
function Trail({ stage, onPick }: { stage: number; onPick?: (i: number) => void }) {
  return (
    <ol className="relative flex items-start justify-between" aria-label="Invite steps">
      <span className="absolute left-4 right-4 top-4 h-px bg-line" aria-hidden />
      <span
        className="absolute left-4 top-4 h-px bg-green transition-[width] duration-500 ease-out"
        style={{ width: `calc((100% - 2rem) * ${Math.min(1, stage / (STAGES.length - 1))})` }}
        aria-hidden
      />
      {STAGES.map((label, i) => {
        const done = i < stage;
        const now = i === stage;
        const dot = (
          <span
            className={cx(
              "grid h-8 w-8 place-items-center rounded-full border bg-panel font-mono text-xs transition-colors duration-300",
              done ? "border-green bg-green text-black" : now ? "live-dot border-green text-green" : "border-line text-muted",
            )}
          >
            {done ? (
              <svg viewBox="0 0 16 16" className="pop-in h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                <path d="M3.5 8.5l3 3 6-7" />
              </svg>
            ) : (
              i + 1
            )}
          </span>
        );
        return (
          <li key={label} className="relative z-10 flex w-14 flex-col items-center gap-1.5 text-center sm:w-20" aria-current={now ? "step" : undefined}>
            {done && onPick ? (
              <button type="button" className="press rounded-full" onClick={() => onPick(i)} aria-label={`Back to: ${label}`}>
                {dot}
              </button>
            ) : (
              dot
            )}
            <span className={cx("text-[11px] leading-tight", now ? "font-medium text-ink" : "hidden text-muted sm:block")}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function RolePicker({ roles, error, role, setRole }: { roles?: RoleInfo[]; error: string | null; role: string; setRole: (r: string) => void }) {
  if (error) return <Notice>{error}</Notice>;
  if (!roles) return <Skeleton className="h-40" />;
  const chosen = roles.find((r) => r.role === role);
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Role</legend>
        {roles.map((r) => (
          <Choice
            key={r.role}
            name="invite-role"
            checked={role === r.role}
            onChange={() => setRole(r.role)}
            title={<span className="capitalize">{r.role}</span>}
            detail={r.summary}
          />
        ))}
      </fieldset>
      {chosen && (
        <div key={chosen.role} className="animate-rise rounded-control border border-line bg-panel p-3 text-sm" aria-live="polite">
          <p className="mb-2 font-medium">
            As <span className="capitalize">{chosen.role}</span> they can:
          </p>
          <ul className="flex flex-col gap-1" aria-label={`What ${chosen.role} can do`}>
            {chosen.allowed.map((p) => (
              <li key={p.id} className="flex gap-2">
                <span className="text-green" aria-hidden>
                  +
                </span>
                {p.label}
              </li>
            ))}
          </ul>
          {chosen.not_allowed.length > 0 && (
            <>
              <p className="mb-2 mt-3 font-medium">They cannot:</p>
              <ul className="flex flex-col gap-1 text-muted" aria-label={`What ${chosen.role} cannot do`}>
                {chosen.not_allowed.map((p) => (
                  <li key={p.id} className="flex gap-2">
                    <span aria-hidden>-</span>
                    {p.label}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-3 text-xs text-muted">Read from the same table the server checks on every request.</p>
        </div>
      )}
    </div>
  );
}

function Choice({ name, checked, onChange, title, detail }: { name: string; checked: boolean; onChange: () => void; title: ReactNode; detail: string }) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-start gap-3 rounded-control border bg-panel p-3 text-sm transition-colors",
        checked ? "border-ink" : "border-line hover:border-muted",
      )}
    >
      <input type="radio" name={name} className="mt-0.5" checked={checked} onChange={onChange} />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted">{detail}</span>
      </span>
    </label>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function InviteResult({ invite }: { invite: InviteCreated }) {
  const link = inviteLink(invite.code);
  return (
    <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-sm text-muted">
          Send this to {invite.username} in a way you trust: in person, on a call or in your team chat. Anyone holding it
          can claim the account until it is used, so do not post it anywhere public. It works once, until{" "}
          {dateTime(invite.expires_at)}. VAULT will not show it again; it keeps only a scrambled copy to check against.
        </p>
        <CopyField id="invite-link" label="Invite link" value={link} />
        <CopyField id="invite-code" label="Or the code, typed on the Join page" value={invite.code} mono />
      </div>
      <QrCode text={link} label={`QR code of the invite link for ${invite.username}`} />
    </div>
  );
}

function TempPasswordDone({ extras }: { extras: ExtraStep[] }) {
  return (
    <p className="mt-2 text-sm text-muted">
      Give them the temporary password in person, never in the same message as their username. They can change it on
      Security.
      {extras.length > 0 && ` Once signed in, Security asks them to set up ${extras.map((s) => STEP_NAMES[s].toLowerCase()).join(" and ")}.`}
    </p>
  );
}

function CopyField({ id, label, value, mono }: { id: string; label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex gap-2">
        <input
          ref={input}
          id={id}
          readOnly
          className={cx(inputClass, mono && "font-mono tracking-wider")}
          value={value}
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          type="button"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied("yes");
            } catch {
              // No clipboard permission (or not a secure page): select it so Ctrl+C works.
              input.current?.select();
              setCopied("no");
            }
          }}
        >
          {copied === "yes" ? "Copied" : copied === "no" ? "Press Ctrl+C" : "Copy"}
        </Button>
      </div>
    </Field>
  );
}

/** Drawn here from a local encoder, so the link never goes to an outside QR service. Always dark on white. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const path = useMemo(() => {
    const m = encodeQr(text);
    if (!m) return null;
    let d = "";
    m.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x + 4} ${y + 4}h1v1h-1z`)));
    return { d, size: m.length + 8 };
  }, [text]);
  if (!path) return <p className="text-xs text-muted">This link is too long for a QR code; copy it instead.</p>;
  return (
    <figure className="flex flex-col items-center gap-1.5">
      <svg role="img" aria-label={label} viewBox={`0 0 ${path.size} ${path.size}`} className="h-44 w-44 rounded-control bg-white" shapeRendering="crispEdges">
        <path d={path.d} fill="#000" />
      </svg>
      <figcaption className="text-xs text-muted">Scan with a phone camera</figcaption>
    </figure>
  );
}

/** Invites that still work, newest first, each withdrawable. */
export function PendingInvites({ version, onChange }: { version: number; onChange: () => void }) {
  const invites = useLoad(`invites-${version}`, vault.invites);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!invites.data?.length) return invites.error ? <Notice>{invites.error}</Notice> : null;
  return (
    <section className="mb-4" aria-labelledby="pending-invites-h">
      <h3 id="pending-invites-h" className="mb-2 text-sm font-medium">
        Invites waiting ({invites.data.length})
      </h3>
      {error && <Notice className="mb-2">{error}</Notice>}
      <ul className="flex flex-col divide-y divide-line rounded-control border border-line" aria-label="Invites waiting">
        {invites.data.map((i: Invite) => (
          <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
            <span className="min-w-40 flex-1">
              <span className="font-medium">{i.username}</span>{" "}
              <Tag className="ml-1 capitalize">{i.role}</Tag>
              <span className="block text-xs text-muted">
                Invited by {i.created_by}, works until {dateTime(i.expires_at)}
                {i.steps.length > 0 && `; asks for ${i.steps.map((s) => STEP_NAMES[s].toLowerCase()).join(", ")}`}
                {i.note && ` · ${i.note}`}
              </span>
            </span>
            <Button
              variant="danger"
              busy={busy === i.id}
              onClick={async () => {
                setBusy(i.id);
                setError(null);
                try {
                  await vault.revokeInvite(i.id);
                  onChange();
                  invites.reload();
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy(null);
                }
              }}
            >
              Withdraw
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const subscribeUrl = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  window.addEventListener("popstate", cb);
  return () => {
    window.removeEventListener("hashchange", cb);
    window.removeEventListener("popstate", cb);
  };
};

/** The page address, read without a server render (so the invite code after # stays in the browser). */
export function useUrl(): { hash: string; search: string } {
  const hash = useSyncExternalStore(subscribeUrl, () => window.location.hash, () => "");
  const search = useSyncExternalStore(subscribeUrl, () => window.location.search, () => "");
  return { hash, search };
}
