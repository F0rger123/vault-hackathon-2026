"use client";

import { useState } from "react";
import { atLeast, errorText, vault, type Collection } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { useSession } from "./session";
import { Button, Notice, Panel } from "./ui";

const KEEP_NOTE = "Original files on your disk outside VAULT are not touched.";

/**
 * F12.17: delete collections after a native confirm that names them and their document count, then move the
 * session to a collection that still exists (or to Real mode when the last demo collection went).
 */
export function useDeleteCollections() {
  const { allCollections, mode, setMode, setCollectionId, refresh } = useSession();
  return async (targets: Collection[], what?: string): Promise<boolean> => {
    if (!targets.length) return false;
    const docs = targets.reduce((n, c) => n + c.documents, 0);
    const names = targets.map((c) => `"${c.name}"`).join(", ");
    const ok = window.confirm(
      `${what ?? "Delete the collection"} ${names} (${formatNumber(docs)} ${docs === 1 ? "document" : "documents"}) from VAULT?\n\n` +
        `This removes VAULT's stored copies, readings, findings, runs and answers for it. ${KEEP_NOTE}\n\nThis cannot be undone.`,
    );
    if (!ok) return false;
    for (const c of targets) await vault.deleteCollection(c.id);
    const gone = new Set(targets.map((c) => c.id));
    const left = allCollections.filter((c) => !gone.has(c.id));
    const same = left.find((c) => Boolean(c.is_demo) === (mode === "demo"));
    if (same) setCollectionId(same.id);
    else {
      const other = left[0];
      setMode(other ? (other.is_demo ? "demo" : "real") : "real");
      if (other) setCollectionId(other.id);
    }
    refresh();
    return true;
  };
}

/** Overview, Demo mode: one button removes the fictional demo data; once removed, one button brings it back. */
export function DemoDataControls() {
  const { me, collections, setMode, setCollectionId, refresh } = useSession();
  const remove = useDeleteCollections();
  const status = useLoad("demo-status", vault.demoStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  if (!atLeast(me, "admin")) return null;
  const demos = collections; // in Demo mode the session lists demo collections only

  return (
    <Panel title="Demo data" className="mb-8" id="demo-data">
      {demos.length > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            The fictional demo archive: {formatNumber(demos.reduce((n, c) => n + c.documents, 0))} documents in{" "}
            {demos.length === 1 ? "one collection" : `${demos.length} collections`}. Delete it when you are ready for your
            own files. {KEEP_NOTE}
          </p>
          <Button
            variant="danger"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setMessage(null);
              try {
                if (await remove(demos, "Delete the demo data")) status.reload();
              } catch (e) {
                setMessage({ tone: "error", text: errorText(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete demo data
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            {status.data?.demo_removed ? "The demo data was deleted. It stays deleted, even after a restart." : "There is no demo data."}{" "}
            Restore it to import the fictional demo archive again and read it with the rules baseline.
          </p>
          <Button
            busy={busy}
            disabled={status.data ? !status.data.can_restore : false}
            onClick={async () => {
              setBusy(true);
              setMessage(null);
              try {
                const r = await vault.restoreDemo();
                setMode("demo");
                setCollectionId(r.collection_id);
                refresh();
                status.reload();
                setMessage({ tone: "ok", text: `Restored ${formatNumber(r.imported)} demo files.${r.job ? " Reading them now." : ""}` });
              } catch (e) {
                setMessage({ tone: "error", text: errorText(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            Restore demo data
          </Button>
        </div>
      )}
      {message && (
        <Notice tone={message.tone === "ok" ? "info" : "error"} className="mt-3">
          {message.text}
        </Notice>
      )}
    </Panel>
  );
}
