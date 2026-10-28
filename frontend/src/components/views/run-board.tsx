"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  allDocuments,
  atLeast,
  errorText,
  TERMINAL,
  vault,
  type AgentEvent,
  type EstimateCheck,
  type Job,
  type ProvidersResponse,
} from "@/lib/api";
import { clockTime, formatNumber, laneLabel, providerLabel, statusText } from "@/lib/format";
import {
  agentName,
  buildModel,
  describeEvent,
  docsPerMinute,
  eventTone,
  type EventTone,
  type LaneState,
  type RunModel,
} from "@/lib/run-model";
import { useLoad } from "@/lib/use-load";
import { useSession } from "../session";
import { TitleBlock } from "../title-block";
import { Button, cx, Empty, inputClass, LoadError, Meter, Notice, Tag } from "../ui";

export function RunBoardView() {
  const params = useSearchParams();
  const router = useRouter();
  const requested = Number(params.get("job")) || null;
  const jobs = useLoad("jobs", vault.jobs, 5000);
  const jobId = requested ?? jobs.data?.[0]?.id ?? null;

  return (
    <>
      <TitleBlock
        href="/run"
        title="Live run board"
        description="Follow documents through the coordinator, the security gate, each model lane and the reviewer as it happens."
        actions={
          jobs.data && jobs.data.length > 0 ? (
            <div className="flex items-center gap-2">
              <label htmlFor="run-pick" className="text-sm text-muted">
                Run
              </label>
              <select
                id="run-pick"
                className={cx(inputClass, "w-auto")}
                value={jobId ?? ""}
                onChange={(e) => router.replace(`/run?job=${e.target.value}`)}
              >
                {jobs.data.map((j) => (
                  <option key={j.id} value={j.id}>
                    Run {j.id}: {statusText(j.status).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
          ) : undefined
        }
      />
      <LoadError error={jobs.error} status={jobs.status} what="runs" />
      {jobs.data && jobs.data.length === 0 && !requested && (
        <Empty>
          There are no runs yet. Go to <Link href="/setup" className="text-blue underline">Set up a run</Link>, choose
          your model lanes and start one; it will appear here live.
        </Empty>
      )}
      {jobId !== null && <Board key={jobId} jobId={jobId} />}
    </>
  );
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** Poll the event stream once a second. Events loaded on first open do not animate; new ones do. */
function useEvents(jobId: number, terminal: boolean) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [liveFrom, setLiveFrom] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const terminalRef = useRef(terminal);
  useEffect(() => {
    terminalRef.current = terminal;
  }, [terminal]);

  useEffect(() => {
    let alive = true;
    let after = 0;
    let first = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let got = 0;
      try {
        for (;;) {
          const batch = await vault.events(jobId, after, 1000);
          if (!alive) return;
          if (batch.length) {
            after = batch[batch.length - 1].id;
            got += batch.length;
            setEvents((prev) => prev.concat(batch));
          }
          if (batch.length < 1000) break;
        }
        if (first) {
          setLiveFrom(after);
          first = false;
        }
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(errorText(e));
      }
      if (!alive) return;
      if (terminalRef.current && got === 0 && !first) return; // run is over and the stream is drained
      timer = setTimeout(tick, 1000);
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  return { events, liveFrom, error };
}

function Board({ jobId }: { jobId: number }) {
  const { me } = useSession();
  const [polledJob, setPolledJob] = useState<Job | undefined>(undefined);
  const terminal = !!polledJob && TERMINAL.includes(polledJob.status);
  const job = useLoad(
    `job:${jobId}`,
    () =>
      vault.job(jobId).then((j) => {
        setPolledJob(j);
        return j;
      }),
    terminal ? undefined : 1500,
  );

  const { events, liveFrom, error: evError } = useEvents(jobId, terminal);
  const providers = useLoad("providers", vault.providers);
  const collectionId = job.data?.collection_id;
  const docs = useLoad(collectionId ? `docs:${collectionId}` : null, () => allDocuments(collectionId!));
  const names = useMemo(() => new Map((docs.data ?? []).map((d) => [d.id, d.filename])), [docs.data]);
  const file = useCallback((id: number | null) => (id == null ? "a document" : (names.get(id) ?? `document ${id}`)), [names]);

  const model = useMemo(() => buildModel(job.data, events), [job.data, events]);
  const now = useNow(!terminal);
  const end = terminal ? (model.lastExtractTs ?? now) : now;
  const live = (id: number) => liveFrom !== null && id > liveFrom;

  if (job.error && !job.data) return <LoadError error={job.error} status={job.status} what={`run ${jobId}`} />;
  if (!job.data) return <p className="text-sm text-muted">Loading run {jobId}</p>;

  const allTimes = model.lanes.flatMap((l) => l.extractTimes).sort((a, b) => a - b);
  const overall = docsPerMinute(allTimes, end, terminal ? Infinity : 60);

  return (
    <div className="flex flex-col gap-5">
      <StatusStrip job={job.data} rate={overall} now={now} canCancel={atLeast(me, "analyst")} onChanged={job.reload} />
      {evError && <Notice>Live updates paused: {evError}. Retrying every second.</Notice>}

      <section
        aria-label="Pipeline"
        className="drafting-grid relative rounded-card border border-line p-3 sm:p-5"
      >
        <SheetCorner job={job.data} />
        <div className="flex flex-col items-stretch xl:flex-row">
          <Station
            title="Coordinator"
            role="Plans the run and hands documents to lanes"
            className="xl:w-40"
          >
            <CoordinatorBody job={job.data} model={model} />
          </Station>
          <Connector pulse={live(model.security.lastEventId) ? model.security.lastEventId : 0} />
          <Station title="Security gate" role="Screens every document before a model sees it" className="xl:w-[200px]">
            <SecurityBody model={model} file={file} live={live} />
          </Station>
          <Connector pulse={latestLaneEvent(model, live)} />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {model.lanes.length === 0 && (
              <div className="rounded-card border border-dashed border-line-strong bg-panel px-4 py-6 text-sm text-muted">
                Waiting for the coordinator to plan the lanes.
              </div>
            )}
            {model.lanes.map((l) => (
              <LaneTrack key={l.lane} lane={l} providers={providers.data} file={file} live={live} end={end} finished={terminal} />
            ))}
          </div>
          <Connector pulse={live(model.review.lastEventId) ? model.review.lastEventId : 0} />
          <Station title="Reviewer" role="Accepts, escalates or flags each result for a person" className="xl:w-[200px]">
            <ReviewerBody model={model} file={file} live={live} />
          </Station>
        </div>
      </section>

      <EventLog events={events} file={file} live={live} loading={liveFrom === null} />
    </div>
  );
}

function latestLaneEvent(model: RunModel, live: (id: number) => boolean): number {
  const id = Math.max(0, ...model.lanes.map((l) => l.lastEventId));
  return live(id) ? id : 0;
}

function SheetCorner({ job }: { job: Job }) {
  return (
    <p className="mb-3 text-xs text-muted">
      Pipeline for run {job.id}. Cells light up as results arrive; nothing moves unless an agent reports work.
    </p>
  );
}

function StatusStrip({
  job,
  rate,
  now,
  canCancel,
  onChanged,
}: {
  job: Job;
  rate: number | null;
  now: number;
  canCancel: boolean;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finished = job.done + job.failed;
  const running = !TERMINAL.includes(job.status);
  const started = job.started_at ?? job.created_at;
  const elapsed = Math.max(0, (job.finished_at ?? now) - started);
  const remaining = job.total - finished;
  const eta = running && rate && rate > 0 ? (remaining / rate) * 60 : null;

  return (
    <section aria-label="Run status" className="overflow-hidden rounded-card border border-line bg-panel shadow-panel">
      <div className="grid gap-px bg-line md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="bg-panel px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              aria-hidden
              className={cx(
                "h-2.5 w-2.5 rounded-full",
                running ? "bg-blue" : job.status === "completed" ? "bg-green" : "bg-amber",
              )}
            />
            <span className="text-lg font-semibold">Run {job.id}</span>
            <span className="text-sm text-muted">{statusText(job.status)}</span>
            {job.cancel_requested > 0 && running && <Tag tone="amber">Stopping after current documents</Tag>}
          </div>
          <div className="mt-3">
            <Meter value={finished} max={job.total} label="Run progress" tone={running ? "blue" : "green"} />
          </div>
          <p className="mt-2 text-sm text-muted">
            <span className="font-medium text-ink tabular-nums">{formatNumber(job.done)}</span> of{" "}
            {formatNumber(job.total)} documents done
            {job.failed > 0 && <span className="text-amber">, {formatNumber(job.failed)} failed</span>}.{" "}
            {formatDuration(elapsed)} {running ? "so far" : "in total"}
            {eta !== null && `, about ${formatDuration(eta)} left at this pace`}.
          </p>
          {job.estimate_check && <EstimateCheckLine check={job.estimate_check} />}
        </div>
        <div className="bg-panel px-4 py-3 md:min-w-44">
          <div className="text-xs text-muted">{running ? "Throughput, last minute" : "Average throughput"}</div>
          <div className="mt-0.5 text-3xl font-semibold tabular-nums">
            {rate === null ? <span className="text-muted">measuring</span> : rate.toFixed(1)}
          </div>
          <div className="text-xs text-muted">documents per minute</div>
        </div>
        <div className="flex flex-col justify-center gap-2 bg-panel px-4 py-3">
          {running && canCancel && !confirming && (
            <Button variant="danger" onClick={() => setConfirming(true)} disabled={job.cancel_requested > 0}>
              Cancel run
            </Button>
          )}
          {confirming && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="max-w-56">Stop this run? Documents already done keep their results.</p>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  busy={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await vault.cancelJob(job.id);
                      setConfirming(false);
                      onChanged();
                    } catch (e) {
                      setError(errorText(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Stop run
                </Button>
                <Button onClick={() => setConfirming(false)}>Keep running</Button>
              </div>
            </div>
          )}
          {!running && (
            <Link href="/investigate" className="text-sm font-medium text-blue underline-offset-4 hover:underline">
              Review the findings
            </Link>
          )}
          {running && !canCancel && <p className="max-w-48 text-xs text-muted">Analysts and admins can cancel a run.</p>}
          {error && <p className="max-w-56 text-xs text-amber">Couldn&apos;t cancel: {error}</p>}
        </div>
      </div>
    </section>
  );
}

function formatDuration(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

function Station({
  title,
  role,
  children,
  className,
}: {
  title: string;
  role: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={cx("min-w-0 shrink-0 self-stretch overflow-hidden rounded-card border border-line bg-panel shadow-panel xl:self-start", className)}>
      <header className="border-b border-line bg-raised/60 px-3.5 py-2.5">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="text-xs leading-snug text-muted">{role}</p>
      </header>
      <div className="px-3 py-3">{children}</div>
    </section>
  );
}

/** Flow line between stations. A dash travels along it only when a new event reaches the next stage. */
function Connector({ pulse }: { pulse: number }) {
  return (
    <div aria-hidden className="flex shrink-0 items-center justify-center py-1 text-line-strong xl:w-9 xl:self-start xl:pt-9 xl:py-0">
      <svg viewBox="0 0 36 12" className="hidden h-3 w-9 xl:block">
        <line x1="0" y1="6" x2="30" y2="6" stroke="currentColor" strokeWidth="1.2" />
        <path d="M29 2.5 35 6l-6 3.5z" fill="currentColor" />
        {pulse > 0 && (
          <line key={pulse} className="flow-pulse" x1="0" y1="6" x2="30" y2="6" stroke="var(--blue)" strokeWidth="2.4" strokeDasharray="6 18" />
        )}
      </svg>
      <svg viewBox="0 0 12 28" className="h-7 w-3 xl:hidden">
        <line x1="6" y1="0" x2="6" y2="22" stroke="currentColor" strokeWidth="1.2" />
        <path d="M2.5 21 6 27l3.5-6z" fill="currentColor" />
        {pulse > 0 && (
          <line key={pulse} className="flow-pulse" x1="6" y1="0" x2="6" y2="22" stroke="var(--blue)" strokeWidth="2.4" strokeDasharray="6 18" />
        )}
      </svg>
    </div>
  );
}

function Count({ value, label, tone, liveKey }: { value: ReactNode; label: string; tone?: string; liveKey?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-b-0">
      <span className="text-sm text-muted">{label}</span>
      <span key={liveKey} className={cx("text-lg font-semibold tabular-nums", liveKey ? "bump" : "", tone)}>
        {value}
      </span>
    </div>
  );
}

function CoordinatorBody({ job, model }: { job: Job; model: RunModel }) {
  const slots = model.lanes.filter((l) => !l.escalation).reduce((s, l) => s + l.slots, 0);
  return (
    <div>
      <Count label="Documents" value={formatNumber(job.total)} />
      <Count label="Lanes" value={model.lanes.filter((l) => !l.escalation && !l.blocked).length} />
      <Count label="Parallel slots" value={slots} />
      <Count label="Waiting" value={formatNumber(job.items.pending ?? 0)} />
      <p className="mt-2 text-xs text-muted">
        {model.finish
          ? "Run closed and totals reconciled."
          : model.planned
            ? "Lanes pull from shared queues, so faster lanes take more documents."
            : "Planning lanes."}
      </p>
    </div>
  );
}

function SecurityBody({
  model,
  file,
  live,
}: {
  model: RunModel;
  file: (id: number | null) => string;
  live: (id: number) => boolean;
}) {
  const s = model.security;
  const lastPin = s.pinned[s.pinned.length - 1];
  return (
    <div>
      <Count label="Screened" value={s.screened === null ? "..." : formatNumber(s.screened)} />
      <Count
        label="Pinned to local lanes"
        value={formatNumber(s.pinned.length)}
        tone="text-blue"
        liveKey={lastPin && live(lastPin.id) ? lastPin.id : undefined}
      />
      <Count label="Restricted markings" value={formatNumber(s.restricted)} />
      <Count label="Instruction-like text" value={formatNumber(s.injection)} tone={s.injection ? "text-amber" : undefined} />
      {s.blocked.length > 0 && <Count label="Blocked" value={formatNumber(s.blocked.length)} tone="text-redline" />}
      {s.pinned.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-muted">Kept on this machine</p>
          <ul className="mt-1 flex flex-col gap-1">
            {s.pinned.slice(-4).reverse().map((e) => {
              const markings = Array.isArray(e.detail.markings) ? (e.detail.markings as string[]) : [];
              const pii = Array.isArray(e.detail.pii) ? (e.detail.pii as string[]) : [];
              return (
                <li key={e.id} className={cx("min-w-0 text-xs", live(e.id) && "tick-in")}>
                  <span className="block truncate font-mono">{file(e.document_id)}</span>
                  <span className="text-muted">
                    {markings.length ? markings.join(", ") : pii.length ? `Personal data (${pii.join(", ")})` : "Sensitive content"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function LaneTrack({
  lane,
  providers,
  file,
  live,
  end,
  finished,
}: {
  lane: LaneState;
  providers: ProvidersResponse | undefined;
  file: (id: number | null) => string;
  live: (id: number) => boolean;
  end: number;
  finished: boolean;
}) {
  const info = providers?.providers.find((p) => p.name === lane.provider);
  const locality = lane.locality ?? info?.locality ?? null;
  const rate = docsPerMinute(lane.extractTimes, end, finished ? Infinity : 60);
  const dense = lane.slotStates.length > 8;
  return (
    <section
      aria-label={laneLabel(lane.lane)}
      className={cx("@container min-w-0 overflow-hidden rounded-card border bg-panel shadow-panel", lane.blocked ? "border-dashed border-line" : "border-accent/40")}
    >
      <header className="flex flex-col-reverse gap-2 border-b border-line bg-raised/60 px-3.5 py-2.5 @[320px]:flex-row @[320px]:items-start @[320px]:justify-between @[320px]:gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">
            {laneLabel(lane.lane)} <span className="font-normal">{providerLabel(lane.provider)}</span>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {locality && (
              <Tag tone={locality === "local" ? "green" : "amber"}>{locality === "local" ? "On this machine" : "Remote"}</Tag>
            )}
            <span>
              {lane.model ?? info?.model ?? "model pending"}, {lane.slots} {lane.slots === 1 ? "slot" : "slots"}
              {lane.escalation ? ", takes results the reviewer could not accept" : ""}
            </span>
          </div>
          {locality === "remote" && <p className="mt-1 text-xs text-amber">Document text leaves this machine on this lane.</p>}
        </div>
        <div className="flex shrink-0 items-baseline gap-1.5 @[320px]:block @[320px]:text-right">
          <div className="display text-2xl tabular-nums leading-none">{rate === null ? "..." : rate.toFixed(1)}</div>
          <div className="mt-1 text-xs text-muted">docs/min</div>
        </div>
      </header>
      {lane.blocked ? (
        <p className="px-3 py-3 text-sm text-redline">Not started: {lane.blocked}</p>
      ) : (
        <div className="px-3 py-3">
          <ol
            className={cx("grid gap-1.5", dense ? "grid-cols-[repeat(auto-fill,minmax(64px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(130px,1fr))]")}
          >
            {lane.slotStates.map((s, i) => {
              const hit = s.last && live(s.last.id);
              return (
                <li
                  key={s.last ? `${i}-${s.last.id}` : `${i}-idle`}
                  className={cx(
                    "min-w-0 rounded-control border px-2 py-1.5",
                    s.last ? "border-accent/40" : "border-dashed border-line",
                    hit ? "slot-hit" : s.last ? "bg-accent/10" : "bg-paper",
                  )}
                  title={s.last ? `${file(s.last.document_id)}: ${describeEvent(s.last, file)}` : undefined}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span>Slot {i + 1}</span>
                    {!dense && <span className="tabular-nums opacity-75">{s.count}</span>}
                  </div>
                  {!dense && (
                    <div className="mt-0.5 truncate font-mono text-xs">
                      {s.last ? file(s.last.document_id) : <span className="font-sans text-muted">Idle</span>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-xs text-muted">
            {formatNumber(lane.extracted)} read{lane.retries ? `, ${lane.retries} retries` : ""}
          </p>
        </div>
      )}
    </section>
  );
}

function ReviewerBody({
  model,
  file,
  live,
}: {
  model: RunModel;
  file: (id: number | null) => string;
  live: (id: number) => boolean;
}) {
  const r = model.review;
  const lastLive = live(r.lastEventId) ? r.lastEventId : undefined;
  return (
    <div>
      <Count label="Accepted" value={formatNumber(r.accepted)} tone="text-green" liveKey={lastLive} />
      <Count label="Escalated" value={formatNumber(r.escalated)} tone="text-blue" />
      <Count label="Needs a person" value={formatNumber(r.human)} tone={r.human ? "text-amber" : undefined} />
      {r.findings !== null && <Count label="Findings recorded" value={formatNumber(r.findings)} />}
      {r.recentHuman.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-muted">Waiting for a person</p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {r.recentHuman.slice(-3).reverse().map((e) => (
              <li key={e.id} className={cx("min-w-0 text-xs", live(e.id) && "tick-in")}>
                <span className="block truncate font-mono">{file(e.document_id)}</span>
                <span className="text-muted">
                  {Array.isArray(e.detail.reasons) ? String((e.detail.reasons as string[])[0] ?? "") : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const FILTERS: { id: string; label: string; test: (e: AgentEvent) => boolean }[] = [
  { id: "all", label: "Everything", test: () => true },
  { id: "security", label: "Security", test: (e) => e.agent === "security" },
  { id: "lanes", label: "Lanes", test: (e) => e.agent.startsWith("extractor:") },
  { id: "review", label: "Reviewer", test: (e) => e.agent === "reviewer" },
  { id: "problems", label: "Problems", test: (e) => e.outcome !== "allowed" },
];

const TONE_BAR: Record<EventTone, string> = {
  neutral: "bg-line",
  security: "bg-blue",
  problem: "bg-amber",
  denied: "bg-redline",
  good: "bg-green",
};

function EventLog({
  events,
  file,
  live,
  loading,
}: {
  events: AgentEvent[];
  file: (id: number | null) => string;
  live: (id: number) => boolean;
  loading: boolean;
}) {
  const [filter, setFilter] = useState("all");
  const test = FILTERS.find((f) => f.id === filter)!.test;
  const shown = events.filter(test).slice(-300).reverse();
  return (
    <section aria-label="Event log" className="overflow-hidden rounded-card border border-line bg-panel shadow-panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-[15px] font-semibold">What the agents are doing</h2>
        <div role="group" aria-label="Filter events" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cx(
                "rounded-control border px-2 py-0.5 text-xs",
                filter === f.id ? "border-ink bg-ink text-panel" : "border-line text-muted hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>
      <ol aria-live="polite" aria-relevant="additions" className="max-h-[420px] overflow-y-auto">
        {loading && <li className="px-4 py-3 text-sm text-muted">Loading events</li>}
        {!loading && shown.length === 0 && (
          <li className="px-4 py-3 text-sm text-muted">No events in this view yet. They appear here as the agents work.</li>
        )}
        {shown.map((e) => (
          <li
            key={e.id}
            className={cx(
              "grid grid-cols-[4px_4.5rem_minmax(0,1fr)] items-start gap-x-3 border-b border-line px-4 py-1.5 text-sm last:border-b-0 sm:grid-cols-[4px_4.5rem_6.5rem_minmax(0,1fr)]",
              live(e.id) && "tick-in",
            )}
          >
            <span aria-hidden className={cx("mt-1 h-3.5 w-1", TONE_BAR[eventTone(e)])} />
            <time className="tabular-nums text-muted">{clockTime(e.ts)}</time>
            <span className="hidden truncate text-muted sm:block">{agentName(e.agent)}</span>
            <span className="min-w-0 break-words">{describeEvent(e, file)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** F03.5: tell the user how far off the pre-run estimate was, so they know how much to trust the next one. */
function EstimateCheckLine({ check }: { check: EstimateCheck }) {
  const range = `${formatDuration(check.estimated_low_s)} to ${formatDuration(check.estimated_high_s)}`;
  const ratio = check.actual_vs_estimate;
  const verdict = check.within_range
    ? "within the estimate"
    : ratio !== null && ratio < 1
      ? `${(1 / ratio).toFixed(1)}x faster than estimated`
      : ratio !== null
        ? `${ratio.toFixed(1)}x slower than estimated`
        : "outside the estimate";
  return (
    <p className="mt-1 text-sm text-muted">
      Estimated {range} from a {check.sample_size}-document sample; this run was {verdict}.
      {check.estimated_workers !== check.job_workers &&
        ` The estimate assumed ${check.estimated_workers} parallel slots; this run used ${check.job_workers}.`}
    </p>
  );
}
