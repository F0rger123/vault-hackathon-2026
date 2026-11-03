"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "quiet";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent border-accent font-semibold shadow-[inset_0_-1px_0_rgb(0_0_0/0.18)] hover:brightness-[1.08] active:brightness-95",
  secondary: "bg-raised text-ink border-line-strong shadow-panel hover:border-muted hover:bg-panel",
  danger: "bg-redline/10 text-redline border-redline/50 hover:bg-redline/20",
  quiet: "bg-transparent text-blue border-transparent hover:underline underline-offset-4 px-1",
};

export function Button({
  variant = "secondary",
  className,
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "press inline-flex min-h-9 items-center justify-center gap-2 rounded-control border px-3.5 py-1.5 text-sm font-medium",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Panel({
  title,
  aside,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cx("trim min-w-0 rounded-card border border-line bg-panel shadow-panel", className)}>
      {title !== undefined && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3 sm:px-5 sm:py-3.5">
          <h2 className="display text-[15px] leading-snug">{title}</h2>
          {aside && <div className="text-sm text-muted">{aside}</div>}
        </header>
      )}
      <div className={cx("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

type Tone = "neutral" | "blue" | "green" | "amber" | "red";
const TONES: Record<Tone, string> = {
  neutral: "border-line-strong/60 bg-raised text-muted",
  blue: "border-blue/25 bg-blue/10 text-blue",
  green: "border-green/25 bg-green/10 text-green",
  amber: "border-amber/30 bg-amber/10 text-amber",
  red: "border-redline/30 bg-redline/10 text-redline",
};

export function Tag({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-control border px-2 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function VerifiedMark({ verified }: { verified: boolean }) {
  return verified ? (
    <Tag tone="green">
      <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3">
        <path d="M2 6.5 5 9.5 10 3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      Verified in source
    </Tag>
  ) : (
    <Tag tone="amber">Not found in source</Tag>
  );
}

export function Notice({
  tone = "error",
  children,
  className,
}: {
  tone?: "error" | "denied" | "info" | "warning";
  children: ReactNode;
  className?: string;
}) {
  const bar = {
    error: "border-l-amber",
    warning: "border-l-amber",
    denied: "border-l-redline",
    info: "border-l-blue",
  }[tone];
  return (
    <div
      role={tone === "error" || tone === "denied" ? "alert" : "status"}
      className={cx("rounded-control border border-line border-l-4 bg-raised px-3.5 py-2.5 text-sm", bar, className)}
    >
      {children}
    </div>
  );
}

/** Message for a failed load; explains permission errors in plain words. */
export function LoadError({ error, status, what }: { error: string | null; status: number | null; what: string }) {
  if (!error) return null;
  if (status === 403)
    return (
      <Notice tone="denied">
        Your role can&apos;t view {what}. Ask an administrator if you need access.
      </Notice>
    );
  return (
    <Notice>
      Couldn&apos;t load {what}: {error}
    </Notice>
  );
}

/** Nothing here yet: the logo's empty frame, then what to do about it. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong px-5 py-8 text-center text-sm text-muted">
      <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6 text-line-strong" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M2 8V2h6M16 2h6v6M22 16v6h-6M8 22H2v-6" />
      </svg>
      <span className="max-w-prose text-balance">{children}</span>
    </p>
  );
}

export function Meter({
  value,
  max,
  tone = "blue",
  label,
  running,
}: {
  value: number;
  max: number;
  tone?: "blue" | "green";
  label: string;
  /** Moving stripes while work is in progress, so a slow step never looks frozen. */
  running?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="h-1.5 w-full overflow-hidden rounded-full bg-raised ring-1 ring-line"
    >
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-700 ease-out",
          tone === "blue" ? "bg-accent" : "bg-accent/70",
          running && "bar-running",
        )}
        style={{ width: `${Math.max(pct, running ? 2 : 0)}%` }}
      />
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "min-h-9 w-full min-w-0 rounded-control border border-line-strong bg-raised px-3 py-1.5 text-sm text-ink placeholder:text-muted hover:border-muted focus-visible:border-accent";

/** A soft shimmering placeholder while data loads. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("skeleton inline-block align-middle", className)} />;
}

/** Counts a whole number up from zero once, on first show. Plain text for reduced motion or non-numbers. */
function CountUp({ text }: { text: string }) {
  const target = Number(text.replace(/,/g, ""));
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!Number.isFinite(target) || target < 10 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 650);
      setShown(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return <>{shown === null || shown === target ? text : shown.toLocaleString("en-US")}</>;
}

export function Figure({ label, value, tone }: { label: string; value: ReactNode; tone?: "red" | "amber" | "green" }) {
  return (
    <div className="min-w-0">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div
        className={cx(
          "display mt-1.5 whitespace-nowrap text-[26px] leading-none tabular-nums",
          tone === "red" && "text-redline",
          tone === "amber" && "text-amber",
          tone === "green" && "text-green",
        )}
      >
        {value === undefined || value === null ? (
          <Skeleton className="h-[26px] w-14" />
        ) : typeof value === "string" && /^\d[\d,]*$/.test(value) ? (
          <CountUp text={value} />
        ) : (
          value
        )}
      </div>
    </div>
  );
}
