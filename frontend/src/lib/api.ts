// Typed client for the VAULT API (backend/api/routes.py, routes_agents.py).
// The backend enforces every permission; the UI only hides what a role cannot use.

export const API_BASE = process.env.NEXT_PUBLIC_VAULT_API ?? "http://127.0.0.1:8000";
const TOKEN_KEY = "vault.token";

export type Role = "viewer" | "analyst" | "admin";
export type ProviderName = "ollama" | "meta_api" | "heuristic";

export interface Me {
  username: string;
  role: Role;
}

const RANK: Record<Role, number> = { viewer: 0, analyst: 1, admin: 2 };
export function atLeast(me: Me | null | undefined, role: Role): boolean {
  return !!me && RANK[me.role] >= RANK[role];
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
  name: ProviderName;
  model?: string;
  locality?: "local" | "remote";
  is_ai_model?: boolean;
  tasks?: string[];
  privacy?: string;
  available: boolean;
  detail: string;
}

export interface ProvidersResponse {
  default: ProviderName;
  allow_remote_inference: boolean;
  providers: ProviderInfo[];
}

export interface Hardware {
  os: string;
  cpu_model: string;
  physical_cores: number;
  logical_cores: number;
  ram_total_mb: number;
  ram_available_mb: number;
  disk_free_mb: number;
  gpus: { name: string; memory_mb: number }[];
}

export interface CalibrationLevel {
  concurrency: number;
  documents: number;
  seconds: number;
  docs_per_minute: number;
  p50_ms: number;
  errors: number;
}

export interface Calibration {
  provider: string;
  model: string;
  locality: string;
  static_ceiling: number;
  static_reason: string;
  levels: CalibrationLevel[];
  recommended_concurrency: number;
  docs_per_minute: number;
  projections: Record<string, number | null>;
  measured_at: number;
}

export interface Capacity {
  provider: ProviderInfo;
  hardware: Hardware;
  static_ceiling: number;
  reason: string;
  calibration: Calibration | null;
}

export interface Collection {
  id: number;
  name: string;
  description: string | null;
  documents: number;
  bytes: number;
  processed: number | null;
  created_at: number;
  /** 1 for fictional demo collections, shown only in Demo mode (F10.11). */
  is_demo: number;
}

export interface AuthOptions {
  demo_login: boolean;
  password_login: boolean;
}

export interface SignedIn {
  token: string;
  username: string;
  role: Role;
  expires_at: number;
}

export interface ApiKeyStatus {
  configured: boolean;
  source: "environment" | "vault" | null;
}

export interface DocumentRow {
  id: number;
  collection_id: number;
  filename: string;
  sha256: string;
  size_bytes: number;
  media_type: string;
  page_count: number;
  status: string;
  created_at: number;
}

export interface Component {
  part_number: string | null;
  description: string | null;
  material: string | null;
  pressure_rating_psi: number | null;
  quantity: number | null;
}

export interface ExtractionEvidence {
  field: string;
  page: number | null;
  quote: string;
  verified: boolean;
}

export interface Extraction {
  provider: string;
  model: string;
  locality: "local" | "remote";
  policy_version: number;
  data: {
    doc_type?: string | null;
    project?: string | null;
    doc_date?: string | null;
    title?: string | null;
    summary?: string | null;
    parties?: string[];
    stamps?: string[];
    components?: Component[];
    [key: string]: unknown;
  };
  evidence: ExtractionEvidence[];
  verified_ratio: number;
  injection_flags: { match: string; page: number }[];
  duration_ms: number;
  created_at: number;
}

export interface DocumentDetail extends DocumentRow {
  error: string | null;
  extraction: Extraction | null;
}

export interface Screening {
  document_id: number;
  sensitivity: "none" | "internal" | "restricted";
  markings: string[];
  injection: { match: string; page: number }[];
  pii: string[];
  route: "any" | "local_only";
  screened_at: number;
}

export interface Example {
  document_id: number;
  filename: string;
  labels: Partial<Record<"doc_type" | "project" | "doc_date" | "title", string | number | null>>;
  note: string;
  created_at: number;
}

export type JobStatus = "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";

export interface LaneSpec {
  provider: ProviderName;
  concurrency: number;
}

