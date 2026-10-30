"use client";

import Link from "next/link";
import { TERMINAL, vault, type Job, type ProvidersResponse } from "@/lib/api";
import { formatBytes, formatNumber, laneLabel, providerLabel, statusText, timeAgo } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { GettingStarted, LocalModelsCard } from "../first-run";
import { ModelInstaller } from "../model-installer";
import { FindingRedline } from "../finding-redline";
import { useSession } from "../session";
import { TitleBlock } from "../title-block";
import { cx, Empty, Figure, LoadError, Meter, Panel, Tag } from "../ui";

export function OverviewView() {
  const { collection, stats } = useSession();
  const providers = useLoad("providers", vault.providers, 15000);
  const localModels = useLoad("local-models", vault.localModels, 30000);
  const all = useLoad("jobs", vault.jobs, 3000);
  const jobs = { ...all, data: all.data?.filter((j) => j.kind === "process") };
  const findings = useLoad(collection ? `findings:${collection.id}` : null, () => vault.findings(collection!.id), 15000);

  const active = (jobs.data ?? []).filter((j) => !TERMINAL.includes(j.status));
  const recent = (jobs.data ?? []).filter((j) => TERMINAL.includes(j.status)).slice(0, 3);
  const latest = [...(findings.data ?? [])].sort((a, b) => b.created_at - a.created_at).slice(0, 3);

  return (
    <>
      <TitleBlock
        href="/"
        title="Overview"
        description="What is in this vault, where its documents can go, and what the agents have found."
      />

      <GettingStarted />

      <section aria-label="Collection figures" className="mb-8 overflow-hidden rounded-card border border-line bg-panel shadow-panel">
        <div className="grid grid-cols-2 divide-line sm:grid-cols-4 xl:grid-cols-7 xl:divide-x">
          {([
            ["Documents", stats ? formatNumber(stats.documents) : undefined],
            ["Processed", stats ? formatNumber(stats.processed) : undefined],
            ["Pages", stats ? formatNumber(stats.pages) : undefined],
            ["Stored", stats ? formatBytes(stats.bytes) : undefined],
            ["Findings", stats ? formatNumber(stats.findings) : undefined],
            ["Active runs", stats ? formatNumber(stats.jobs_active) : undefined],
            ["Waiting for approval", stats ? formatNumber(stats.proposals_pending) : undefined],
          ] as [string, string | undefined][]).map(([label, value]) => (
            <div key={label} className={cx("px-5 py-4", label === "Findings" && stats?.findings ? "text-redline" : "")}>
              <Figure label={label} value={value} />
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel
            title="Runs"
            aside={
              <Link href="/setup" className="text-blue underline-offset-4 hover:underline">
                Set up a run
              </Link>
            }
          >
            <LoadError error={jobs.error} status={jobs.status} what="runs" />
            {jobs.data && active.length === 0 && (
              <Empty>
                No runs in progress. Go to <Link href="/setup" className="text-blue underline">Set up a run</Link> to
                process this collection.
              </Empty>
            )}
            <ul className="flex flex-col gap-4">
              {active.map((j) => (
                <RunRow key={j.id} job={j} />
              ))}
            </ul>
            {recent.length > 0 && (
              <>
                <h3 className="mt-6 mb-2 text-[13px] font-medium text-muted">Finished recently</h3>
                <ul className="border-t border-line text-sm">
                  {recent.map((j) => (
                    <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2.5 last:border-b-0">
                      <Link href={`/run?job=${j.id}`} className="font-medium text-blue underline-offset-4 hover:underline">
                        Run {j.id}
                      </Link>
                      <span className="text-muted">
                        {statusText(j.status)}, {formatNumber(j.done)} of {formatNumber(j.total)} documents
                        {j.finished_at ? `, ${timeAgo(j.finished_at)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel
            title="Latest findings"
            aside={
              <Link href="/investigate" className="text-blue underline-offset-4 hover:underline">
                See all findings
              </Link>
            }
          >
            <LoadError error={findings.error} status={findings.status} what="findings" />
            {findings.data && latest.length === 0 && (
              <Empty>No findings yet. Findings appear after a run cross-checks the collection.</Empty>
            )}
            <div className="flex flex-col gap-3">
              {latest.map((f) => (
                <FindingRedline key={f.id} finding={f} compact />
              ))}
            </div>
          </Panel>
        </div>

        <PrivacyPosture data={providers.data} error={providers.error} status={providers.status} />
      </div>

      <details className="group mt-8 overflow-hidden rounded-card border border-line bg-panel shadow-panel">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-[15px] font-semibold">
          This computer and its AI models
          <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 text-muted transition-transform duration-300 group-open:rotate-180">
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </summary>
        <div className="reveal border-t border-line p-5">
          <LocalModelsCard data={localModels.data} compact />
          {localModels.data?.reachable && <ModelInstaller />}
        </div>
      </details>
    </>
  );
}

function RunRow({ job }: { job: Job }) {
  const lanes = job.params.lanes ?? (job.params.provider ? [{ provider: job.params.provider, concurrency: job.workers }] : []);
  const finished = job.done + job.failed;
  return (
    <li className="rounded-card border border-accent/30 bg-raised px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden className="live-dot h-2 w-2 rounded-full bg-accent text-accent" />
          <span className="display text-[17px]">Run {job.id}</span>
          <span className="text-sm text-muted">{statusText(job.status)}</span>
        </div>
        <Link
          href={`/run?job=${job.id}`}
          className="rounded-control border border-accent bg-accent px-3.5 py-1.5 text-sm font-semibold text-on-accent hover:brightness-110"
        >
          Open the live board
        </Link>
      </div>
      <div className="mt-3">
        <Meter value={finished} max={job.total} label={`Run ${job.id} progress`} />
      </div>
      <p className="mt-2 text-sm text-muted">
        {formatNumber(job.done)} of {formatNumber(job.total)} documents done
        {job.failed ? `, ${formatNumber(job.failed)} failed` : ""}.{" "}
        {lanes.map((l, i) => `${laneLabel(`x#${i + 1}`)}: ${providerLabel(l.provider)}, ${l.concurrency} slots`).join("; ")}
      </p>
    </li>
  );
}

function PrivacyPosture({
  data,
  error,
  status,
}: {
  data: ProvidersResponse | undefined;
  error: string | null;
  status: number | null;
}) {
  return (
    <Panel title="Privacy posture" className="self-start">
      <LoadError error={error} status={status} what="model providers" />
      {data && (
        <>
          <div className={cx("-mx-5 -mt-5 mb-1 border-b border-line px-5 py-4", data.allow_remote_inference ? "bg-amber/10" : "bg-green/10")}>
            {data.allow_remote_inference ? (
              <>
                <p className="display text-[17px] text-amber">Remote inference is on</p>
                <p className="mt-1 text-sm text-muted">
                  Lanes that use a remote model send document text off this machine. Documents with markings or
                  personal data still stay on local models.
                </p>
              </>
            ) : (
              <>
                <p className="display text-[17px] text-green">Remote inference is off</p>
                <p className="mt-1 text-sm text-muted">
                  Every document is read on this machine. Only an administrator can turn remote models on, on the
                  Security sheet.
                </p>
              </>
            )}
          </div>
          <ul className="flex flex-col">
            {data.providers.map((p) => (
              <li key={p.name} className="border-b border-line py-3 last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{providerLabel(p.name)}</span>
                  <span className="flex gap-1.5">
                    {p.locality && (
                      <Tag tone={p.locality === "local" ? "green" : "amber"}>
                        {p.locality === "local" ? "On this machine" : "Remote"}
                      </Tag>
                    )}
                    {!p.available && <Tag>Not available</Tag>}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {p.privacy ?? p.detail}
                  {p.name === data.default && " This is the default model."}
                </p>
                {!p.available && <p className="mt-1 text-xs text-muted">Why: {p.detail}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
