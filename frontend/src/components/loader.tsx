import { cx } from "./ui";

/** The loading mark: eight bolts round a vault dial light up in turn. Used wherever something is on its way. */
export function Loader({ label, className, size = 16 }: { label?: string; className?: string; size?: number }) {
  return (
    <span role="status" className={cx("inline-flex items-center gap-2 text-sm text-muted", className)}>
      <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} className="loader-dial shrink-0">
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x="11" y="1.5" width="2" height="6" rx="1" transform={`rotate(${i * 45} 12 12)`} style={{ animationDelay: `${i * 0.1}s` }} />
        ))}
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