export interface Job {
  id: number;
  kind: string;
  status: JobStatus;
  collection_id: number;
  params: { provider?: string; lanes?: LaneSpec[]; escalate_provider?: string | null };
  total: number;
  done: number;
  failed: number;
  workers: number;
  cancel_requested: number;
  error?: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  items: Record<string, number>;
  errors: { document_id: number; error: string; attempts: number }[];
  /** How the last estimate for this collection and provider compared with this run (F03.5). */
  estimate_check: EstimateCheck | null;
}

export interface EstimateCheck {
  provider: string;
  estimated_at: number;
  estimated_low_s: number;
  estimated_high_s: number;
  actual_s: number;
  within_range: boolean;
  /** Actual time divided by the middle of the estimated range: 1 is spot on, 0.5 is twice as fast. */
  actual_vs_estimate: number | null;
  estimated_workers: number;
  job_workers: number;
  sample_size: number;
}

/** A folder pattern suggested for a plain-language request (F08.4). Always one of the allowed patterns. */
export interface LayoutSuggestion {
  pattern: string;
  explanation: string;
  supported: boolean;
  provider: ProviderName;
  model: string;
  is_ai_model: boolean;
}

export const TERMINAL: JobStatus[] = ["completed", "completed_with_errors", "failed", "cancelled"];

export interface AgentEvent {
  id: number;
  job_id: number;
  ts: number;
  agent: string;
  document_id: number | null;
  action: string;
  outcome: "allowed" | "denied" | "error";
  detail: Record<string, unknown>;
}

export interface AgentSummary {
  agent: string;
  events: number;
  extracted: number;
  errors: number;
  denied: number;
  last_ts: number;
}

export interface Evidence {
  document_id: number;
  filename: string;
  doc_type: string;
  /** psi or a quantity (numbers), or a material name (F06.5). */
  value: number | string;
  page: number | null;
  quote: string | null;
  verified: boolean;
  project?: string | null;
}

export interface Finding {
  id: number;
  collection_id: number;
  kind: "rating_conflict" | "part_number_collision" | "quantity_conflict" | "material_conflict";
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

export interface SearchResponse {
  query: string;
  count: number;
  results: SearchResult[];
}

export interface InvestigationSource {
  id: number;
  document_id: number;
  filename: string;
  page: number | null;
  quote: string;
  origin: "finding" | "search";
  finding_id?: number;
  value?: number | null;
  doc_type?: string | null;
  project?: string | null;
  doc_date?: string | null;
}

export interface AnswerSentence {
  text: string;
  sources: number[];
  kind: "cited" | "interpretation";
  verified: boolean;
  unsupported_numbers: string[];
}

export interface Investigation {
  question: string;
  collection_id: number;
  plan: {
    project: string | null;
    part_numbers: string[];
    doc_type: string | null;
    year: string | null;
    conflicts: boolean;
    terms: string[];
  };
  answer: AnswerSentence[];
  sources: InvestigationSource[];
  findings: { id: number; kind: Finding["kind"]; key: string; summary: string; status: string; sources: number[] }[];
  withheld_local_only: number;
  answered_by: { provider: ProviderName; model: string; locality: "local" | "remote"; is_ai_model: boolean };
  duration_ms: number;
}

export interface Proposal {
  id: number;
  collection_id: number;
  kind: string;
  instruction: string;
  plan: { pattern?: string; items?: { document_id: number; filename: string; target: string }[] };
  status: "pending" | "executed" | "rejected";
  result: { export_dir: string; copied: number } | null;
  created_by: number | null;
  created_at: number;
  decided_by: number | null;
  decided_at: number | null;
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

export interface SecuritySummary {
  screenings: { sensitivity: string; route: string; n: number }[];
  injection_flagged: number;
  denied_actions: number;
  review: Record<string, number>;
}

export interface UploadResult {
  accepted: {
    document_id: number;
    filename: string;
    sha256: string;
    duplicate: boolean;
    page_count: number;
    media_type: string;
  }[];
  rejected: { filename: string; reason: string }[];
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

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, `Could not reach the VAULT server at ${API_BASE}. Check that the backend is running.`);
  }
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    const text = typeof detail === "string" ? detail : JSON.stringify(detail);
    if (res.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("vault:unauthorized"));
    throw new ApiError(res.status, text);
  }
  return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await request(path, init)).json() as Promise<T>;
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function put<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export function del<T>(path: string): Promise<T> {
  return api<T>(path, { method: "DELETE" });
}

