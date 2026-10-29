"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { atLeast, errorText, vault, type LocalModels, type ProviderName } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { useSession } from "./session";
import { Button, cx, Notice, Panel, Skeleton, Tag } from "./ui";

const ORIGIN_LABEL = { meta: "Meta", "llama-based": "Llama-based", other: "Not Meta" } as const;

/** Installed local models and how many copies of each this computer can run at once (F03.6). */
export function LocalModelsCard({ data, compact }: { data: LocalModels | undefined; compact?: boolean }) {
  if (!data)
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="Checking this computer">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  if (!data.reachable)
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>{data.detail}</p>
        <OllamaHelp />
      </div>
    );
  const shown = compact ? data.models.filter((m) => m.used_by_vault || m.origin === "meta").slice(0, 3) : data.models;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        {data.gpu ? (
          <>
            <span className="font-medium">{data.gpu}</span> with {data.vram_gb} GB of graphics memory.{" "}
          </>
        ) : (
          "No graphics card found; models run on the processor, more slowly. "
        )}
        <span className="font-medium">
          {data.different_models_on_gpu_together === 1
            ? "One model fits on it at a time"
            : `${data.different_models_on_gpu_together} different models fit on it at once`}
        </span>
        , and each copy answers up to {data.models[0]?.requests_per_copy ?? 8} documents at the same time.
      </p>
      <ul className="flex flex-col divide-y divide-line rounded-control border border-line" aria-label="Installed local models">
        {shown.map((m) => (
          <li key={m.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-medium">{m.name}</span>
              <Tag tone={m.origin === "meta" ? "green" : "neutral"}>{ORIGIN_LABEL[m.origin]}</Tag>
              {m.used_by_vault && <Tag tone="green">VAULT uses this</Tag>}
              {m.loaded && <Tag>Loaded now</Tag>}
            </span>
            <span className="tabular-nums text-muted">
              {m.parameters ?? "?"} · needs ~{m.memory_gb} GB ·{" "}
              <span className="text-ink">
                {m.copies_on_gpu > 0
                  ? `${m.copies_on_gpu} cop${m.copies_on_gpu === 1 ? "y" : "ies"} on the GPU`
                  : m.copies_in_ram > 0
                    ? `${m.copies_in_ram} on the CPU (slow)`
                    : "does not fit right now"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        Estimated from model sizes. VAULT reads documents only with Meta models; others are listed because Ollama has
        them installed. Measure real speed under <Link href="/setup" className="underline underline-offset-4">Set up a run</Link>.
      </p>
    </div>
  );
}

export function OllamaHelp() {
  return (
    <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
      <li>
        Install Ollama:{" "}
        <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer" className="text-blue underline underline-offset-4">
          ollama.com/download
        </a>
      </li>
      <li>
        Download Meta Llama 3 once (about 4.7 GB): <CopyCommand text="ollama pull llama3" />
      </li>
      <li>Reload this page. Until then, VAULT reads with the rules baseline, labelled &quot;not AI&quot;.</li>
    </ol>
  );
}

function CopyCommand({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[12px]">{text}</code>
      <button
        type="button"
        className="text-xs text-blue underline underline-offset-4"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

const DISMISS_KEY = "vault.getting-started.hidden";

/** First-run checklist on the Overview: what is done, and the one next thing to do. */
export function GettingStarted() {
  const { collection, mode, me } = useSession();
  const models = useLoad("local-models", vault.localModels, 30000);
  const training = useLoad(collection ? `training:${collection.id}` : null, () => vault.training(collection!.id));
  // Rendered only after sign-in, in the browser, so reading storage during the first render is safe.
  const [hidden, setHidden] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  const aiReady = !!models.data?.reachable && models.data.models.some((m) => m.used_by_vault);
  const items = [
    {
      done: aiReady,
      label: "Local AI ready",
      detail: aiReady ? "Meta Llama 3 runs on this computer." : "Install Ollama and Meta Llama 3 (optional, but this is the AI).",
      href: "/setup",
    },
    {
      done: !!collection,
      label: mode === "demo" ? "Demo archive loaded" : "Create a collection",
      detail: collection ? collection.name : "One collection per archive, client or site.",
      href: "/setup",
    },
    {
      done: (collection?.documents ?? 0) > 0,
      label: "Add documents",
      detail: collection?.documents ? `${collection.documents} documents` : "PDF, text, CSV and images.",
      href: "/setup",
    },
    {
      done: (collection?.processed ?? 0) > 0,
      label: "Read them",
      detail: collection?.processed ? `${collection.processed} read` : "One button on Set up a run.",
      href: "/setup",
    },
    {
      done: (training.data?.history.length ?? 0) > 0,
      label: "Check the quality",
      detail: "Grade the reading on Training before trusting it with real work.",
      href: "/training",
    },
  ];
  const next = items.find((i) => !i.done);
  if (hidden) return null;
  return (
    <Panel
      title="Getting started"
      className="mb-8 animate-rise"
      aside={
        <button
          type="button"
          className="text-xs text-muted hover:text-ink"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(DISMISS_KEY, "1");
            } catch {
              /* storage unavailable */
            }
          }}
        >
          Hide
        </button>
      }
    >
      <ol className="grid gap-2 sm:grid-cols-5" aria-label="Getting started steps">
        {items.map((it, i) => (
          <li
            key={it.label}
            className={cx(
              "flex flex-col gap-1 rounded-control border px-3 py-2 text-sm transition-colors",
              it.done ? "border-green/40" : it === next ? "border-accent bg-accent/5" : "border-line",
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <span
                aria-hidden
                className={cx(
                  "grid h-5 w-5 place-items-center rounded-full text-[11px]",
                  it.done ? "bg-green text-paper" : "border border-line-strong text-muted",
                )}
              >
                {it.done ? "✓" : i + 1}
              </span>
              {it.label}
              <span className="sr-only">{it.done ? "(done)" : "(to do)"}</span>
            </span>
            {/* Finished steps shrink to one line on a phone, so the next step is on screen. */}
            <span className={cx("text-xs text-muted", it.done && "hidden sm:block")}>{it.detail}</span>
            {it === next && atLeast(me, "analyst") && (
              <Link href={it.href} className="mt-1 text-xs font-medium text-blue underline underline-offset-4">
                Do this next
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** One button: read every document with the best local model, using sensible defaults (F12.9). */
export function QuickStart({ collectionId, documents }: { collectionId: number; documents: number }) {
  const router = useRouter();
  const models = useLoad("local-models", vault.localModels, 30000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const llama = models.data?.reachable ? models.data.models.find((m) => m.used_by_vault) : undefined;
  const provider: ProviderName = llama ? "ollama" : "heuristic";
  // Two slots keep one Llama copy busy without running out of graphics memory on an 8 GB laptop.
  const slots = llama ? Math.min(2, Math.max(1, llama.copies_on_gpu * 2)) : 4;
  return (
    <Panel title="Quick start" className="mb-6 animate-rise">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          Read all <span className="font-semibold tabular-nums">{documents}</span> documents with{" "}
          {llama ? (
            <span className="font-medium">Meta Llama 3 on this computer</span>
          ) : (
            <>
              the <span className="font-medium">rules baseline</span> (not AI; install Ollama for AI reading)
            </>
          )}
          . Nothing leaves this machine.
        </p>
        <Button
          variant="primary"
          busy={busy}
          disabled={!documents || !models.data}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const job = await vault.createJob({
                collection_id: collectionId,
                lanes: [{ provider, concurrency: slots }],
                confirm_remote: false,
              });
              router.push(`/run?job=${job.id}`);
            } catch (e) {
              setError(errorText(e));
              setBusy(false);
            }
          }}
        >
          {llama ? "Read everything with Llama 3" : "Read everything"}
        </Button>
      </div>
      {!llama && models.data && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-ink">How to turn on AI reading</summary>
          <div className="mt-2">
            <OllamaHelp />
          </div>
        </details>
      )}
      {error && <Notice className="mt-3">{error}</Notice>}
    </Panel>
  );
}
