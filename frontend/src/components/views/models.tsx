"use client";

import { vault, type LocalModel } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { LoadingBlock } from "../loader";
import { ModelInstaller } from "../model-installer";
import { TitleBlock } from "../title-block";
import { cx, LoadError, Panel, Tag } from "../ui";

/** F03.9: one place that says plainly which AI models are on this computer, and downloads more. */
export function ModelsView() {
  const models = useLoad("local-models", vault.localModels, 15000);
  const data = models.data;
  const active = data?.models.find((m) => m.used_by_vault);

  return (
    <div className="flex flex-col gap-6">
      <TitleBlock
        href="/models"
        title="Models"
        description="The AI models on this computer. VAULT reads your documents with one of them, and nothing leaves this machine."
      />

      {models.error && !data && <LoadError error={models.error} status={models.status} what="the model list" />}
      {!data && !models.error && <LoadingBlock label="Asking Ollama which models are downloaded" />}

      {data && (
        <div
          className={cx(
            "reveal flex flex-col gap-1 rounded-card border px-5 py-4",
            !data.reachable ? "border-amber/40" : active ? "border-green/40 bg-green/5" : "border-redline/40 bg-redline/5",
          )}
        >
          <p className={cx("display text-lg", !data.reachable ? "text-amber" : active ? "text-green" : "text-redline")}>
            {!data.reachable ? "Ollama is not running" : active ? "Ready to read" : "The model VAULT uses is not downloaded"}
          </p>
          <p className="text-sm text-muted">
            {!data.reachable
              ? "Ollama runs the models. Start it from the Start menu (or run “ollama serve”), then this page updates by itself."
              : active
                ? `${active.name} is downloaded (${active.size_gb} GB) and VAULT reads with it.${active.loaded ? " It is loaded and answers at once." : " It loads the first time you use it, which takes a few seconds."}`
                : "Download Llama 3 below. It is about 4.7 GB."}
          </p>
        </div>
      )}

      {data?.reachable && (
        <Panel title={`Downloaded on this computer (${data.models.length})`}>
          {data.models.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet. Pick a model below and press Install.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-control border border-line" aria-label="Downloaded models">
              {data.models.map((m, i) => (
                <DownloadedRow key={m.name} model={m} index={i} />
              ))}
            </ul>
          )}
          <ModelInstaller />
        </Panel>
      )}
    </div>
  );
}

function DownloadedRow({ model: m, index }: { model: LocalModel; index: number }) {
  return (
    <li className="tick-in flex flex-wrap items-center justify-between gap-2 px-3 py-2.5" style={{ animationDelay: `${index * 40}ms` }}>
      <span className="flex min-w-0 items-center gap-2.5">
        <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-green" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="font-mono text-[13px] font-medium">{m.name}</span>
        <span className="text-xs text-muted">
          {m.size_gb} GB{m.parameters ? ` · ${m.parameters}` : ""}
          {m.origin === "meta" ? " · Meta" : m.origin === "llama-based" ? " · built on Llama" : ""}
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        {m.used_by_vault && <Tag tone="green">VAULT reads with this</Tag>}
        {m.loaded && <Tag>Loaded now</Tag>}
        <Tag>Downloaded</Tag>
      </span>
    </li>
  );
}
