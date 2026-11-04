"use client";

import { useState } from "react";
import { downloadDemoDataset, errorText, type DemoDatasetKind } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { Button, Notice, Panel } from "./ui";

// Sizes measured on the built ZIPs (F12.16). The server builds them itself; nothing comes from the internet.
const SETS: { kind: DemoDatasetKind; label: string; size: string; what: string }[] = [
  {
    kind: "quick",
    label: "Quick Demo Dataset",
    size: "155 files, about 0.4 MB",
    what: "The 150 demo documents with the BV-7891 1,500 vs 600 psi conflict, the expected findings, example prompts and a README.",
  },
  {
    kind: "complete",
    label: "Complete Demo Dataset",
    size: "about 280 files, about 15 MB",
    what: "Everything in Quick plus about 120 realistic test files: Office files, photos, video, sound, stamped drawings and harmless edge cases. The first download takes about 30 seconds while VAULT makes it.",
  },
];

/** F12.16: download the fictional demo files as ZIPs, so anyone can reproduce the demo. Shown in Demo mode. */
export function DemoDatasetPanel() {
  const [busy, setBusy] = useState<DemoDatasetKind | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(kind: DemoDatasetKind, label: string) {
    setBusy(kind);
    setDone(null);
    setError(null);
    try {
      const size = await downloadDemoDataset(kind);
      setDone(`Downloaded the ${label} (${formatBytes(size)}).`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="Download Demo Dataset" className="mb-8" id="demo-dataset">
      <p className="mb-4 text-sm text-muted">
        Fictional demonstration files, built by this VAULT on this computer. Unzip, then drop the folder onto Add files
        to reproduce the demo. Programs, active-content PDFs, macro files and nested archives are never included.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {SETS.map((s) => (
          <div key={s.kind} className="flex flex-col gap-3 rounded-card border border-line bg-raised p-4">
            <div>
              <p className="font-semibold">{s.label}</p>
              <p className="text-xs text-muted">{s.size}, ZIP</p>
            </div>
            <p className="flex-1 text-sm text-muted">{s.what}</p>
            <Button
              variant={s.kind === "quick" ? "primary" : "secondary"}
              busy={busy === s.kind}
              disabled={busy !== null && busy !== s.kind}
              onClick={() => save(s.kind, s.label)}
              className="self-start"
            >
              {busy === s.kind ? "Preparing…" : s.label}
            </Button>
          </div>
        ))}
      </div>
      {done && (
        <Notice tone="info" className="mt-4">
          {done}
        </Notice>
      )}
      {error && <Notice className="mt-4">Could not download the dataset: {error}</Notice>}
    </Panel>
  );
}
