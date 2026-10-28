# VAULT API Contract (v1)

Source of truth: `backend/api/routes.py` and `backend/api/schemas.py`. This file must match them exactly. TypeScript types for the frontend live in `frontend/src/lib/api.ts`.

- **Base URL:** `http://127.0.0.1:8000/api/v1` (frontend reads `NEXT_PUBLIC_VAULT_API`, default `http://127.0.0.1:8000`).
- **Auth:** every route except `GET /health` requires `Authorization: Bearer <token>`. Tokens look like `vlt_...`.
- **Interactive docs:** `http://127.0.0.1:8000/docs` (FastAPI OpenAPI UI) while the server runs.
- **Timestamps:** Unix seconds as floats (`created_at`, `ts`, ...).
- **CORS:** allowed origins come from `VAULT_CORS_ORIGINS` (default `http://localhost:3000,http://127.0.0.1:3000`); methods GET, POST, PUT; headers `Authorization`, `Content-Type`.

## Getting development tokens

```bash
vault init --demo-users
```

This creates users `admin`, `analyst` and `viewer` and writes their tokens to `data/runtime/dev_tokens.json` (or `$VAULT_DATA_DIR/dev_tokens.json`). The file is git-ignored. Never commit it, paste it into issues, or show it in screenshots. To issue another token: `vault token <username> --role analyst`.

## Roles and permissions

| Permission | viewer | analyst | admin |
|---|---|---|---|
| `system:read`, `documents:read`, `search`, `findings:read`, `jobs:read` | yes | yes | yes |
| `documents:upload`, `collections:create`, `jobs:create`, `jobs:cancel`, `proposals:create`, `proposals:read`, `corrections:create` | no | yes | yes |
| `proposals:approve`, `settings:write`, `audit:read`, `users:manage` | no | no | yes |

The server enforces these. The UI may hide controls a role cannot use, but must still handle a 403.

## Error format and codes

Errors return JSON `{"detail": "<message>"}`. Validation errors (422) return FastAPI's standard `{"detail": [ {loc, msg, type}, ... ]}` list.

| Code | Meaning |
|---|---|
| 400 | Bad request that passed schema validation (unknown provider, invalid proposal pattern, empty collection for estimate) |
| 401 | Missing, malformed or invalid token. Response has `WWW-Authenticate: Bearer`. Audited as `anonymous`. |
| 403 | Authenticated but missing permission (`permission '<name>' required`), remote inference disabled, or path import outside allowed roots. Audited. |
| 404 | Resource not found (`not found`) |
| 409 | Conflict: remote provider without `confirm_remote: true`, or proposal already decided |
| 422 | Request body or query failed validation |
| 500 | Internal error. Body is always `{"detail": "internal error"}`; no exception text is returned. |
| 502 | Estimate benchmark failed for every sampled document |
| 503 | Provider unavailable (e.g. Ollama not running, model not pulled, API key not set) |

Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.

## Shared objects

**ProviderInfo**
```json
{"name": "ollama", "model": "llama3:latest", "locality": "local", "is_ai_model": true,
 "tasks": ["classification", "extraction", "summarisation"],
 "privacy": "Inference runs on this machine through Ollama. No document data leaves it.",
 "available": true, "detail": "ready"}
```
`name` is one of `ollama`, `meta_api`, `heuristic`. `heuristic` has `is_ai_model: false` and must be labelled "rule-based, not AI" in the UI. If a provider is misconfigured, the providers list may contain `{"name", "available": false, "detail"}` only.

**Job**
```json
{"id": 1, "kind": "process", "status": "running", "collection_id": 1,
 "params": {"provider": "heuristic"}, "total": 150, "done": 42, "failed": 0, "workers": 4,
 "cancel_requested": 0, "error": null, "created_by": 2, "created_at": 1761500000.0,
 "started_at": 1761500001.0, "finished_at": null,
 "items": {"done": 42, "pending": 104, "running": 4},
 "errors": [{"document_id": 7, "error": "Ollama request failed (ReadTimeout)", "attempts": 3}]}
```
`status`: `queued | running | completed | completed_with_errors | failed | cancelled`. `items` keys: `pending | running | done | failed | cancelled`. `errors` holds at most 20 entries.

