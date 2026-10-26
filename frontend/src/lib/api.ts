// Typed client for the VAULT API (see coordination/API_CONTRACT.md).
// The backend enforces every permission; the UI only hides what a role cannot use.

export const API_BASE = process.env.NEXT_PUBLIC_VAULT_API ?? "http://127.0.0.1:8000";
const TOKEN_KEY = "vault.token";

export type Role = "viewer" | "analyst" | "admin";

export interface Me {
  username: string;
  role: Role;
}

export interface Stats {
  collections: number;
  documents: number;
  processed: number;
  pages: number;
  bytes: number;
  findings: number;
  jobs_active: number;
  proposals_pending: number;
}

export interface ProviderInfo {
  name: string;
  model: string;
  locality: "local" | "remote";
  is_ai_model: boolean;
  tasks: string[];
  privacy: string;
  available: boolean;
  detail: string;
}

export interface ProvidersResponse {
  default: string;
  allow_remote_inference: boolean;
  providers: ProviderInfo[];
}

export interface Collection {
  id: number;
  name: string;
  description: string | null;
  documents: number;
  bytes: number;
  processed: number | null;
  created_at: number;
}

export interface Job {
  id: number;
  kind: string;
  status: "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
  collection_id: number;
  params: { provider?: string };
  total: number;
  done: number;
  failed: number;
  workers: number;
  cancel_requested: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  items: Record<string, number>;
  errors: { document_id: number; error: string; attempts: number }[];
}

export interface Evidence {
  document_id: number;
  filename: string;
  doc_type: string;
  value: number;
  page: number | null;
  quote: string | null;
  verified: boolean;
}

export interface Finding {
  id: number;
  collection_id: number;
  kind: "rating_conflict";
  key: string;
  summary: string;
  status: "verified" | "needs_review";
  evidence: Evidence[];
  created_at: number;
}

export interface SearchResult {
  document_id: number;
  filename: string;
  media_type: string;
  collection_id: number;
  doc_type: string | null;
  project: string | null;
  doc_date: string | null;
  title: string | null;
  page: number | null;
  snippet: string | null;
  part_numbers: string[];
  extracted_by: string | null;
}

export interface AuditEntry {
  id: number;
  ts: number;
  actor: string;
  action: string;
  target: string | null;
  outcome: "allowed" | "denied" | "error";
  detail: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: token lives only in memory for this page */
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_BASE}/api/v1${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json() as Promise<T>;
}
