"use client";

// Initial dashboard scaffold (F10). Franco owns the UI from here; this page proves the
// end-to-end wiring: token sign-in, stats, provider privacy status, jobs and findings.

import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  getToken,
  setToken,
  type Collection,
  type Finding,
  type Job,
  type Me,
  type ProvidersResponse,
  type Stats,
} from "@/lib/api";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="mx-auto mt-24 w-full max-w-sm rounded-lg border border-line bg-panel p-6"
      onSubmit={(e) => {
        e.preventDefault();
        setToken(value.trim());
        onDone();
      }}
    >
      <h1 className="text-lg font-semibold">Sign in to VAULT</h1>
      <p className="mt-1 text-sm text-muted">Paste an API token issued by your administrator.</p>
      <label htmlFor="token" className="mt-4 block text-sm">
        API token
      </label>
      <input
        id="token"
        type="password"
        autoComplete="off"
        className="mt-1 w-full rounded border border-line bg-canvas px-3 py-2 font-mono text-sm"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
      />
      <button className="mt-4 w-full rounded bg-accent px-3 py-2 text-sm font-medium text-white">Sign in</button>
    </form>
  );
}

export default function Dashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);

  const load = useCallback(async () => {
    if (!getToken()) {
      setNeedsToken(true);
      return;
    }
    try {
      const [m, s, p, c, j] = await Promise.all([
        api<Me>("/me"),
        api<Stats>("/stats"),
        api<ProvidersResponse>("/system/providers"),
        api<Collection[]>("/collections"),
        api<Job[]>("/jobs"),
      ]);
      setMe(m);
      setStats(s);
      setProviders(p);
      setCollections(c);
      setJobs(j);
      const f = await Promise.all(c.map((col) => api<Finding[]>(`/collections/${col.id}/findings`)));
      setFindings(f.flat());
      setError(null);
      setNeedsToken(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setToken(null);
        setNeedsToken(true);
      } else {
        setError(e instanceof Error ? e.message : "request failed");
      }
    }
  }, []);

  useEffect(() => {
    // Initial load and polling are the external-system sync this effect exists for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  if (needsToken) return <SignIn onDone={load} />;

  const active = providers?.providers.find((p) => p.name === providers.default);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">VAULT</h1>
          <p className="text-sm text-muted">Private document intelligence</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {active && (
            <span
              className={`rounded-full px-3 py-1 font-medium ${
                active.locality === "local" ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"
              }`}
              title={active.privacy}
            >
              {active.locality === "local" ? "Local processing" : "Remote processing"} · {active.model}
            </span>
          )}
          {me && (
            <span className="text-muted">
              {me.username} ({me.role})
            </span>
          )}
          <button
            className="rounded border border-line px-2 py-1 text-muted hover:text-fg"
            onClick={() => {
              setToken(null);
              setNeedsToken(true);
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="mt-4 rounded border border-bad/40 bg-bad/10 px-4 py-2 text-sm text-bad">
          {error}
        </div>
      )}

      {stats && (
        <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Collection statistics">
          <Stat label="Documents" value={stats.documents} />
          <Stat label="Processed" value={stats.processed} />
          <Stat label="Findings" value={stats.findings} />
          <Stat label="Stored" value={formatBytes(stats.bytes)} />
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Findings</h2>
          <ul className="mt-2 space-y-3">
            {findings.length === 0 && <li className="text-sm text-muted">No cross-document findings yet.</li>}
            {findings.map((f) => (
              <li key={f.id} className="rounded-lg border border-line bg-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{f.summary}</p>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-xs ${
                      f.status === "verified" ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"
                    }`}
                  >
                    {f.status === "verified" ? "Evidence verified" : "Needs review"}
                  </span>
                </div>
                <ul className="mt-3 space-y-1 font-mono text-xs text-muted">
                  {f.evidence.map((e, i) => (
                    <li key={i}>
                      <span className="text-fg">{e.filename}</span> p{e.page}: {e.quote}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        <aside className="space-y-6">
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Collections</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {collections.map((c) => (
                <li key={c.id} className="rounded border border-line bg-panel px-3 py-2">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-muted">
                    {c.documents} docs · {c.processed ?? 0} processed · {formatBytes(c.bytes)}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Jobs</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {jobs.slice(0, 6).map((j) => (
                <li key={j.id} className="rounded border border-line bg-panel px-3 py-2">
                  <div className="flex justify-between">
                    <span>
                      #{j.id} · {j.params.provider}
                    </span>
                    <span className="text-muted">{j.status}</span>
                  </div>
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded bg-line"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={j.total}
                    aria-valuenow={j.done}
                  >
                    <div className="h-full bg-accent" style={{ width: `${j.total ? (100 * j.done) / j.total : 0}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {j.done}/{j.total} done{j.failed ? ` · ${j.failed} failed` : ""} · {j.workers} workers
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}