**Proposal**
```json
{"id": 1, "collection_id": 1, "kind": "organize_export",
 "instruction": "Organize by project, document type and year",
 "plan": {"pattern": "{project}/{doc_type}/{year}",
          "items": [{"document_id": 1, "filename": "ALP-DWG-0001.pdf",
                     "target": "Alpha/engineering_drawing/2023/ALP-DWG-0001.pdf"}]},
 "status": "pending", "created_by": 2, "decided_by": null, "created_at": 1761500000.0,
 "decided_at": null, "result": null}
```
`status`: `pending | executed | rejected`. After approval `result` is `{"export_dir": "exports/proposal-1", "copied": 150}` (path relative to the data directory).

---

## System

### `GET /health`
- **Auth:** none.
- **Response 200:** `{"status": "ok", "version": "0.1.0"}`

### `GET /me`
- **Permission:** `system:read`
- **Response 200:** `{"username": "analyst", "role": "analyst"}`
- **Errors:** 401

### `GET /system/hardware`
- **Permission:** `system:read`
- **Response 200:**
```json
{"os": "Windows 10", "cpu_model": "Intel64 Family 6 ...", "physical_cores": 16, "logical_cores": 32,
 "ram_total_mb": 31961, "ram_available_mb": 18000, "disk_free_mb": 400000,
 "gpus": [{"name": "NVIDIA GeForce RTX 5070 Laptop GPU", "memory_mb": 8151}]}
```
`gpus` is `[]` when no NVIDIA GPU is detected. `physical_cores` may be `null`.
- **Errors:** 401, 403

### `GET /system/providers`
- **Permission:** `system:read`
- **Response 200:** `{"default": "ollama", "allow_remote_inference": false, "providers": [ProviderInfo, ...]}`. API keys are never returned.
- **Errors:** 401, 403

### `PUT /settings/remote-inference`
- **Permission:** `settings:write` (admin)
- **Body:** `{"enabled": true}`
- **Response 200:** `{"allow_remote_inference": true}`. Overrides `VAULT_ALLOW_REMOTE_INFERENCE` at runtime. Audited as `settings.remote_inference`.
- **Errors:** 401, 403, 422

### `GET /stats`
- **Permission:** `system:read`
- **Response 200:**
```json
{"collections": 1, "documents": 150, "processed": 150, "pages": 152, "bytes": 812345,
 "findings": 10, "jobs_active": 0, "proposals_pending": 0}
```
- **Errors:** 401, 403

## Collections and ingestion

### `POST /collections` → 201
- **Permission:** `collections:create`
- **Body:** `{"name": "demo", "description": ""}`. `name`: 1–80 chars matching `^[\w .-]+$`. `description`: up to 500 chars.
- **Response 201:** collection row `{"id", "name", "description", "created_by", "created_at"}`. If the name already exists, the existing collection is returned (still 201).
- **Errors:** 401, 403, 422

### `GET /collections`
- **Permission:** `documents:read`
- **Response 200:** list of `{"id", "name", "description", "created_by", "created_at", "documents", "bytes", "processed"}`. `processed` is `null` for an empty collection.
- **Errors:** 401, 403

### `POST /collections/{collection_id}/documents`
- **Permission:** `documents:upload`
- **Body:** `multipart/form-data` with one or more `files` fields (max 500 per request; each up to `VAULT_MAX_UPLOAD_MB`, default 50 MB). Accepted types by content: PDF, PNG, JPEG, UTF-8 text with extension `.txt .md .csv .json .log`.
- **Response 200:**
```json
{"accepted": [{"document_id": 1, "filename": "ALP-DWG-0001.pdf", "sha256": "…", "duplicate": false,
               "page_count": 1, "media_type": "application/pdf"}],
 "rejected": [{"filename": "invoice.pdf", "reason": "unsupported or binary file type"}]}
```
Rejections do not fail the request. `duplicate: true` means identical bytes already exist in this collection. Filenames are sanitised (directory parts removed).
- **Errors:** 401, 403, 404 (collection), 422 (no `files` field)

### `POST /collections/{collection_id}/import-path`
- **Permission:** `settings:write` (admin)
- **Body:** `{"path": "D:/archive/project-alpha", "background": false}`. The path is server-side and must sit inside `VAULT_IMPORT_ROOTS`.
- **Response 200, `background: false`:** `{"accepted": 120, "rejected": [{"filename", "reason"}]}`. The rejected list is capped at 200.
- **Response 200, `background: true` (F02.7):** a Job with `kind: "import"`.
  - `total` is the number of files found; `done` and `failed` update live while the job runs.
  - When it finishes, `params.rejected` lists up to 200 `{filename, reason}` entries.
  - `POST /jobs/{id}/cancel` stops it. After a restart it resumes, and files already stored are de-duplicated.
  - Import jobs have no model lanes, so the UI's run board lists only `kind: "process"` jobs.
