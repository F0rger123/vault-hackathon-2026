"use client";

import { useEffect, useState } from "react";
import { errorText, PREVIEW_TYPES, PREVIEW_WARN_BYTES, previewOriginal, vault, type DocumentDetail } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { kindOf } from "@/lib/media";
import { useLoad } from "@/lib/use-load";
import { RedactedText } from "./classification";
import { useSession } from "./session";
import { Button, Empty, LoadError, Notice } from "./ui";

/**
 * F11.9: the original shown inside the drawer. Photos, PDFs, video and sound come from the original file (fetched with
 * the token, shown from an object URL that is revoked when the drawer closes); everything else shows the text VAULT
 * extracted. Render with key={doc.id} so each document starts fresh.
 * F09.23: a document with redactions is shown to non-admins as its redacted text only, because the original file
 * still holds what was hidden; the server refuses the original to them as well.
 */
export function DocumentPreview({ doc, tall }: { doc: DocumentDetail; tall: boolean }) {
  if (doc.status === "quarantined") {
    return (
      <Notice tone="denied">
        Held by the security gate: there is no preview until an administrator releases this file.
      </Notice>
    );
  }
  if (doc.can_open_original === false) return <TextPages doc={doc} tall={tall} />;
  if (PREVIEW_TYPES.has(doc.media_type)) return <OriginalPreview doc={doc} tall={tall} />;
  if (kindOf(doc.media_type) === "video") {
    return (
      <Notice tone="info">
        Browsers cannot play this video format ({doc.filename.split(".").pop()?.toUpperCase()}). Download the original to
        watch it in a video player.
      </Notice>
    );
  }
  return <TextPages doc={doc} tall={tall} />;
}

function OriginalPreview({ doc, tall }: { doc: DocumentDetail; tall: boolean }) {
  const big = doc.size_bytes > PREVIEW_WARN_BYTES;
  const [confirmed, setConfirmed] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unplayable, setUnplayable] = useState(false);
  const wanted = !big || confirmed;

  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    let made: string | null = null;
    previewOriginal(doc.id, doc.media_type).then(
      (u) => {
        made = u;
        if (alive) setUrl(u);
        else URL.revokeObjectURL(u);
      },
      (e: unknown) => {
        if (alive) setError(errorText(e));
      },
    );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [doc.id, doc.media_type, wanted]);

  if (!wanted) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-card border border-line bg-raised px-4 py-3 text-sm">
        <p>
          This file is {formatBytes(doc.size_bytes)}. Showing it loads the whole file into this window, which can be slow.
        </p>
        <Button onClick={() => setConfirmed(true)}>Show the preview anyway</Button>
      </div>
    );
  }
  if (error) return <Notice>Couldn&apos;t show a preview: {error}</Notice>;
  if (!url) {
    return (
      <div className="grid h-48 place-items-center rounded-card border border-line bg-raised text-sm text-muted" aria-busy>
        Loading the preview
      </div>
    );
  }
  const kind = kindOf(doc.media_type);
  if (kind === "photo") return <ImageViewer url={url} name={doc.filename} tall={tall} />;
  if (doc.media_type === "application/pdf") {
    return (
      <iframe
        src={url}
        title={`Preview of ${doc.filename}`}
        className={`w-full rounded-card border border-line bg-white ${tall ? "h-[78vh]" : "h-[60vh]"}`}
      />
    );
  }
  if (unplayable) {
    return (
      <Notice tone="info">
        This browser cannot play this {kind === "video" ? "video" : "sound"} format. Download the original to play it in
        another player.
      </Notice>
    );
  }
  if (kind === "video") {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        onError={() => setUnplayable(true)}
        className={`w-full rounded-card border border-line bg-black ${tall ? "max-h-[78vh]" : "max-h-[60vh]"}`}
      />
    );
  }
  return <audio src={url} controls preload="metadata" onError={() => setUnplayable(true)} className="w-full" />;
}

const STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/** A photo or drawing with Fit, 100 % and zoom steps. Zoomed pictures scroll inside the frame. */
function ImageViewer({ url, name, tall }: { url: string; name: string; tall: boolean }) {
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const current = zoom === "fit" ? null : zoom;
  const step = (dir: 1 | -1) => {
    const from = current ?? 1;
    const next = dir > 0 ? STEPS.find((s) => s > from) : [...STEPS].reverse().find((s) => s < from);
    if (next) setZoom(next);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Zoom">
        <Button aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>
          Fit
        </Button>
        <Button aria-pressed={zoom === 1} onClick={() => setZoom(1)}>
          100%
        </Button>
        <Button aria-label="Zoom out" onClick={() => step(-1)} disabled={current !== null && current <= STEPS[0]}>
          −
        </Button>
        <Button aria-label="Zoom in" onClick={() => step(1)} disabled={current !== null && current >= STEPS[STEPS.length - 1]}>
          +
        </Button>
        <span className="text-xs tabular-nums text-muted">
          {zoom === "fit" ? "Fit to frame" : `${Math.round(zoom * 100)}%`}
          {natural && ` · ${natural.w}×${natural.h}`}
        </span>
      </div>
      <div
        className={`overflow-auto rounded-card border border-line bg-raised ${tall ? "h-[74vh]" : "h-[56vh]"}`}
      >
        {/* An object URL made by this page; next/image cannot load those. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`Preview of ${name}`}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className={zoom === "fit" ? "block h-full w-full object-contain" : "block max-w-none"}
          style={zoom === "fit" || !natural ? undefined : { width: natural.w * zoom, height: natural.h * zoom }}
        />
      </div>
    </div>
  );
}

/** Text-like files (text, spreadsheets, Word, slides): the pages VAULT extracted, one at a time. */
function TextPages({ doc, tall }: { doc: DocumentDetail; tall: boolean }) {
  const { me } = useSession();
  const [pageNo, setPageNo] = useState(1);
  const pages = doc.page_count;
  const { data, error, status, loading } = useLoad(pages > 0 ? `page:${doc.id}:${pageNo}:${doc.redactions?.length ?? 0}` : null, () =>
    vault.page(doc.id, pageNo),
  );
  if (pages === 0) return <Empty>No text has been extracted from this file yet, so there is nothing to preview.</Empty>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>
          Extracted text, page {pageNo} of {pages}
          {data?.redacted && ", redacted for your role"}
          {me.role === "admin" && (data?.redactions.length ?? 0) > 0 && ", redacted spans outlined (only admins see them)"}
        </span>
        {pages > 1 && (
          <>
            <Button onClick={() => setPageNo((n) => Math.max(1, n - 1))} disabled={pageNo <= 1}>
              Previous page
            </Button>
            <Button onClick={() => setPageNo((n) => Math.min(pages, n + 1))} disabled={pageNo >= pages}>
              Next page
            </Button>
          </>
        )}
      </div>
      <LoadError error={error} status={status} what="this page" />
      <pre
        className={`overflow-auto whitespace-pre-wrap break-words rounded-card border border-line bg-raised px-4 py-3 font-mono text-[13px] leading-relaxed ${
          tall ? "h-[74vh]" : "max-h-[56vh]"
        }`}
        aria-busy={loading || undefined}
      >
        {data && data.page_no === pageNo ? <RedactedText page={data} admin={me.role === "admin"} /> : loading ? "Loading" : ""}
      </pre>
    </div>
  );
}
