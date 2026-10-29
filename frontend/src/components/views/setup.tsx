"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  allDocuments,
  ApiError,
  atLeast,
  errorText,
  vault,
  type Capacity,
  type DocumentRow,
  type Example,
  type ProviderInfo,
  type ProviderName,
  type ProvidersResponse,
  type UploadResult,
} from "@/lib/api";
import { dateTime, formatMb, formatNumber, humanize, providerLabel } from "@/lib/format";
import { useLoad, type Loaded } from "@/lib/use-load";
import { useSession } from "../session";
import { LocalModelsCard, QuickStart } from "../first-run";
import { TitleBlock } from "../title-block";
import { Button, cx, Empty, Field, inputClass, LoadError, Notice, Panel, Tag } from "../ui";

function Step({ n, title, intro, children, last }: { n: number; title: string; intro: ReactNode; children: ReactNode; last?: boolean }) {
  return (
    <section aria-labelledby={`step-${n}`} className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3 sm:grid-cols-[40px_minmax(0,1fr)] sm:gap-x-4">
      <div className="flex flex-col items-center">
        <span className="grid h-8 w-8 place-items-center rounded-full border border-accent/50 bg-accent/10 text-accent text-sm font-semibold tabular-nums sm:h-10 sm:w-10 sm:text-base">
          {n}
        </span>
        {!last && <span aria-hidden className="w-px flex-1 bg-line-strong" />}
      </div>
      <div className={cx("min-w-0", !last && "pb-8")}>
        <h2 id={`step-${n}`} className="pt-1 text-lg font-semibold sm:pt-2">
          {title}
        </h2>
        <p className="mb-3 mt-1 max-w-3xl text-sm text-muted">{intro}</p>
        {children}
      </div>
    </section>
  );
}

export function SetupView() {
  const { collection, me } = useSession();
  const providers = useLoad("providers", vault.providers, 15000);
  const docs = useLoad(collection ? `docs:${collection.id}` : null, () => allDocuments(collection!.id));
  const caps = useCapacities(providers.data?.providers);
  const localModels = useLoad("local-models", vault.localModels, 30000);
  const [advanced, setAdvanced] = useState(false);

  return (
    <>
      <TitleBlock
        href="/setup"
        title="Set up a run"
        description="Add your files and press one button. Everything else on this page is optional fine-tuning."
      />
      {!collection ? (
        <NewCollection />
      ) : (
        <div className="flex flex-col">
          <Library collectionId={collection.id} canUpload={atLeast(me, "analyst")} onUploaded={docs.reload} />
          {atLeast(me, "analyst") && <QuickStart collectionId={collection.id} documents={collection.documents} />}
          <Panel title="This computer" className="mb-6">
            <LocalModelsCard data={localModels.data} />
          </Panel>
          <details className="group" open={advanced} onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}>
            <summary className="mb-6 cursor-pointer select-none text-sm font-medium text-muted hover:text-ink">
              More options: teach by example, measure this computer, choose model lanes
            </summary>
          <Step
            n={1}
            title="Teach by example"
            intro="Label a few documents the way you want them read. VAULT shows these examples to the model alongside each document as guidance. This does not retrain the model, and you can change an example at any time."
          >
            <TeachByExample docs={docs.data} docsError={docs.error} canEdit={atLeast(me, "analyst")} />
          </Step>
          <Step
            n={2}
            title="Check this machine"
            intro="How much work this computer can take at once. The hardware ceiling is an estimate; a measurement runs real stored documents at increasing parallelism and keeps the fastest setting."
          >
            <MachineCheck providers={providers.data} caps={caps} canCalibrate={atLeast(me, "admin")} />
          </Step>
          <LaneAndStart providers={providers.data} providersError={providers.error} collectionId={collection.id} caps={caps} />
          </details>
        </div>
      )}
    </>
  );
}

