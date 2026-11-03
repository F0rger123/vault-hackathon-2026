// No imports from ./ui: that module is client-only, and this one also renders in server pages (run/page.tsx).
const cx = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" ");

// The logo's four trim marks, clockwise from the top left.
const CORNERS = ["M2 8V2h6", "M16 2h6v6", "M22 16v6h-6", "M8 22H2v-6"];

/** The loading mark: the logo's trim marks light in turn round its keyhole. Used wherever something is on its way. */
export function Loader({ label, className, size = 16 }: { label?: string; className?: string; size?: number }) {
  return (
    <span role="status" className={cx("inline-flex items-center gap-2 text-sm text-muted", className)}>
      <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} className="loader-dial shrink-0">
        {CORNERS.map((d, i) => (
          <path key={d} d={d} fill="none" strokeWidth="2.6" style={{ animationDelay: `${i * 0.18}s` }} />
        ))}
        <circle cx="12" cy="10.4" r="2.6" fill="currentColor" />
        <path d="M10.5 12.2h3l.8 4.6h-4.6z" fill="currentColor" />
      </svg>
      {label && <span className="loader-label">{label}</span>}
    </span>
  );
}

/** A whole area that is loading: the dial in the middle of a quiet frame, sized like what will replace it. */
export function LoadingBlock({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div className={cx("grid min-h-32 place-items-center rounded-card border border-dashed border-line", className)}>
      <Loader label={label} size={22} />
    </div>
  );
}