- **Errors:** 401, 403 (path imports disabled, or path outside allowed roots), 404, 422

### `GET /collections/{collection_id}/inventory`
- **Permission:** `documents:read`
- **Response 200:**
```json
{"collection_id": 1,
 "by_media_type": [{"media_type": "application/pdf", "documents": 95, "bytes": 600000, "pages": 95}],
 "hardware": { ...same as /system/hardware... },
 "recommended_workers": 2,
 "reason": "local Ollama model serves one generation at a time; 2 workers overlap parsing with inference"}
```
- **Errors:** 401, 403, 404

### `POST /collections/{collection_id}/estimate`
Really processes a random sample with the chosen provider (results are saved as extractions), then projects the full runtime.
- **Permission:** `jobs:create`
- **Body:** `{"provider": "ollama" | "meta_api" | "heuristic" | null, "sample_size": 3, "confirm_remote": false}`. `sample_size` 1–20. `provider: null` uses the server default.
- **Response 200:**
```json
{"provider": ProviderInfo,
 "estimate": {"documents": 150, "sample_size": 3, "per_doc_ms_median": 7718.0, "per_doc_ms_p90": 37992.0,
              "workers": 2, "est_seconds_low": 1006.7, "est_seconds_high": 4955.5,
              "basis": "measured 3 sample document(s) on this machine"},
 "recommended_workers": 2, "reason": "…", "errors": []}
```
- **Errors:** 400 (no documents or unknown provider), 401, 403 (remote disabled), 404, 409 (remote without `confirm_remote`), 422, 502 (every sample failed), 503 (provider unavailable)

## Documents

### `GET /documents`
- **Permission:** `documents:read`
- **Query:** `collection_id` (optional), `limit` 1–500 (default 50), `offset` ≥ 0
- **Response 200:** list of `{"id", "collection_id", "filename", "sha256", "size_bytes", "media_type", "page_count", "status", "created_at"}`. `status`: `ingested | processed | error`.
- **Errors:** 401, 403, 422

### `GET /documents/{document_id}`
- **Permission:** `documents:read`
- **Response 200:** the document fields above plus `"error"` and `"extraction"` (latest, or `null`):
```json
{"provider": "ollama", "model": "llama3:latest", "locality": "local", "policy_version": 1,
 "data": {"doc_type": "inspection_report", "title": "INSPECTION REPORT", "project": "Alpha",
          "doc_date": "2023-04-12", "summary": null, "parties": [],
          "components": [{"part_number": "PV-5595", "description": "Gate valve",
                          "pressure_rating_psi": 1500.0, "material": null, "quantity": null}],
          "stamps": []},
 "evidence": [{"field": "project", "quote": "Project: Alpha", "page": 1, "verified": true}],
 "verified_ratio": 1.0,
 "injection_flags": [{"page": 1, "match": "Ignore previous instructions"}],
 "duration_ms": 7718, "created_at": 1761500000.0}
```
`doc_type` is one of `engineering_drawing, inspection_report, contract, parts_list, revision_history, project_memo, other`. `verified: false` means the quote was not found in the source text and must be shown as unverified.
- **Errors:** 401, 403, 404

### `GET /documents/{document_id}/pages/{page_no}`
- **Permission:** `documents:read`
- **Response 200:** `{"document_id": 1, "page_no": 1, "text": "…"}` (pages start at 1)
- **Errors:** 401, 403, 404

### `GET /documents/{document_id}/original`
- **Permission:** `documents:read`
- **Response 200:** the original file bytes with its media type and `Content-Disposition` filename. Browsers cannot attach the bearer header to `<img src>`/`<iframe src>`, so fetch with the header and display through an object URL. Audited as `document.download`.
- **Errors:** 401, 403, 404

### `POST /documents/{document_id}/corrections` → 201
- **Permission:** `corrections:create`
- **Body:** `{"field": "doc_type" | "project", "value": "inspection_report", "when_contains": "Field Verification Record" | null, "note": ""}`. `value` 1–80 chars; `when_contains` up to 120 chars. When `when_contains` is set, a new policy version is published with a rule `{when_contains, field, value}`. Reprocess (new job) to apply it.
- **Response 201:** `{"document_id": 5, "field": "doc_type", "old_value": "other", "new_value": "inspection_report", "policy_version": 2}` (`policy_version` is `null` when no rule was created)
- **Errors:** 401, 403, 404, 422

