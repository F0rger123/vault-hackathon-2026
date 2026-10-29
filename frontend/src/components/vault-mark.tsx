import { cx } from "./ui";

/** Logo mark: a vault door. A dial ring with eight bolt marks around a keyhole, on a solid ink tile. */
const DIAL_TICKS = [
  [16.0, 8.6, 16.0, 6.8],
  [21.23, 10.77, 22.51, 9.49],
  [23.4, 16.0, 25.2, 16.0],
  [21.23, 21.23, 22.51, 22.51],
  [16.0, 23.4, 16.0, 25.2],
  [10.77, 21.23, 9.49, 22.51],
  [8.6, 16.0, 6.8, 16.0],
  [10.77, 10.77, 9.49, 9.49],
] as const;

export function VaultMark({ className, intro }: { className?: string; intro?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className={cx(className, intro && "vault-dial-intro")}>
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <g className="vault-dial" stroke="var(--on-accent)" strokeLinecap="round">
        <circle cx="16" cy="16" r="11" fill="none" strokeWidth="1.5" />
        {DIAL_TICKS.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={i % 2 ? 1.1 : 1.6} />
        ))}
      </g>
      <circle cx="16" cy="14.4" r="2.4" fill="var(--on-accent)" />
      <path d="M14.9 15.6h2.2l0.9 5.2h-4z" fill="var(--on-accent)" />
    </svg>
  );
}
