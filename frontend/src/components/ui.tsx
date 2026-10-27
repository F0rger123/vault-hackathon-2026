import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "quiet";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-blue text-on-blue border-blue hover:brightness-110",
  secondary: "bg-panel text-ink border-line hover:border-ink",
  danger: "bg-panel text-redline border-redline hover:bg-redline/10",
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
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-[3px] border px-3 py-1.5 text-sm font-medium transition-colors",
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
    <section id={id} className={cx("min-w-0 border border-line bg-panel", className)}>
      {title !== undefined && (
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-2.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {aside && <div className="text-sm text-muted">{aside}</div>}
        </header>
      )}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

type Tone = "neutral" | "blue" | "green" | "amber" | "red";
const TONES: Record<Tone, string> = {
  neutral: "border-line text-muted",
  blue: "border-blue/50 text-blue",
  green: "border-green/50 text-green",
  amber: "border-amber/60 text-amber",
  red: "border-redline/60 text-redline",
};

export function Tag({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] border px-1.5 py-px text-xs font-medium",
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
      className={cx("border border-line border-l-4 bg-panel px-3 py-2 text-sm", bar, className)}
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

export function Empty({ children }: { children: ReactNode }) {
  return <p className="border border-dashed border-line px-4 py-6 text-sm text-muted">{children}</p>;
}

export function Meter({ value, max, tone = "blue", label }: { value: number; max: number; tone?: "blue" | "green"; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="h-2 w-full border border-line bg-paper"
    >
      <div className={cx("h-full transition-[width] duration-500", tone === "blue" ? "bg-blue" : "bg-green")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "min-h-9 w-full min-w-0 rounded-[3px] border border-line bg-panel px-2.5 py-1.5 text-sm text-ink placeholder:text-muted focus-visible:border-blue";

export function Figure({ label, value, tone }: { label: string; value: ReactNode; tone?: "red" | "amber" | "green" }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div
        className={cx(
          "mt-0.5 text-2xl font-semibold tabular-nums",
          tone === "red" && "text-redline",
          tone === "amber" && "text-amber",
          tone === "green" && "text-green",
        )}
      >
        {value}
      </div>
    </div>
  );
}