### `GET /policies`
- **Permission:** `documents:read`
- **Response 200:** `[{"version": 2, "rules": [{"when_contains", "field", "value"}], "created_at": …}]`
- **Errors:** 401, 403

## Jobs

### `POST /jobs` → 202
- **Permission:** `jobs:create`
- **Body:** `{"collection_id": 1, "provider": "heuristic" | "ollama" | "meta_api" | null, "workers": 4 | null, "confirm_remote": false}`. `workers` 1–32; when null the server uses `VAULT_MAX_WORKERS` or the hardware recommendation.
- **Response 202:** Job (processing starts in the background; poll `GET /jobs/{id}`).
- **Errors:** 400, 401, 403, 404, 409, 422, 503

### `GET /jobs`
- **Permission:** `jobs:read`
- **Response 200:** the 50 most recent Jobs, newest first.

### `GET /jobs/{job_id}`
- **Permission:** `jobs:read`
- **Response 200:** Job. **Errors:** 401, 403, 404
- **`estimate_check` (F03.5):** present on every Job; `null` unless the job is finished, has one lane, and an estimate for that collection and provider was made before it started.
  - Fields: `{provider, estimated_at, estimated_low_s, estimated_high_s, actual_s, within_range, actual_vs_estimate, estimated_workers, job_workers, sample_size}`.
  - The estimate is scaled to the number of documents the job processed.
  - `actual_vs_estimate` is actual time divided by the middle of the estimated range: 1.0 means exactly as estimated, and 0.5 means twice as fast.

### `POST /jobs/{job_id}/cancel`
- **Permission:** `jobs:cancel`
- **Response 200:** Job with `cancel_requested: 1`. Items already running finish; the job ends `cancelled` (or `completed` if it finished first).
- **Errors:** 401, 403, 404

## Search and findings

### `GET /search`
- **Permission:** `search`
- **Query:** `q` (≤ 300 chars, may be empty), `collection_id`, `doc_type`, `project`, `date_from`, `date_to` (`YYYY-MM-DD`), `part_number`, `limit` 1–200 (default 50). Search operators in `q` are neutralised; each word is matched literally.
- **Response 200:**
```json
{"query": "PV-5595", "count": 2,
 "results": [{"document_id": 12, "filename": "BOR-INS-0001.pdf", "media_type": "application/pdf",
              "collection_id": 1, "doc_type": "inspection_report", "project": "Borealis",
              "doc_date": "2022-03-01", "title": "INSPECTION REPORT", "page": 1,
              "snippet": "… [[PV-5595]] Gate valve hydrostatic test at 300 psi …",
              "part_numbers": ["PV-5595"], "extracted_by": "heuristic:regex-rules-v1"}]}
```
Matches in `snippet` are wrapped in `[[` and `]]`; render them as highlights and escape the rest. With empty `q`, `page` and `snippet` are `null`.
- **Errors:** 401, 403, 422

### `GET /collections/{collection_id}/findings`
- **Permission:** `findings:read`
- **Response 200:**
```json
[{"id": 1, "collection_id": 1, "kind": "rating_conflict", "key": "PV-5595",
  "summary": "PV-5595 has conflicting pressure ratings across 10 documents: 300 psi, 1500 psi",
  "status": "verified",
  "evidence": [{"document_id": 12, "filename": "BOR-INS-0001.pdf", "doc_type": "inspection_report",
                "value": 300.0, "page": 1, "quote": "PV-5595  Gate valve  hydrostatic test at 300 psi  - PASS",
                "verified": true}],
  "created_at": 1761500000.0}]
```
`status`: `verified` (every quote found verbatim) or `needs_review`. Findings are recomputed after each processing job. An unknown collection returns `[]`.
- **Errors:** 401, 403

