"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { atLeast, errorText, vault, type Brain, type BrainQuestion, type ProviderName, TERMINAL, type AgentEvent } from "@/lib/api";
import { humanize } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { BrainMap } from "../brain-map";
import { DocumentDrawer } from "../document-drawer";
import { useSession } from "../session";
import { TitleBlock } from "../title-block";
import { Button, cx, Empty, Field, inputClass, LoadError, Notice, Panel, Skeleton, Tag } from "../ui";

// The 3D space pulls in three.js, so it loads only on this page and only in the browser.
const BrainSpace = dynamic(() => import("../brain-space"), {
  ssr: false,
  loading: () => <Skeleton className="h-[560px] w-full" />,
});

let webgl: boolean | undefined;
function hasWebGL(): boolean {
  if (webgl === undefined) {
    try {
      const c = document.createElement("canvas");
      webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}
const noSubscribe = () => () => {};

const DESCRIPTION =
  "What VAULT knows about this collection, what your people taught it, and the questions it still has. Each collection has its own brain; nothing taught here is used anywhere else.";

/** F07.7 and F07.8: the collection brain, its questions, teaching, and the map (a 3D space, or the 2D map). */

async function allEvents(jobId: number) {
  const out: AgentEvent[] = [];
  for (;;) {
    const batch = await vault.events(jobId, out.length ? out[out.length - 1].id : 0, 1000);
    out.push(...batch);
    if (batch.length < 1000) return out;
  }
}

export function BrainView() {
  const { collection, me } = useSession();
  const canTeach = atLeast(me, "analyst");
  const brain = useLoad(collection ? `brain:${collection.id}` : null, () => vault.brain(collection!.id));
  const graph = useLoad(collection ? `brain-graph:${collection.id}` : null, () => vault.brainGraph(collection!.id));
  // F10.16: the agents in the 3D space fly from the record of the collection's latest run.
  const jobs = useLoad(collection ? `brain-jobs:${collection.id}` : null, vault.jobs, 5000);
  const mine = jobs.data?.filter((j) => j.kind === "process" && j.collection_id === collection?.id);
  // A live run first; otherwise the last one that really finished, since a cancelled stub has little to show.
  const run = mine?.find((j) => !TERMINAL.includes(j.status)) ?? mine?.find((j) => j.status === "completed") ?? mine?.[0];
  const running = run && !TERMINAL.includes(run.status);
  const runEvents = useLoad(run ? `brain-events:${run.id}` : null, () => allEvents(run!.id), running ? 2000 : undefined);
  const [openDoc, setOpenDoc] = useState<number | null>(null);
  const close = useCallback(() => setOpenDoc(null), []);
  const [learned, setLearned] = useState(0);
  // null on the server; then whether this browser can draw WebGL.
  const canWebGL = useSyncExternalStore(noSubscribe, hasWebGL, () => null);
  const [chosen, setChosen] = useState<"3d" | "2d" | null>(null);
  const [failed3d, setFailed3d] = useState(false);
  const fallback = useCallback(() => setFailed3d(true), []);
  const can3d = canWebGL === true && !failed3d;
  const mapView = !can3d ? "2d" : (chosen ?? "3d");

  if (!collection)
    return (
      <>
        <TitleBlock href="/brain" title="Brain" description={DESCRIPTION} />
        <Empty>
          There is no collection in this mode yet. <Link href="/setup" className="underline underline-offset-4">Set one up</Link> first.
        </Empty>
      </>
    );

  const reload = () => {
    setLearned((n) => n + 1);
    brain.reload();
  };

  return (
    <>
      <TitleBlock href="/brain" title="Brain" description={DESCRIPTION} />
      <LoadError error={brain.error} status={brain.status} what="the brain" />
      {brain.data ? <Profile brain={brain.data} /> : <Skeleton className="mb-6 h-28 w-full" />}

      <Panel
        className="mb-6"
        title="Map"
        aside={graph.data ? `${graph.data.nodes.length} items · ${graph.data.edges.length} links` : undefined}
      >
        <LoadError error={graph.error} status={graph.status} what="the map" />
        {graph.data && graph.data.nodes.length > 0 && canWebGL !== null && (
          <div role="group" aria-label="Map view" className="mb-3 flex flex-wrap items-center gap-1">
            {(["3d", "2d"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={mapView === v}
                disabled={v === "3d" && !can3d}
                onClick={() => setChosen(v)}
                className={cx(
                  "rounded-control border px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50",
                  mapView === v ? "border-ink bg-ink text-panel" : "border-line bg-panel text-muted hover:text-ink",
                )}
              >
                {v === "3d" ? "3D space" : "2D map"}
              </button>
            ))}
            {!can3d && <span className="ml-2 text-xs text-muted">This browser cannot draw 3D, so the 2D map is shown.</span>}
          </div>
        )}
        {graph.data && graph.data.nodes.length > 0 && canWebGL !== null && mapView === "3d" && (
          <BrainSpace graph={graph.data} onOpenDocument={setOpenDoc} onUnsupported={fallback} events={runEvents.data} runId={run?.id ?? null} running={!!running} />
        )}
        {graph.data && graph.data.nodes.length > 0 && canWebGL !== null && mapView === "2d" && (
          <BrainMap graph={graph.data} onOpenDocument={setOpenDoc} />
        )}
        {graph.data && graph.data.nodes.length === 0 && <Empty>Read the documents first; the map fills in as VAULT reads.</Empty>}
        {((!graph.data && !graph.error) || (graph.data && graph.data.nodes.length > 0 && canWebGL === null)) && (
          <Skeleton className="h-[520px] w-full" />
        )}
      </Panel>
      <div className="grid gap-6 xl:grid-cols-2">
        {brain.data && (
          <Questions collectionId={collection.id} questions={brain.data.questions} canTeach={canTeach} onAnswered={reload} learned={learned} />
        )}
        {brain.data && <Teach collectionId={collection.id} brain={brain.data} canTeach={canTeach} onChange={reload} />}
      </div>
      <DocumentDrawer documentId={openDoc} onClose={close} />
    </>
  );
}

function Profile({ brain }: { brain: Brain }) {
  const types = Object.entries(brain.doc_types);
  const total = types.reduce((n, [, v]) => n + v, 0) || 1;
  return (
    <section aria-label="What VAULT knows" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Fact label="Read">
        {brain.read} of {brain.documents} documents
        <span className="block text-xs text-muted">{brain.read_by.join(", ") || "not read yet"}</span>
      </Fact>
      <Fact label="Subjects">
        {brain.projects.length} projects, {brain.parts.length} recurring parts
        <span className="block text-xs text-muted">
          {brain.date_range ? `Dated ${brain.date_range[0]} to ${brain.date_range[1]}` : "No dates found yet"}
        </span>
      </Fact>
      <Fact label="Taught by your people">
        {brain.taught.meanings} meanings, {brain.taught.instructions} instructions
        <span className="block text-xs text-muted">
          {brain.taught.rules} rules and {brain.taught.examples} labelled examples
        </span>
      </Fact>
      <Fact label="Quotes found on the page">
        {brain.quotes_verified === null ? "–" : `${Math.round(brain.quotes_verified * 100)}%`}
        <span className="block text-xs text-muted">Every fact is checked against the original text</span>
      </Fact>
      {types.length > 0 && (
        <div className="sm:col-span-2 xl:col-span-4">
          <div className="flex h-2 w-full overflow-hidden rounded-full ring-1 ring-line" aria-hidden>
            {types.map(([t, n], i) => (
              <span key={t} style={{ width: `${(n / total) * 100}%`, opacity: 1 - i * 0.11 }} className="h-full bg-ink" />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">{types.map(([t, n]) => `${humanize(t)} ${n}`).join(" · ")}</p>
        </div>
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-panel px-4 py-3 shadow-panel">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium">{children}</p>
    </div>
  );
}

const KIND_TAG: Record<BrainQuestion["kind"], string> = {
  marking: "Marking",
  term: "Term",
  doc_type: "Document type",
  project: "Project",
  check: "Check",
};

function Questions(props: {
  collectionId: number;
  questions: BrainQuestion[];
  canTeach: boolean;
  onAnswered: () => void;
  learned: number;
}) {
  const { collectionId, questions, canTeach } = props;
  const providers = useLoad("providers", vault.providers);
  const reader = useMemo<ProviderName>(() => {
    const local = (providers.data?.providers ?? []).find((p) => p.available && p.locality === "local" && p.is_ai_model);
    return (local?.name as ProviderName) ?? "heuristic";
  }, [providers.data]);
  const [rereading, setRereading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Panel title="VAULT's questions" aside={`${questions.length} open`}>
      <p className="mb-3 text-sm text-muted">
        VAULT looked for gaps in what it knows: markings and abbreviations nobody has explained, and documents it could
        not place. Each answer is kept in this collection&apos;s brain and used the next time it reads.
      </p>
      {questions.length === 0 && <Empty>No open questions. Teach it something new, or add more documents.</Empty>}
      <ul className="flex flex-col gap-3">
        {questions.map((q) => (
          <QuestionItem key={q.id} collectionId={collectionId} q={q} canTeach={canTeach} onDone={props.onAnswered} />
        ))}
      </ul>
      {canTeach && props.learned > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-sm">
          <span>Read the collection again so it uses what it just learned, then re-test on Training.</span>
          <Button
            variant="primary"
            busy={rereading}
            onClick={async () => {
              setRereading(true);
              setMessage(null);
              try {
                const job = await vault.createJob({
                  collection_id: collectionId,
                  lanes: [{ provider: reader, concurrency: 2 }],
                  confirm_remote: false,
                  only_new: true,
                });
                setMessage(`Started run ${job.id}. Follow it on the Live run board.`);
              } catch (e) {
                setMessage(errorText(e));
              } finally {
                setRereading(false);
              }
            }}
          >
            Re-read with what it learned
          </Button>
          {message && (
            <p role="status" className="w-full text-muted">
              {message}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

function QuestionItem({ collectionId, q, canTeach, onDone }: { collectionId: number; q: BrainQuestion; canTeach: boolean; onDone: () => void }) {
  const [answer, setAnswer] = useState(q.choices?.[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-col gap-2 rounded-control border border-line p-3 text-sm">
      <span className="flex items-start gap-2">
        <Tag>{KIND_TAG[q.kind]}</Tag>
        <span>{q.question}</span>
      </span>
      {canTeach && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) void run(() => vault.answerQuestion(collectionId, q.id, answer));
          }}
        >
          {q.choices ? (
            <select className={cx(inputClass, "w-auto")} value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Answer">
              {q.choices.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={cx(inputClass, "flex-1")}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={q.kind === "check" ? "Yes, or what is wrong" : "What it means"}
              aria-label="Answer"
              maxLength={500}
            />
          )}
          <Button type="submit" busy={busy} disabled={!answer.trim()}>
            Answer
          </Button>
          <Button type="button" variant="quiet" disabled={busy} onClick={() => run(() => vault.skipQuestion(collectionId, q.id))}>
            Skip
          </Button>
        </form>
      )}
      {error && <Notice>{error}</Notice>}
    </li>
  );
}

function Teach({ collectionId, brain, canTeach, onChange }: { collectionId: number; brain: Brain; canTeach: boolean; onChange: () => void }) {
  const [kind, setKind] = useState<"meaning" | "instruction">("meaning");
  const [term, setTerm] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel title="Teach it" aside={`${brain.knowledge.length} taught`}>
      {canTeach && (
        <form
          className="mb-4 flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await vault.teach(collectionId, { kind, term: kind === "meaning" ? term : undefined, text });
              setTerm("");
              setText("");
              onChange();
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div role="group" aria-label="What to teach" className="flex gap-1">
            {(["meaning", "instruction"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cx(
                  "rounded-control border px-2.5 py-1 text-sm",
                  kind === k ? "border-ink bg-ink text-panel" : "border-line bg-panel text-muted hover:text-ink",
                )}
              >
                {k === "meaning" ? "This means that" : "An instruction"}
              </button>
            ))}
          </div>
          {kind === "meaning" && (
            <Field label="Term, marking or code" htmlFor="teach-term">
              <input id="teach-term" className={inputClass} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="QA-7 stamp" maxLength={120} required />
            </Field>
          )}
          <Field label={kind === "meaning" ? "What it means" : "What VAULT should do"} htmlFor="teach-text">
            <textarea
              id="teach-text"
              className={cx(inputClass, "min-h-20")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={kind === "meaning" ? "Approved by the quality team" : "Treat a red REVISED stamp as a revision request, not an approval"}
              maxLength={500}
              required
            />
          </Field>
          <Button type="submit" variant="primary" busy={busy}>
            Teach
          </Button>
          {error && <Notice>{error}</Notice>}
        </form>
      )}
      {brain.knowledge.length === 0 ? (
        <Empty>Nothing taught yet. Answer a question above, or teach a meaning or an instruction.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {brain.knowledge.map((k) => (
            <li key={k.id} className="flex items-start justify-between gap-3 py-2">
              <span>
                {k.term ? (
                  <>
                    <span className="font-medium">{k.term}</span> means {k.text}
                  </>
                ) : (
                  k.text
                )}
                <span className="block text-xs text-muted">
                  {k.source === "question" ? "Answered a question" : "Taught"} by {k.created_by ?? "unknown"}
                </span>
              </span>
              {canTeach && (
                <button
                  type="button"
                  className="text-xs text-muted hover:text-ink"
                  onClick={async () => {
                    await vault.forget(collectionId, k.id).catch(() => undefined);
                    onChange();
                  }}
                >
                  Forget
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">
        VAULT does not retrain the model. What you teach is kept for this collection and given to the model each time
        it reads, and Training measures whether it helped.
      </p>
    </Panel>
  );
}
