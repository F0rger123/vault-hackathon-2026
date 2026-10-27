"use client";

import { useState } from "react";
import { atLeast, errorText, vault, type AuditEntry } from "@/lib/api";
import { dateTime, formatNumber, humanize, providerLabel } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { useSession } from "../session";
import { TitleBlock } from "../title-block";
import { Button, cx, Empty, Figure, LoadError, Notice, Panel, Tag } from "../ui";

export function SecurityView() {
  const { me } = useSession();
  const isAdmin = atLeast(me, "admin");
  return (
    <>
      <TitleBlock
        href="/security"
        title="Security"
        description="Where document text may go, what the security agent caught, and every action recorded in the audit log."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <RemoteInference isAdmin={isAdmin} />
        <Summary />
      </div>
      <div className="mt-6">
        <AuditLog />
      </div>
    </>
  );
}

function RemoteInference({ isAdmin }: { isAdmin: boolean }) {
  const { me } = useSession();
  const providers = useLoad("providers", vault.providers);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = providers.data?.allow_remote_inference ?? false;
  const remote = (providers.data?.providers ?? []).filter((p) => p.locality === "remote");

  const set = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await vault.setRemote(enabled);
      setConfirming(false);
      providers.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Remote inference">
      <LoadError error={providers.error} status={providers.status} what="the remote inference setting" />
      {providers.data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className={cx("text-lg font-semibold", on ? "text-amber" : "text-green")}>{on ? "On" : "Off"}</p>
              <p className="mt-1 max-w-md text-sm text-muted">
                {on
                  ? "Runs may use remote lanes. Their users must still confirm each run, and marked or personal-data documents stay on local lanes."
                  : "No document text can leave this machine. Runs that ask for a remote model are refused and recorded as denied."}
              </p>
            </div>
            <button
              role="switch"
              aria-checked={on}
              aria-label="Allow remote inference"
              disabled={!isAdmin || busy}
              onClick={() => (on ? set(false) : setConfirming(true))}
              className={cx(
                "relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                on ? "border-amber bg-amber" : "border-line-strong bg-paper",
              )}
            >
              <span
                aria-hidden
                className={cx(
                  "absolute top-0.5 h-5 w-5 rounded-full transition-[left]",
                  on ? "left-6 bg-panel" : "left-0.5 bg-ink",
                )}
              />
            </button>
          </div>
          {confirming && (
            <Notice tone="warning" className="mt-4">
              <p className="font-medium">Turn remote inference on?</p>
              <p className="mt-1">
                Analysts will be able to start lanes that send text from unmarked documents to{" "}
                {remote.length ? remote.map((p) => providerLabel(p.name)).join(", ") : "remote providers"}. The change is
                recorded in the audit log.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="primary" busy={busy} onClick={() => set(true)}>
                  Turn on
                </Button>
                <Button onClick={() => setConfirming(false)}>Keep it off</Button>
              </div>
            </Notice>
          )}
          {error && <Notice className="mt-3">Couldn&apos;t change the setting: {error}</Notice>}
          <dl className="mt-4 grid grid-cols-[9rem_minmax(0,1fr)] border-t border-line text-sm">
            <dt className="border-b border-line py-2 text-muted">Who can change it</dt>
            <dd className="border-b border-line py-2">
              Administrators only. You are signed in as {me.username} ({me.role})
              {isAdmin ? ", so you can." : ", so you can't."}
            </dd>
            <dt className="border-b border-line py-2 text-muted">Remote models</dt>
            <dd className="border-b border-line py-2">
              {remote.length === 0
                ? "None configured"
                : remote.map((p) => (
                    <span key={p.name} className="block">
                      {providerLabel(p.name)}: {p.privacy}
                      {!p.available && ` Not available (${p.detail}).`}
                    </span>
                  ))}
            </dd>
          </dl>
        </>
      )}
    </Panel>
  );
}

const SENSITIVITY_TEXT: Record<string, string> = {
  none: "No markings",
  internal: "Internal",
  restricted: "Restricted",
};
const REVIEW_TEXT: Record<string, string> = {
  accepted: "Accepted by the reviewer",
  needs_human_review: "Waiting for a person",
  escalate: "Escalated",
  unreviewed: "Read before reviews existed",
};

