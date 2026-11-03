import { cx } from "./ui";

/**
 * Logo mark (F10.21): a keyhole framed by four trim marks on a solid ink tile. The keyhole says vault; the trim marks
 * are the corner marks of a drawing sheet and the frame a scanner puts round what it reads. Solid shapes and 2.4-unit
 * strokes on a 32-unit grid, so it still reads at 16 px. The same frame is the face check's reticle and the loader.
 */
export function VaultMark({ className, intro }: { className?: string; intro?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className={cx("vault-mark", className, intro && "vault-mark-intro")}>
      <rect width="32" height="32" rx="7" fill="var(--ink)" />
      <path
        className="vault-trim"
        d="M6.5 12V6.5H12M20 6.5h5.5V12M25.5 20v5.5H20M12 25.5H6.5V20"
        fill="none"
        stroke="var(--paper)"
        strokeWidth="2.4"
      />
      <g className="vault-keyhole" fill="var(--paper)">
        <circle cx="16" cy="13.9" r="3.6" />
        <path d="M13.9 16.3h4.2l1.1 6.3h-6.4z" />
      </g>
    </svg>
  );
}

/** Mark and wordmark together. The wordmark is Archivo at its widest, spaced like lettering on a title block. */
export function VaultLockup({ size = "md", intro }: { size?: "md" | "lg"; intro?: boolean }) {
  return (
    <span className={cx("vault-lockup inline-flex items-center", size === "lg" ? "gap-4" : "gap-3")}>
      <VaultMark className={size === "lg" ? "h-12 w-12" : "h-8 w-8"} intro={intro} />
      <span className={cx("wordmark text-ink", size === "lg" ? "text-[26px]" : "text-[15px]")}>VAULT</span>
    </span>
  );
}
