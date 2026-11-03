import type { MediaInfo, MediaKind } from "./api";

/** F11.8: one line for a photo, video or sound file, e.g. "Video · 0:42 · 1280×720". Mirrors backend describe(). */

const LABEL: Record<MediaKind, string> = { document: "Document", photo: "Photo", video: "Video", audio: "Audio" };

export const NOT_READ_NOTE = "Photos, video and sound are found by name, date and details, not by what is in them.";

export function kindOf(mediaType: string): MediaKind {
  if (mediaType.startsWith("image/")) return "photo";
  if (mediaType.startsWith("video/")) return "video";
  if (mediaType.startsWith("audio/")) return "audio";
  return "document";
}

export function clock(seconds: number | undefined): string | null {
  if (seconds == null) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function mediaLine(info: MediaInfo | null | undefined, kind: MediaKind): string {
  const parts: string[] = [LABEL[kind]];
  if (!info) return parts[0];
  const length = clock(info.duration_s);
  if (length) parts.push(length);
  if (info.width && info.height) parts.push(`${info.width}×${info.height}`);
  if (kind === "audio" && info.sample_rate) parts.push(`${info.sample_rate / 1000} kHz${info.channels === 2 ? " stereo" : ""}`);
  if (info.taken) parts.push(`taken ${info.taken.slice(0, 10)}`);
  if (info.camera) parts.push(info.camera);
  return parts.join(" · ");
}

/** A small type badge: Photo, Video or Audio. Documents get none. */
export function KindBadge({ kind }: { kind: MediaKind | undefined }) {
  if (!kind || kind === "document") return null;
  return (
    <span className="mr-1.5 inline-flex items-center rounded-full border border-line-strong bg-raised px-1.5 align-middle text-[10.5px] font-medium uppercase tracking-wide text-muted">
      {LABEL[kind]}
    </span>
  );
}