function Summary() {
  const s = useLoad("security-summary", vault.securitySummary, 10000);
  const total = (s.data?.screenings ?? []).reduce((a, r) => a + r.n, 0);
  const local = (s.data?.screenings ?? []).filter((r) => r.route === "local_only").reduce((a, r) => a + r.n, 0);
  return (
    <Panel title="Screening and review">
      <LoadError error={s.error} status={s.status} what="the security summary" />
      {s.data && (
        <>
          <div className="grid grid-cols-2 gap-4 border-b border-line pb-4 sm:grid-cols-4">
            <Figure label="Screened" value={formatNumber(total)} />
            <Figure label="Kept local only" value={formatNumber(local)} />
            <Figure label="Instruction-like text" value={formatNumber(s.data.injection_flagged)} tone={s.data.injection_flagged ? "amber" : undefined} />
            <Figure label="Denied actions" value={formatNumber(s.data.denied_actions)} tone={s.data.denied_actions ? "red" : undefined} />
          </div>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="mb-1 text-sm font-semibold">Sensitivity</h3>
              <table className="w-full text-sm">
                <tbody>
                  {s.data.screenings.map((r) => (
                    <tr key={`${r.sensitivity}-${r.route}`} className="border-b border-line">
                      <td className="py-1.5">{SENSITIVITY_TEXT[r.sensitivity] ?? humanize(r.sensitivity)}</td>
                      <td className="py-1.5 text-muted">{r.route === "local_only" ? "local lanes only" : "any lane"}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">{formatNumber(r.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Review of the latest readings</h3>
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(s.data.review).map(([k, n]) => (
                    <tr key={k} className="border-b border-line">
                      <td className={cx("py-1.5", k === "needs_human_review" && "text-amber")}>{REVIEW_TEXT[k] ?? humanize(k)}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">{formatNumber(n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

function detailText(d: Record<string, unknown>): string {
  return Object.entries(d)
    .map(([k, v]) => `${humanize(k).toLowerCase()}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("; ");
}

function AuditLog() {
  const [outcome, setOutcome] = useState<"" | AuditEntry["outcome"]>("");
  const log = useLoad(`audit:${outcome}`, () => vault.audit(outcome || undefined), 10000);
  return (
    <Panel
      title="Audit log"
      aside={
        <div role="group" aria-label="Filter audit log" className="flex gap-1">
          {(
            [
              ["", "Everything"],
              ["denied", "Denied"],
              ["error", "Errors"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={outcome === id}
              onClick={() => setOutcome(id)}
              className={cx(
                "rounded-control border px-2 py-0.5 text-xs",
                outcome === id ? "border-ink bg-ink text-panel" : "border-line text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      }
      bodyClassName="p-0"
    >
      <div className="p-4 empty:hidden">
        {log.status === 403 ? (
          <Notice tone="denied">Only administrators can read the audit log.</Notice>
        ) : (
          <LoadError error={log.error} status={log.status} what="the audit log" />
        )}
        {log.data && log.data.length === 0 && (
          <Empty>{outcome === "denied" ? "No denied actions. Every request so far was allowed." : "No entries match this filter."}</Empty>
        )}
      </div>
      {log.data && log.data.length > 0 && (
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-line text-left text-xs font-medium text-muted">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Who</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Outcome</th>
                <th className="px-4 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {log.data.map((e) => (
                <tr key={e.id} className="border-b border-line align-top">
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted">{dateTime(e.ts)}</td>
                  <td className="px-4 py-2">{e.actor}</td>
                  <td className="px-4 py-2">
                    <span className="font-medium">{e.action}</span>
                    {e.target && <span className="block text-xs text-muted">{e.target}</span>}
                  </td>
                  <td className="px-4 py-2">
                    <Tag tone={e.outcome === "denied" ? "red" : e.outcome === "error" ? "amber" : "neutral"}>
                      {humanize(e.outcome)}
                    </Tag>
                  </td>
                  <td className="max-w-md break-words px-4 py-2 text-xs text-muted">{detailText(e.detail) || "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