export const vault = {
  me: () => api<Me>("/me"),
  stats: () => api<Stats>("/stats"),
  providers: () => api<ProvidersResponse>("/system/providers"),
  hardware: () => api<Hardware>("/system/hardware"),
  capacity: (provider: ProviderName) => api<Capacity>(`/system/capacity?provider=${provider}`),
  calibrate: (provider: ProviderName, confirm_remote = false) =>
    post<Calibration>("/system/capacity/calibrate", { provider, confirm_remote }),
  setRemote: (enabled: boolean) => put<{ allow_remote_inference: boolean }>("/settings/remote-inference", { enabled }),
  collections: () => api<Collection[]>("/collections"),
  createCollection: (name: string, is_demo: boolean) => post<Collection>("/collections", { name, is_demo }),
  authOptions: () => api<AuthOptions>("/auth/options"),
  login: (username: string, password: string) => post<SignedIn>("/auth/login", { username, password }),
  demoLogin: (role: Role) => post<SignedIn>("/auth/demo-login", { role }),
  logout: () => post<{ signed_out: boolean }>("/auth/logout", {}),
  apiKeyStatus: () => api<ApiKeyStatus>("/settings/meta-api-key"),
  setApiKey: (key: string) => put<ApiKeyStatus>("/settings/meta-api-key", { key }),
  clearApiKey: () => del<ApiKeyStatus>("/settings/meta-api-key"),
  upload: (collectionId: number, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return api<UploadResult>(`/collections/${collectionId}/documents`, { method: "POST", body: form });
  },
  documents: (collectionId: number, limit = 500, offset = 0) =>
    api<DocumentRow[]>(`/documents?collection_id=${collectionId}&limit=${limit}&offset=${offset}`),
  document: (id: number) => api<DocumentDetail>(`/documents/${id}`),
  screening: (id: number) => api<Screening>(`/documents/${id}/screening`),
  examples: () => api<Example[]>("/examples"),
  addExample: (document_id: number, labels: Example["labels"]) =>
    post<{ document_id: number; labels: Example["labels"] }>("/examples", { document_id, labels }),
  createJob: (body: {
    collection_id: number;
    lanes: LaneSpec[];
    escalate_provider?: ProviderName | null;
    confirm_remote: boolean;
  }) => post<Job>("/jobs", body),
  jobs: () => api<Job[]>("/jobs"),
  job: (id: number) => api<Job>(`/jobs/${id}`),
  cancelJob: (id: number) => post<Job>(`/jobs/${id}/cancel`, {}),
  events: (id: number, afterId: number, limit = 1000) =>
    api<AgentEvent[]>(`/jobs/${id}/events?after_id=${afterId}&limit=${limit}`),
  agents: (id: number) => api<AgentSummary[]>(`/jobs/${id}/agents`),
  search: (params: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, v);
    if (!q.has("q")) q.set("q", "");
    return api<SearchResponse>(`/search?${q.toString()}`);
  },
  findings: (collectionId: number) => api<Finding[]>(`/collections/${collectionId}/findings`),
  investigate: (collection_id: number, question: string, provider: ProviderName | null) =>
    post<Investigation>("/investigations", { collection_id, question, provider, confirm_remote: false }),
  proposals: () => api<Proposal[]>("/proposals"),
  interpretLayout: (instruction: string, provider: ProviderName) =>
    post<LayoutSuggestion>("/proposals/interpret", { instruction, provider }),
  createProposal: (collection_id: number, instruction: string, pattern: string) =>
    post<Proposal>("/proposals", { collection_id, instruction, pattern }),
  decide: (id: number, decision: "approve" | "reject", note: string) =>
    post<Proposal>(`/proposals/${id}/${decision}`, { note }),
  audit: (outcome?: string, limit = 200) =>
    api<AuditEntry[]>(`/audit?limit=${limit}${outcome ? `&outcome=${outcome}` : ""}`),
  securitySummary: () => api<SecuritySummary>("/security/summary"),
};

/** Download an original with the bearer token and open it in a new tab (links cannot carry the token). */
export async function openOriginal(documentId: number): Promise<void> {
  const win = window.open("", "_blank");
  try {
    const res = await request(`/documents/${documentId}/original`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win?.close();
    throw e;
  }
}

/** Load every document row of a collection (pages of 500). */
export async function allDocuments(collectionId: number): Promise<DocumentRow[]> {
  const out: DocumentRow[] = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const page = await vault.documents(collectionId, 500, offset);
    out.push(...page);
    if (page.length < 500) break;
  }
  return out;
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return `Your role is not allowed to do this (${e.message}).`;
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}
