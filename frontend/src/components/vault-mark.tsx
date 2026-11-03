import { cx } from "./ui";

/**
 * Logo mark (F10.18): a vault door seen head on. A heavy ring around a keyhole, open at one corner where a green
 * light shows it is on and local. Bold enough to read at 16 px.
 */
export function VaultMark({ className, intro }: { className?: string; intro?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className={cx("vault-mark", className, intro && "vault-mark-intro")}>
      <rect width="32" height="32" rx="7" fill="var(--ink)" />
      <path
        className="vault-ring"
        d="M19.7 7.25A9.5 9.5 0 1 0 24.75 12.3"
        pathLength={100}
        fill="none"
        stroke="var(--paper)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="16" cy="14" r="2.9" fill="var(--paper)" />
      <path d="M14.5 15.6h3l1.1 5.9h-5.2z" fill="var(--paper)" />
      <circle className="vault-led" cx="23.3" cy="8.7" r="2.1" fill="var(--green)" />
    </svg>
  );
}
