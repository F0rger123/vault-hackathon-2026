"use client";

import type { ReactNode } from "react";
import { SHEET_COUNT, sheetNumber } from "./app-shell";
import { useSession } from "./session";

/**
 * Page header drawn as an engineering drawing title block: a thin ruled box with
 * the sheet name, the collection in view, the signed-in user and the sheet number.
 */
export function TitleBlock({
  title,
  description,
  href,
  actions,
  collectionLabel,
}: {
  title: string;
  description?: ReactNode;
  href: string;
  actions?: ReactNode;
  collectionLabel?: string;
}) {
  const { me, collection } = useSession();
  const sheet = sheetNumber(href);
  return (
    <header className="mb-6 border border-line-strong bg-panel">
      <div className="grid grid-cols-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-line-strong px-4 py-3 md:col-span-1 md:border-b-0 md:border-r">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight sm:text-2xl">{title}</h1>
            {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        <Cell label="Collection" className="border-r border-line-strong">
          {collectionLabel ?? collection?.name ?? "None selected"}
        </Cell>
        <Cell label="Signed in as" className="md:border-r md:border-line-strong">
          {me.username} <span className="text-muted">({me.role})</span>
        </Cell>
        <Cell label="Sheet" className="col-span-2 border-t border-line-strong md:col-span-1 md:border-t-0">
          {sheet > 0 ? `${sheet} of ${SHEET_COUNT}` : "Detail"}
        </Cell>
      </div>
    </header>
  );
}

function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 px-4 py-2 md:max-w-64 md:py-3 ${className ?? ""}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium">{children}</div>
    </div>
  );
}