### `POST /investigations`
Answers a natural-language question using only evidence from one collection (F06.4). Retrieval is deterministic: the question is turned into a plan (known project names, part numbers, document-type words, a year, conflict words, remaining search terms), then finding evidence and search hits become numbered sources. A Meta model writes the answer as sentences that cite source numbers; the `heuristic` provider writes a fixed template instead and is labelled `is_ai_model: false`. Every sentence is checked after generation.
- **Permission:** `search`
- **Body:** `{"collection_id": 1, "question": "Which parts in Project Alpha have conflicting pressure ratings?", "provider": "ollama" | "meta_api" | "heuristic" | null, "confirm_remote": false}`. `question` 3–500 chars.
- **Response 200:**
```json
{"question": "…", "collection_id": 1,
 "plan": {"project": "Alpha", "part_numbers": [], "doc_type": null, "year": null, "conflicts": true, "terms": ["pressure", "ratings"]},
 "answer": [{"text": "BV-7891 has a pressure rating of 600 psi and 1500 psi.", "sources": [1, 2, 3],
             "kind": "cited", "verified": true, "unsupported_numbers": []}],
 "sources": [{"id": 1, "document_id": 12, "filename": "ALP-INS-0001.pdf", "page": 1, "quote": "BV-7891 … 600 psi",
              "origin": "finding", "finding_id": 3, "value": 600.0}],
 "findings": [{"id": 3, "kind": "rating_conflict", "key": "BV-7891", "summary": "…", "status": "verified", "sources": [1, 2, 3]}],
 "withheld_local_only": 0,
 "answered_by": {"provider": "ollama", "model": "llama3:latest", "locality": "local", "is_ai_model": true},
 "duration_ms": 4021}
```
`kind: "interpretation"` means the sentence cites no valid source. `verified: false` on a cited sentence means it states a rating, date or number (≥ 100, or with decimals) that does not appear in the lines it cites; listed in `unsupported_numbers`. Show both clearly. Search-hit sources carry `doc_type`, `project`, `doc_date` instead of `finding_id`/`value`. With a remote provider, lines from documents screened `local_only` are never sent; `withheld_local_only` counts them. At most 16 sources. The question is not written to the audit log (only provider and counts).
- **Errors:** 401, 403 (no `search`, or remote disabled), 404 (collection), 409 (remote without `confirm_remote`), 422, 502 (model output failed validation or the model call failed), 503 (provider unavailable)

## Proposals (approval workflow)

### `POST /proposals` → 201
- **Permission:** `proposals:create`
- **Body:** `{"collection_id": 1, "instruction": "Organize by project, document type and year", "pattern": "{project}/{doc_type}/{year}"}`. The pattern may only use `{project}`, `{doc_type}`, `{year}` separated by `/`.
- **Response 201:** Proposal (`status: "pending"`).
- **Errors:** 400 (invalid pattern), 401, 403, 404, 422

### `GET /proposals`
- **Permission:** `proposals:read` — 50 most recent, newest first.

### `GET /proposals/{proposal_id}`
- **Permission:** `proposals:read` — **Errors:** 401, 403, 404

### `POST /proposals/{proposal_id}/approve`
- **Permission:** `proposals:approve` (admin)
- **Body:** `{"note": ""}` (≤ 500 chars)
- **Response 200:** Proposal with `status: "executed"` and `result`. Copies files into the export folder; originals are never changed.
- **Errors:** 401, 403, 404, 409 (already decided), 422

### `POST /proposals/{proposal_id}/reject`
- **Permission:** `proposals:approve` (admin)
- **Body:** `{"note": ""}`
- **Response 200:** Proposal with `status: "rejected"`.
- **Errors:** 401, 403, 404, 409, 422

## Audit

### `GET /audit`
- **Permission:** `audit:read` (admin)
- **Query:** `limit` 1–1000 (default 100), `outcome` (`allowed | denied | error`, optional)
- **Response 200:** newest first:
```json
[{"id": 9, "ts": 1761500000.0, "actor": "viewer", "action": "POST /api/v1/collections/1/documents",
  "target": null, "outcome": "denied",
  "detail": {"reason": "missing permission documents:upload", "role": "viewer"}}]
```
Known `action` values: `collection.create`, `document.upload`, `document.import_path`, `document.download`, `document.correct`, `collection.estimate`, `job.create`, `job.cancel`, `proposal.create`, `proposal.approve`, `proposal.reject`, `settings.remote_inference`, `inference.remote`, `users.create_demo`, `token.issue`, and `"<METHOD> <path>"` for authentication/authorization denials.
- **Errors:** 401, 403, 422

---

## Changing this contract

1. Any change to a route, request body or response shape needs a PR that updates this file **and** `frontend/src/lib/api.ts` in the same PR.
2. Both Luke and Franco (or their agents, with their human's OK) must review it. Breaking changes need an entry in `coordination/DECISIONS.md`.
3. Additive changes (new optional field, new endpoint) are preferred over breaking ones. Never remove a field the frontend uses without a migration plan.
4. Planned additions not yet available: `POST /investigations` (F06.4), token revocation (F09.8). Do not build UI against them until they appear here.
