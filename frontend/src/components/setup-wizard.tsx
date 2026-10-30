"use client";

import { useState, type ReactNode } from "react";
import { errorText, setToken, vault, type Hardware } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { ModelInstaller } from "./model-installer";
import { PasskeysPanel } from "./passkeys-panel";
import { Button, cx, Field, inputClass, Notice } from "./ui";

type Step = "welcome" | "owner" | "unlock" | "scan" | "models" | "start" | "open";

/** The vault door: its dial turns one notch with each step and swings open at the end. */
function VaultDoor({ turn, open }: { turn: number; open: boolean }) {
  const bolts = Array.from({ length: 12 }, (_, i) => (i * 360) / 12);
  return (
    <div aria-hidden className="vault-door-frame">
      <svg viewBox="0 0 200 200" className={cx("vault-door", open && "vault-door-open")}>
        <circle cx="100" cy="100" r="94" fill="var(--panel)" stroke="var(--line-strong)" strokeWidth="2" />
        <circle cx="100" cy="100" r="80" fill="none" stroke="var(--line)" strokeWidth="1" />
        {bolts.map((a) => (
          <circle key={a} cx="100" cy="14" r="3.5" fill="var(--muted)" transform={`rotate(${a} 100 100)`} />
        ))}
        <g className="vault-door-dial" style={{ transform: `rotate(${turn * 60}deg)` }}>
          <circle cx="100" cy="100" r="46" fill="var(--raised)" stroke="var(--ink)" strokeWidth="2" />
          {[0, 60, 120].map((a) => (
            <line key={a} x1="100" y1="58" x2="100" y2="142" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" transform={`rotate(${a} 100 100)`} />
          ))}
          <circle cx="100" cy="100" r="11" fill="var(--ink)" />
        </g>
      </svg>
    </div>
  );
}

function ScanLine({ label, value, delay }: { label: string; value: string; delay: number }) {
  return (
    <li className="scan-line flex items-baseline justify-between gap-4 border-b border-line py-2.5 text-sm" style={{ animationDelay: `${delay}ms` }}>
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </li>
  );
}

function ScanStep({ onNext }: { onNext: () => void }) {
  const hw = useLoad<Hardware>("wizard-hw", vault.hardware);
  const d = hw.data;
  return (
    <Pane title="Checking this computer" text="Measured now, on this machine. Nothing is sent anywhere.">
      {hw.error && <Notice>{hw.error}</Notice>}
      {d ? (
        <ul>
          <ScanLine label="Processor" value={`${d.physical_cores ?? "?"} cores, ${d.logical_cores} threads`} delay={0} />
          <ScanLine label="Memory" value={`${(d.ram_total_mb / 1024).toFixed(0)} GB`} delay={140} />
          <ScanLine
            label="Graphics card"
            value={d.gpus.length ? d.gpus.map((g) => `${g.name}${g.memory_mb ? `, ${Math.round(g.memory_mb / 1024)} GB` : ""}`).join("; ") : "None found: models run on the processor"}
            delay={280}
          />
          <ScanLine label="Free disk" value={`${(d.disk_free_mb / 1024).toFixed(0)} GB`} delay={420} />
        </ul>
      ) : (
        !hw.error && <div className="scan-sweep h-40 rounded-control border border-line" role="status" aria-label="Checking this computer" />
      )}
      <Actions onNext={onNext} ready={!!d} next="See which AI models fit" />
    </Pane>
  );
}

function Actions({ onNext, next, ready = true, skip }: { onNext: () => void; next: string; ready?: boolean; skip?: string }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <Button variant="primary" disabled={!ready} onClick={onNext}>
        {next}
      </Button>
      {skip && <span className="text-xs text-muted">{skip}</span>}
    </div>
  );
}

