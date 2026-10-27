import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "quiet";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brass text-on-brass border-brass font-semibold hover:brightness-110 active:brightness-95",
  secondary: "bg-raised text-ink border-line-strong hover:border-muted hover:bg-panel",
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
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-control border px-3.5 py-1.5 text-sm font-medium transition-[background-color,border-color,filter] duration-150",
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
    <section id={id} className={cx("min-w-0 rounded-card border border-line bg-panel shadow-panel", className)}>
      {title !== undefined && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold tracking-[-0.005em]">{title}</h2>
          {aside && <div className="text-sm text-muted">{aside}</div>}
        </header>
      )}
      <div className={cx("p-5", bodyClassName)}>{children}</div>
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

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-card border border-dashed border-line-strong px-5 py-8 text-center text-sm text-muted">{children}</p>;
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
      className="h-1.5 w-full overflow-hidden rounded-full bg-raised ring-1 ring-line"
    >
      <div className={cx("h-full rounded-full transition-[width] duration-500", tone === "blue" ? "bg-brass" : "bg-green")} style={{ width: `${pct}%` }} />
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
  "min-h-9 w-full min-w-0 rounded-control border border-line-strong bg-raised px-3 py-1.5 text-sm text-ink placeholder:text-muted hover:border-muted focus-visible:border-brass";

export function Figure({ label, value, tone }: { label: string; value: ReactNode; tone?: "red" | "amber" | "green" }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-muted">{label}</div>
      <div
        className={cx(
          "display mt-1 whitespace-nowrap text-[26px] leading-none tabular-nums",
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
