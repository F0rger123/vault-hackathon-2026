"use client";

import type { ReactNode } from "react";
import { useSession } from "./session";

/**
 * Page header: an expanded title with one line of context, the collection in view, and the page's actions.
 * `href` is kept so callers stay unchanged; the header no longer prints a sheet number.
 */
export function TitleBlock({
  title,
  description,
  actions,
  collectionLabel,
}: {
  title: string;
  description?: ReactNode;
  href: string;
  actions?: ReactNode;
  collectionLabel?: string;
}) {
  const { collection } = useSession();
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0 max-w-3xl">
        <p className="mb-2 flex items-center gap-2 text-[13px] text-muted">
          <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z" strokeLinejoin="round" />
          </svg>
          <span className="truncate">{collectionLabel ?? collection?.name ?? "No collection selected"}</span>
        </p>
        <h1 className="display text-balance text-[29px] leading-[1.1] sm:text-[35px]">{title}</h1>
        {description && <div className="mt-2 text-[15px] leading-relaxed text-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