function Pane({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <section className="wizard-pane">
      <h1 className="display text-3xl">{title}</h1>
      <p className="mt-2 max-w-xl text-[15px] text-muted">{text}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function OwnerStep({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const score = Math.min(4, Math.floor(password.length / 5) + (/[^a-zA-Z]/.test(password) ? 1 : 0));
  const ok = username.trim() && password.length >= 10 && password === again;
  return (
    <Pane title="Create the owner account" text="This person runs VAULT for your organization. The password stays on this computer, stored only as a slow, salted hash (scrypt).">
      <form
        className="flex max-w-sm flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const session = await vault.setupOwner(username.trim(), password);
            setToken(session.token);
            onDone();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <Field label="Name" htmlFor="owner-name">
          <input id="owner-name" autoFocus autoComplete="username" className={inputClass} maxLength={64} value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Password (at least 10 characters)" htmlFor="owner-pass">
          <input id="owner-pass" type="password" autoComplete="new-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="flex gap-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cx("h-1 flex-1 rounded-full transition-colors duration-300", i < score ? (score >= 3 ? "bg-green" : "bg-amber") : "bg-line")} />
          ))}
        </div>
        <Field label="The same password again" htmlFor="owner-again">
          <input id="owner-again" type="password" autoComplete="new-password" className={inputClass} value={again} onChange={(e) => setAgain(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" busy={busy} disabled={!ok}>
          Create the account
        </Button>
        {error && <Notice>{error}</Notice>}
      </form>
    </Pane>
  );
}

function StartStep({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Pane title="Name your first collection" text="A collection is one archive with its own brain: one per project, division or client. What VAULT learns in one is never used in another.">
      <form
        className="flex max-w-sm flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await vault.createCollection(name.trim(), false);
            onDone();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <Field label="Collection name" htmlFor="first-collection">
          <input id="first-collection" autoFocus className={inputClass} maxLength={120} placeholder="Engineering archive" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="primary" busy={busy} disabled={!name.trim()}>
            Create and finish
          </Button>
          <Button type="button" variant="quiet" onClick={onDone}>
            Do this later
          </Button>
        </div>
        {error && <Notice>{error}</Notice>}
      </form>
    </Pane>
  );
}

/**
 * F10.14: the first-run setup. One calm step at a time: owner account, face, fingerprint or hardware key, a live
 * check of this computer, the Meta models that fit, and the first collection. It also opens from the Overview for
 * a person who is already signed in, without the account step.
 */
export function SetupWizard({ createOwner, onFinish }: { createOwner: boolean; onFinish: () => void }) {
  const order: Step[] = createOwner ? ["welcome", "owner", "unlock", "scan", "models", "start"] : ["welcome", "unlock", "scan", "models", "start"];
  const [step, setStep] = useState<Step>("welcome");
  const index = order.indexOf(step);
  const next = () => setStep(order[index + 1] ?? "open");
  const finish = () => {
    setStep("open");
    window.setTimeout(onFinish, 1100);
  };
  const LABELS: Record<Step, string> = {
    welcome: "Welcome",
    owner: "Owner",
    unlock: "Unlock",
    scan: "This computer",
    models: "AI models",
    start: "First collection",
    open: "",
  };

  return (
    <div className="wizard-backdrop grid min-h-dvh lg:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
      <aside className="flex flex-col items-center justify-center gap-8 border-b border-line px-8 py-10 lg:border-b-0 lg:border-r">
        <VaultDoor turn={step === "open" ? order.length : index} open={step === "open"} />
        {step !== "open" && (
          <ol className="hidden w-full max-w-[220px] flex-col gap-2 lg:flex" aria-label="Setup steps">
            {order.map((s, i) => (
              <li key={s} aria-current={s === step ? "step" : undefined} className={cx("flex items-center gap-2.5 text-sm transition-colors duration-300", i === index ? "font-medium text-ink" : i < index ? "text-muted" : "text-muted/60")}>
                <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full transition-all duration-300", i < index ? "bg-green" : i === index ? "scale-150 bg-ink" : "bg-line-strong")} />
                {LABELS[s]}
              </li>
            ))}
          </ol>
        )}
      </aside>
      <main className="flex min-w-0 items-center px-6 py-10 lg:px-16">
        <div key={step} className="w-full max-w-2xl">
          {step === "welcome" && (
            <Pane title="Welcome to VAULT" text="Private document intelligence that runs on this computer. Setup takes a couple of minutes, and every step after the first can be changed later.">
              <Actions onNext={next} next="Set up VAULT" />
            </Pane>
          )}
          {step === "owner" && <OwnerStep onDone={next} />}
          {step === "unlock" && (
            <Pane title="Choose how to unlock" text="Use your face or fingerprint (Windows Hello, Touch ID), or a physical USB security key such as a YubiKey. The key must be plugged in and touched, and your face or fingerprint never leaves the device.">
              <PasskeysPanel />
              <Actions onNext={next} next="Continue" skip="You can add one later under Security." />
            </Pane>
          )}
          {step === "scan" && <ScanStep onNext={next} />}
          {step === "models" && (
            <Pane title="AI models for this computer" text="VAULT recommends the Meta models that fit. Downloads continue in the background, and you can skip this and add them later.">
              <ModelInstaller admin />
              <Actions onNext={next} next="Continue" />
            </Pane>
          )}
          {step === "start" && <StartStep onDone={finish} />}
          {step === "open" && (
            <section className="wizard-pane" role="status">
              <h1 className="display text-3xl">VAULT is ready</h1>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