/** First step in Real mode, or whenever the current mode has no collection yet (F10.11). */
function NewCollection() {
  const { me, mode, setCollectionId, refresh } = useSession();
  const [name, setName] = useState(mode === "demo" ? "Demo collection" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!atLeast(me, "analyst"))
    return <Empty>There is no {mode} collection yet. Ask an analyst or administrator to create one.</Empty>;
  return (
    <Panel title={mode === "demo" ? "Create a demo collection" : "Create your first collection"} className="max-w-xl">
      <p className="mb-3 text-sm text-muted">
        {mode === "demo"
          ? "Demo collections hold fictional files, such as data/synthetic/v2/files from this repository."
          : "A collection is one archive, for example one client or one site. Its files stay on this computer."}
      </p>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const c = await vault.createCollection(name.trim(), mode === "demo");
            setCollectionId(c.id);
            refresh();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Collection name" htmlFor="new-collection">
          <input
            id="new-collection"
            className={inputClass}
            value={name}
            maxLength={80}
            pattern="[A-Za-z0-9 ._\-]+"
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" busy={busy}>
          Create collection
        </Button>
      </form>
      {error && <Notice className="mt-3">{error}</Notice>}
    </Panel>
  );
}

function Library({ collectionId, canUpload, onUploaded }: { collectionId: number; canUpload: boolean; onUploaded: () => void }) {
  const { collection, refresh } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Panel title="Files in this collection" className="mb-8" aside={collection && `${formatNumber(collection.documents)} documents, ${formatNumber(collection.processed ?? 0)} processed`}>
      {canUpload ? (
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!files.length) return;
            setBusy(true);
            setError(null);
            setResult(null);
            try {
              const r = await vault.upload(collectionId, files);
              setResult(r);
              setFiles([]);
              if (input.current) input.current.value = "";
              refresh();
              onUploaded();
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="min-w-0 flex-1">
            {/* The whole area is the file input's label, so a click or a drop both work; the input stays
                reachable by keyboard and by its "Add files" label. */}
            <label
              htmlFor="upload"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                setFiles(Array.from(e.dataTransfer.files));
              }}
              className={cx(
                "flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-card border border-dashed px-4 py-4 text-center text-sm transition-colors duration-150",
                dragging ? "border-accent bg-accent/10" : "border-line-strong hover:border-muted hover:bg-raised/40",
              )}
            >
              <span className="font-medium">
                {files.length
                  ? `${files.length} ${files.length === 1 ? "file" : "files"} ready: ${files
                      .slice(0, 3)
                      .map((f) => f.name)
                      .join(", ")}${files.length > 3 ? "…" : ""}`
                  : "Drop files here, or click to choose"}
              </span>
              <span className="text-xs text-muted">
                PDF, text, CSV and images. Each file is checked before it is stored; originals are kept as they are.
              </span>
            </label>
            <input
              ref={input}
              id="upload"
              type="file"
              multiple
              aria-label="Add files"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="sr-only"
            />
          </div>
          <Button type="submit" variant="secondary" busy={busy} disabled={!files.length} className="sm:mb-6">
            {busy ? "Uploading" : files.length ? `Upload ${files.length} ${files.length === 1 ? "file" : "files"}` : "Upload"}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted">Viewers can read the collection. Analysts and admins can add files.</p>
      )}
      {error && <Notice className="mt-3">Upload failed: {error}</Notice>}
      {result && (
        <div className="mt-3 text-sm">
          <p>
            Stored {result.accepted.filter((a) => !a.duplicate).length} new{" "}
            {result.accepted.filter((a) => !a.duplicate).length === 1 ? "file" : "files"}
            {result.accepted.some((a) => a.duplicate) &&
              `; ${result.accepted.filter((a) => a.duplicate).length} were already in the vault`}
            .
          </p>
          {result.rejected.length > 0 && (
            <Notice tone="denied" className="mt-2">
              <p className="font-medium">Not accepted:</p>
              <ul className="mt-1">
                {result.rejected.map((r) => (
                  <li key={r.filename}>
                    <span className="font-mono text-[13px]">{r.filename}</span>: {r.reason}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
      )}
    </Panel>
  );
}

type Labels = Record<"doc_type" | "project" | "doc_date" | "title", string>;
const EMPTY_LABELS: Labels = { doc_type: "", project: "", doc_date: "", title: "" };

function TeachByExample({ docs, docsError, canEdit }: { docs: DocumentRow[] | undefined; docsError: string | null; canEdit: boolean }) {
  const examples = useLoad("examples", vault.examples);
  const vocab = useLoad("vocab", () => vault.search({ q: "", limit: "200" }));
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<DocumentRow | null>(null);
  const [labels, setLabels] = useState<Labels>(EMPTY_LABELS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const types = useMemo(
    () => [...new Set((vocab.data?.results ?? []).map((r) => r.doc_type).filter(Boolean) as string[])].sort(),
    [vocab.data],
  );
  const projects = useMemo(
    () => [...new Set((vocab.data?.results ?? []).map((r) => r.project).filter(Boolean) as string[])].sort(),
    [vocab.data],
  );
  const exampleIds = new Set((examples.data ?? []).map((e) => e.document_id));
  const matches = (docs ?? []).filter((d) => d.filename.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 40);

  const pick = async (d: DocumentRow) => {
    setPicked(d);
    setMessage(null);
    const existing = examples.data?.find((e) => e.document_id === d.id);
    if (existing) {
      setLabels({ ...EMPTY_LABELS, ...Object.fromEntries(Object.entries(existing.labels).map(([k, v]) => [k, v == null ? "" : String(v)])) });
      return;
    }
    setLabels(EMPTY_LABELS);
    try {
      const detail = await vault.document(d.id);
      const x = detail.extraction?.data;
      if (x)
        setLabels({
          doc_type: x.doc_type ?? "",
          project: x.project ?? "",
          doc_date: x.doc_date ?? "",
          title: x.title ?? "",
        });
    } catch {
      /* prefill is a convenience only */
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel title="Label a document">
        {!canEdit && <Notice tone="info" className="mb-3">Viewers can see examples. Analysts and admins can add them.</Notice>}
        {docsError && <Notice className="mb-3">Couldn&apos;t load the document list: {docsError}</Notice>}
        <Field label="Find a document" htmlFor="doc-find">
          <input
            id="doc-find"
            className={inputClass}
            placeholder="Type part of a file name, for example DWG"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <ul aria-label="Matching documents" className="mt-2 max-h-48 overflow-y-auto rounded-control border border-line">
          {docs && matches.length === 0 && <li className="px-3 py-2 text-sm text-muted">No file names match.</li>}
          {!docs && !docsError && <li className="px-3 py-2 text-sm text-muted">Loading documents</li>}
          {matches.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => pick(d)}
                aria-pressed={picked?.id === d.id}
                className={cx(
                  "flex w-full items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-left text-sm last:border-b-0",
                  picked?.id === d.id ? "bg-blue/10" : "hover:bg-paper",
                )}
              >
                <span className="truncate font-mono text-[13px]">{d.filename}</span>
                {exampleIds.has(d.id) && <Tag tone="blue">Example</Tag>}
              </button>
            </li>
          ))}
        </ul>

        {picked && (
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMessage(null);
              try {
                const body = Object.fromEntries(Object.entries(labels).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim()]));
                await vault.addExample(picked.id, body);
                setMessage({ tone: "ok", text: `Saved ${picked.filename} as an example. The next run will use it.` });
                examples.reload();
              } catch (err) {
                setMessage({ tone: "error", text: errorText(err) });
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="text-sm sm:col-span-2">
              Correct values for <span className="font-mono text-[13px]">{picked.filename}</span>. Filled in from the
              last reading where available; fix anything that is wrong.
            </p>
            <Field label="Document type" htmlFor="l-type">
              <input id="l-type" list="types" className={inputClass} value={labels.doc_type} onChange={(e) => setLabels({ ...labels, doc_type: e.target.value })} disabled={!canEdit} />
              <datalist id="types">
                {types.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </datalist>
            </Field>
            <Field label="Project" htmlFor="l-project">
              <input id="l-project" list="projects" className={inputClass} value={labels.project} onChange={(e) => setLabels({ ...labels, project: e.target.value })} disabled={!canEdit} />
              <datalist id="projects">
                {projects.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>
            <Field label="Document date" htmlFor="l-date" hint="Year, month, day, for example 2023-07-14">
              <input id="l-date" className={inputClass} pattern="\d{4}-\d{2}-\d{2}" value={labels.doc_date} onChange={(e) => setLabels({ ...labels, doc_date: e.target.value })} disabled={!canEdit} />
            </Field>
            <Field label="Title" htmlFor="l-title">
              <input id="l-title" className={inputClass} value={labels.title} onChange={(e) => setLabels({ ...labels, title: e.target.value })} disabled={!canEdit} />
            </Field>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <Button type="submit" variant="primary" busy={busy} disabled={!canEdit || (!labels.doc_type && !labels.project && !labels.doc_date && !labels.title)}>
                Save as example
              </Button>
              {message && (
                <span role="status" className={cx("text-sm", message.tone === "ok" ? "text-green" : "text-amber")}>
                  {message.text}
                </span>
              )}
            </div>
          </form>
        )}
      </Panel>

      <Panel title="Saved examples" aside={examples.data && `${examples.data.length} saved`}>
        <LoadError error={examples.error} status={examples.status} what="examples" />
        {examples.data && examples.data.length === 0 && (
          <Empty>No examples yet. Pick a document on the left, check its labels and save it. Two or three per document type is plenty.</Empty>
        )}
        {examples.data && examples.data.length > 0 && <ExampleTable examples={examples.data} />}
      </Panel>
    </div>
  );
}

function ExampleTable({ examples }: { examples: Example[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-medium text-muted">
            <th className="py-1.5 pr-3 font-medium">Document</th>
            <th className="py-1.5 pr-3 font-medium">Type</th>
            <th className="py-1.5 pr-3 font-medium">Project</th>
            <th className="py-1.5 font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {examples.map((e) => (
            <tr key={e.document_id} className="border-b border-line">
              <td className="py-1.5 pr-3 font-mono text-[13px]">{e.filename}</td>
              <td className="py-1.5 pr-3">{e.labels.doc_type ? humanize(String(e.labels.doc_type)) : "None"}</td>
              <td className="py-1.5 pr-3">{e.labels.project ?? "None"}</td>
              <td className="py-1.5 tabular-nums">{e.labels.doc_date ?? "None"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useCapacities(providers: ProviderInfo[] | undefined) {
  const names = (providers ?? []).map((p) => p.name);
  return useLoad(names.length ? `cap:${names.join(",")}` : null, async () => {
    const out: Partial<Record<ProviderName, Capacity | string>> = {};
    await Promise.all(
      names.map(async (n) => {
        try {
          out[n] = await vault.capacity(n);
        } catch (e) {
          out[n] = errorText(e);
        }
      }),
    );
    return out;
  });
}

type Caps = Loaded<Partial<Record<ProviderName, Capacity | string>>>;

function MachineCheck({ providers, caps, canCalibrate }: { providers: ProvidersResponse | undefined; caps: Caps; canCalibrate: boolean }) {
  const hw = useLoad("hardware", vault.hardware);
  const [running, setRunning] = useState<ProviderName | null>(null);
  const [calError, setCalError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Hardware">
        <LoadError error={hw.error} status={hw.status} what="hardware details" />
        {hw.data && (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Graphics</dt>
              <dd className="font-medium">
                {hw.data.gpus.length
                  ? hw.data.gpus.map((g) => `${g.name}, ${formatMb(g.memory_mb)}`).join("; ")
                  : "No supported GPU found; models run on the processor"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Memory</dt>
              <dd className="font-medium tabular-nums">
                {formatMb(hw.data.ram_total_mb)} total, {formatMb(hw.data.ram_available_mb)} free
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Processor</dt>
              <dd className="font-medium tabular-nums">
                {hw.data.physical_cores} cores, {hw.data.logical_cores} threads
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">System</dt>
              <dd className="font-medium">
                {hw.data.os}, {formatMb(hw.data.disk_free_mb)} disk free
              </dd>
            </div>
          </dl>
        )}
      </Panel>

      <div className="overflow-x-auto rounded-card border border-line bg-panel shadow-panel">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium text-muted">
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-4 py-2 font-medium">Hardware ceiling</th>
              <th className="px-4 py-2 font-medium">Last measurement</th>
              <th className="px-4 py-2 font-medium">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(providers?.providers ?? []).map((p) => {
              const cap = caps.data?.[p.name];
              const c = typeof cap === "object" ? cap : null;
              const cal = c?.calibration;
              return (
                <tr key={p.name} className="border-b border-line align-top last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{providerLabel(p.name)}</div>
                    <div className="text-xs text-muted">
                      {p.model ?? p.name}
                      {p.locality === "remote" ? ", remote" : ", on this machine"}
                      {!p.available && `, not available (${p.detail})`}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {typeof cap === "string" ? (
                      <span className="text-amber">{cap}</span>
                    ) : c ? (
                      <>
                        <div className="font-semibold tabular-nums">{c.static_ceiling} at once</div>
                        <div className="max-w-64 text-xs text-muted">{c.reason}</div>
                      </>
                    ) : (
                      <span className="text-muted">Checking</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {cal ? (
                      <>
                        <div className="font-semibold tabular-nums">
                          {cal.recommended_concurrency} slots, {cal.docs_per_minute.toFixed(1)} docs/min
                        </div>
                        <div className="text-xs text-muted">
                          Measured {dateTime(cal.measured_at)} at{" "}
                          {cal.levels.map((l) => `${l.concurrency} (${l.docs_per_minute.toFixed(1)}/min)`).join(", ")}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted">Not measured yet</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canCalibrate ? (
                      <Button
                        busy={running === p.name}
                        disabled={!p.available || running !== null || p.locality === "remote"}
                        title={p.locality === "remote" ? "Remote models are measured with real requests; run a small job instead." : undefined}
                        onClick={async () => {
                          setRunning(p.name);
                          setCalError(null);
                          try {
                            await vault.calibrate(p.name);
                            caps.reload();
                          } catch (e) {
                            setCalError(`${providerLabel(p.name)}: ${errorText(e)}`);
                          } finally {
                            setRunning(null);
                          }
                        }}
                      >
                        {running === p.name ? "Measuring" : cal ? "Measure again" : "Measure"}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {running && (
        <Notice tone="info">
          Measuring {providerLabel(running)} on real stored documents. This can take a few minutes; keep this page open.
        </Notice>
      )}
      {calError && <Notice>Measurement failed. {calError}</Notice>}
      {!canCalibrate && <p className="text-xs text-muted">Only administrators can run a measurement.</p>}
    </div>
  );
}

interface LaneDraft {
  key: number;
  provider: ProviderName;
  concurrency: number;
}

function suggested(cap: Capacity | string | undefined): number | null {
  if (!cap || typeof cap === "string") return null;
  return cap.calibration?.recommended_concurrency ?? cap.static_ceiling;
}

function LaneAndStart({
  providers,
  providersError,
  collectionId,
  caps,
}: {
  providers: ProvidersResponse | undefined;
  providersError: string | null;
  collectionId: number;
  caps: Caps;
}) {
  const { me, collection } = useSession();
  const router = useRouter();
  const [draft, setDraft] = useState<LaneDraft[] | null>(null);
  const [escalate, setEscalate] = useState<ProviderName | "">("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; status: number } | null>(null);
  const nextKey = useRef(2);

  const byName = new Map((providers?.providers ?? []).map((p) => [p.name, p]));
  const defaultProvider = providers?.default ?? "ollama";
  const lanes: LaneDraft[] = draft ?? [
    { key: 1, provider: defaultProvider, concurrency: Math.min(suggested(caps.data?.[defaultProvider]) ?? 2, 8) },
  ];
  const remoteNames = new Set((providers?.providers ?? []).filter((p) => p.locality === "remote").map((p) => p.name));
  const usesRemote = lanes.some((l) => remoteNames.has(l.provider)) || (escalate !== "" && remoteNames.has(escalate));
  const remoteAllowed = !!providers?.allow_remote_inference;
  const canStart = atLeast(me, "analyst");
  const blockedReason = !canStart
    ? "Viewers can watch runs. Ask an analyst or admin to start one."
    : usesRemote && !remoteAllowed
      ? "A lane uses a remote model, and remote inference is off. Remove that lane, or ask an administrator to turn remote inference on."
      : usesRemote && !confirmed
        ? "Tick the box above to confirm that document text may leave this machine."
        : lanes.some((l) => !byName.get(l.provider)?.available)
          ? "One of the lanes uses a model that is not available on this machine."
          : null;

  const update = (key: number, patch: Partial<LaneDraft>) => setDraft(lanes.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <>
      <Step
        n={3}
        title="Choose lanes"
        intro="A lane is one model with a number of slots working in parallel. Lanes pull from a shared queue, so faster lanes simply take more documents. The security gate always keeps marked and personal-data documents on local lanes."
      >
        <LoadError error={providersError} status={null} what="models" />
        <div className="flex flex-col gap-3">
          {lanes.map((l, i) => {
            const info = byName.get(l.provider);
            const remote = info?.locality === "remote";
            const s = suggested(caps.data?.[l.provider]);
            return (
              <div key={l.key} className={cx("border bg-panel", remote ? "border-amber" : "border-line")}>
                <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
                  <span className="mb-2 text-sm font-semibold">Lane {i + 1}</span>
                  <div className="min-w-48 flex-1">
                    <Field label="Model" htmlFor={`lane-${l.key}-p`}>
                      <select
                        id={`lane-${l.key}-p`}
                        className={inputClass}
                        value={l.provider}
                        onChange={(e) => {
                          const p = e.target.value as ProviderName;
                          update(l.key, { provider: p, concurrency: Math.min(suggested(caps.data?.[p]) ?? 2, 24) });
                        }}
                      >
                        {(providers?.providers ?? []).map((p) => (
                          <option key={p.name} value={p.name}>
                            {providerLabel(p.name)}
                            {p.locality === "remote" ? " (remote)" : ""}
                            {!p.available ? ", not available" : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="w-28">
                    <Field label="Slots" htmlFor={`lane-${l.key}-c`}>
                      <input
                        id={`lane-${l.key}-c`}
                        type="number"
                        min={1}
                        max={64}
                        className={inputClass}
                        value={l.concurrency}
                        onChange={(e) => update(l.key, { concurrency: Math.max(1, Math.min(64, Number(e.target.value) || 1)) })}
                      />
                    </Field>
                  </div>
                  {lanes.length > 1 && (
                    <Button variant="quiet" className="mb-1" onClick={() => setDraft(lanes.filter((x) => x.key !== l.key))}>
                      Remove lane {i + 1}
                    </Button>
                  )}
                </div>
                <div className="flex flex-col gap-2 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone={remote ? "amber" : "green"}>{remote ? "Remote" : "On this machine"}</Tag>
                    {info?.is_ai_model === false && <Tag>Not an AI model</Tag>}
                    <span className="text-muted">{info?.privacy ?? info?.detail}</span>
                  </div>
                  {s !== null && (
                    <p className="text-xs text-muted">
                      Suggested for this machine: {s} {s === 1 ? "slot" : "slots"}
                      {typeof caps.data?.[l.provider] === "object" && (caps.data?.[l.provider] as Capacity).calibration ? " (measured)" : " (hardware estimate)"}.
                    </p>
                  )}
                  {!info?.available && <p className="text-amber">Not available: {info?.detail}</p>}
                  {remote && (
                    <Notice tone="warning">
                      <p className="font-medium">Document text leaves this machine on this lane.</p>
                      <p className="mt-1">
                        Text from unmarked documents in this collection is sent to the remote provider. Documents with
                        markings, personal data or instruction-like text stay on local lanes.
                        {!remoteAllowed && " Remote inference is currently off; an administrator must turn it on from the Security sheet."}
                      </p>
                    </Notice>
                  )}
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap items-end gap-4">
            <Button
              disabled={lanes.length >= 8}
              onClick={() => {
                const local = (providers?.providers ?? []).find((p) => p.available && p.locality === "local");
                setDraft([...lanes, { key: nextKey.current++, provider: local?.name ?? defaultProvider, concurrency: 1 }]);
              }}
            >
              Add a lane
            </Button>
            <div className="min-w-56">
              <Field label="Escalation model (optional)" htmlFor="escalate" hint="Results the reviewer can't accept get one more try here.">
                <select id="escalate" className={inputClass} value={escalate} onChange={(e) => setEscalate(e.target.value as ProviderName | "")}>
                  <option value="">None, send unclear results to a person</option>
                  {(providers?.providers ?? []).map((p) => (
                    <option key={p.name} value={p.name} disabled={!p.available}>
                      {providerLabel(p.name)}
                      {p.locality === "remote" ? " (remote)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
          {usesRemote && (
            <label className="flex items-start gap-2 border border-amber bg-panel px-3 py-2 text-sm">
              <input type="checkbox" className="mt-1 accent-[var(--amber)]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>I understand that text from unmarked documents will be sent to a remote model for this run.</span>
            </label>
          )}
        </div>
      </Step>

      <Step n={4} title="Start the run" intro="The coordinator plans the lanes, the security gate screens every document, and you can watch it all on the live board." last>
        <Panel>
          <p className="text-sm">
            Process <span className="font-semibold">{collection?.name}</span> ({formatNumber(collection?.documents ?? 0)} documents) with{" "}
            {lanes.map((l, i) => `lane ${i + 1}: ${providerLabel(l.provider)} with ${l.concurrency} ${l.concurrency === 1 ? "slot" : "slots"}`).join("; ")}
            {escalate ? `; unclear results escalate to ${providerLabel(escalate)}` : "; unclear results go to a person"}.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              busy={busy}
              disabled={!!blockedReason}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const job = await vault.createJob({
                    collection_id: collectionId,
                    lanes: lanes.map(({ provider, concurrency }) => ({ provider, concurrency })),
                    escalate_provider: escalate || null,
                    confirm_remote: usesRemote && confirmed,
                  });
                  router.push(`/run?job=${job.id}`);
                } catch (e) {
                  setError(e instanceof ApiError ? { text: e.message, status: e.status } : { text: errorText(e), status: -1 });
                  setBusy(false);
                }
              }}
            >
              Start run
            </Button>
            {blockedReason && <span className="text-sm text-muted">{blockedReason}</span>}
          </div>
          {error && (
            <Notice tone={error.status === 403 ? "denied" : "error"} className="mt-3">
              {error.status === 409
                ? "A lane sends document text off this machine. Tick the confirmation box in step 3 and start again."
                : error.status === 403
                  ? `The server refused to start this run: ${error.text}`
                  : error.status === 503
                    ? `A model is not ready: ${error.text}. Check that it is running, then try again.`
                    : `Couldn't start the run: ${error.text}`}
            </Notice>
          )}
        </Panel>
      </Step>
    </>
  );
}
