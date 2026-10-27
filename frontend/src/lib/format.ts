import type { JobStatus, ProviderName } from "./api";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB` : `${mb} MB`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function timeAgo(ts: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.round(now - ts));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function clockTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function dateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "engineering_drawing" -> "Engineering drawing" */
export function humanize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const s = value.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const PROVIDER_LABELS: Record<string, string> = {
  ollama: "Meta Llama 3 via Ollama",
  meta_api: "Meta Model API (Muse Spark)",
  heuristic: "Rules baseline",
};

export function providerLabel(name: ProviderName | string | null | undefined): string {
  if (!name) return "Unknown model";
  return PROVIDER_LABELS[name] ?? name;
}

/** "ollama#1" -> "Lane 1", "ollama#escalation" -> "Escalation lane" */
export function laneLabel(lane: string): string {
  const [, suffix] = lane.split("#");
  if (suffix === "escalation") return "Escalation lane";
  return suffix ? `Lane ${suffix}` : lane;
}

export function laneProvider(lane: string): string {
  return lane.split("#")[0];
}

const STATUS_TEXT: Record<JobStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  completed_with_errors: "Completed with errors",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function statusText(s: JobStatus): string {
  return STATUS_TEXT[s] ?? s;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}
