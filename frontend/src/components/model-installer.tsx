"use client";

import { useState } from "react";
import { atLeast, errorText, vault, type CatalogModel, type ModelInstall } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { useSession } from "./session";
import { Button, Meter, Notice, Tag } from "./ui";

const WHERE = {
  gpu: { text: "Runs on the graphics card", tone: "green" },
  cpu: { text: "Runs, partly on the processor (slower)", tone: "amber" },
  too_big: { text: "Too big for this computer", tone: "neutral" },
} as const;
const BUSY: ModelInstall["status"][] = ["starting", "downloading"];

/**
 * F03.7: the Meta models this computer can run, with one-click installs into the local Ollama.
 * Downloads come from Ollama's registry; no document ever leaves the machine.
 */
export function ModelInstaller() {
  const { me } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const first = useLoad("model-catalog", vault.modelCatalog);
  const downloading = (first.data?.installs ?? []).some((i) => BUSY.includes(i.status));
  // Poll quickly only while something downloads.
  const live = useLoad(downloading ? "model-catalog:live" : null, vault.modelCatalog, 1500);
  const data = (downloading && live.data) || first.data;
  const admin = atLeast(me, "admin");

  if (!data) return null;
  const installs = Object.fromEntries(data.installs.map((i) => [i.name, i]));
  const recommendedLeft = data.recommended.filter((n) => !data.models.find((m) => m.name === n)?.installed);
  // Ollama calls the default Llama 3 tag "llama3:latest"; it is the same model as llama3:8b.
  const active = data.active_model === "llama3:latest" ? "llama3:8b" : data.active_model;

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setPending(name);
    setError(null);
    try {
      await fn();
      first.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-line pt-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Meta models for this computer</h3>
        {admin && recommendedLeft.length > 0 && (
          <Button
            variant="primary"
            busy={pending === "recommended"}
            onClick={() => act("recommended", () => Promise.all(recommendedLeft.map((n) => vault.installModel(n))))}
          >
            Install the recommended set
          </Button>
        )}
      </div>
      <p className="text-muted">
        VAULT checked this computer: {data.vram_gb ? `${data.vram_gb} GB of graphics memory` : "no graphics card"} and{" "}
        {data.ram_gb} GB of memory. Recommended: {data.recommended.join(" and ") || "none fits"}. Downloads come from
        Ollama&apos;s library; your documents never leave this machine.
      </p>
      <ul className="flex flex-col divide-y divide-line rounded-control border border-line" aria-label="Meta models">
        {data.models.map((m) => (
          <ModelRow
            key={m.name}
            model={m}
            install={installs[m.name]}
            active={active === m.name}
            recommended={data.recommended.includes(m.name)}
            admin={admin}
            busy={pending === m.name}
            onInstall={() => act(m.name, () => vault.installModel(m.name))}
            onCancel={() => act(m.name, () => vault.cancelModelInstall(m.name))}
            onUse={() => act(m.name, () => vault.setLocalModel(m.name))}
          />
        ))}
      </ul>
      {!admin && <p className="text-xs text-muted">An admin can install models and choose the one VAULT reads with.</p>}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}

function ModelRow(props: {
  model: CatalogModel;
  install?: ModelInstall;
  active: boolean;
  recommended: boolean;
  admin: boolean;
  busy: boolean;
  onInstall: () => void;
  onCancel: () => void;
  onUse: () => void;
}) {
  const { model: m, install, active, recommended, admin, busy } = props;
  const downloading = !!install && BUSY.includes(install.status);
  const installed = m.installed || install?.status === "installed";
  const where = WHERE[m.runs_on];
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium">{m.title}</span>
          <span className="font-mono text-[12px] text-muted">{m.name}</span>
          {recommended && <Tag tone="blue">Recommended</Tag>}
          {active && <Tag tone="green">VAULT reads with this</Tag>}
          {m.reads !== "text" && <Tag>Reads images</Tag>}
        </span>
        <span className="flex items-center gap-2">
          <Tag tone={where.tone}>{where.text}</Tag>
          {admin && !installed && !downloading && m.runs_on !== "too_big" && (
            <Button busy={busy} onClick={props.onInstall}>
              Install ({m.size_gb} GB)
            </Button>
          )}
          {admin && downloading && (
            <Button busy={busy} onClick={props.onCancel}>
              Stop
            </Button>
          )}
          {admin && installed && !active && m.reads === "text" && (
            <Button busy={busy} onClick={props.onUse}>
              Read with this
            </Button>
          )}
          {installed && (!admin || m.reads !== "text") && <Tag tone="green">Installed</Tag>}
        </span>
      </div>
      <p className="text-xs text-muted">
        {m.good_for}. Needs about {m.memory_gb} GB.
      </p>
      {downloading && install && (
        <div className="flex flex-col gap-1">
          <Meter value={install.completed} max={install.total || 1} label={`Downloading ${m.title}`} running />
          <span className="text-xs tabular-nums text-muted" role="status">
            {install.total
              ? `${(install.completed / 2 ** 30).toFixed(1)} of ${(install.total / 2 ** 30).toFixed(1)} GB`
              : install.detail || "Starting"}
          </span>
        </div>
      )}
      {install && (install.status === "failed" || install.status === "cancelled") && (
        <p className="text-xs text-redline" role="status">
          {install.detail}
        </p>
      )}
    </li>
  );
}
