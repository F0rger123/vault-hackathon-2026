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

### `GET /auth/options` (F10.11, public)
- **Response 200:** `{"demo_login": bool, "password_login": bool}`. It tells the sign-in screen which methods to show.

### `POST /auth/login` (F10.11, public)
- **Body:** `{"username", "password"}`.
- **Response 200:** `{token, username, role, expires_at}`. The token is an ordinary bearer token that expires after `VAULT_SESSION_TTL_HOURS` (default 12).
- **Errors:** 401 `wrong username or password`, the same message for an unknown user; 429 after 5 failures in a minute; 422.
- **Audit:** `auth.login`, allowed or denied.

### `POST /auth/demo-login` (F10.11, public)
- **Body:** `{"role": "admin" | "analyst" | "viewer"}`.
- **Response 200:** the same shape as `/auth/login`, for the demo user of that role.
- **Errors:** 403 unless the server runs with `VAULT_DEMO_LOGIN=true`; 404 if the demo users do not exist; 422.

### `POST /auth/logout` (F10.11)
- **Permission:** any signed-in user.
- **Response 200:** `{"signed_out": true}`. It revokes the token that made the request.

### `GET /settings/meta-api-key` (F10.11)
- **Permission:** `system:read`.
- **Response 200:** `{"configured": bool, "source": "environment" | "vault" | null}`. The key itself is never returned.

### `PUT /settings/meta-api-key` · `DELETE /settings/meta-api-key` (F10.11)
- **Permission:** `settings:write` (admin).
- **Body (PUT):** `{"key": "LLM_..."}`. It is stored in `<data_dir>/secrets/meta_api_key`; an environment key always wins.
- **Response 200:** the status above.
- **Errors:** 422 when the key does not start with `LLM_`.
- **Audit:** `settings.meta_api_key`, which records "set" or "removed", never the value.

### `GET /tokens` (F09.8)
- **Permission:** `users:manage` (admin)
- **Response 200:** `[{id, username, role, label, created_at, expires_at, revoked, revoked_at, last_used_at, expired}]`.
  - `expires_at: null` means the token never expires.
  - `last_used_at` is updated at most once a minute.
  - The token value and its hash are never returned.
- **Errors:** 401, 403

### `POST /tokens/{token_id}/revoke` (F09.8)
- **Permission:** `users:manage` (admin)
- **Response 200:** the token's metadata with `revoked: true`. Every later request with that token gets 401. Revoking an already-revoked token is a no-op and returns 200.
- **Errors:** 401, 403, 404
- **Audit:** `token.revoke`

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

### `GET /system/local-models` (F03.6)
- **Permission:** `system:read`
- **Response 200:** the installed Ollama models, each with its size, its origin (`meta`, `llama-based` or `other`) and how many copies fit on the GPU or in RAM, plus `different_models_on_gpu_together`. If Ollama is not running, `reachable` is false.

### `GET /system/model-catalog` (F03.7)
- **Permission:** `system:read`
- **Response 200:**
```json
{"models": [{"name": "llama3:8b", "title": "Llama 3 8B", "size_gb": 4.7, "memory_gb": 6.1, "reads": "text",
             "good_for": "...", "runs_on": "gpu", "installed": true}],
 "recommended": ["llama3:8b", "llama3.2-vision:11b"], "vram_gb": 8.0, "ram_gb": 31.2,
 "installs": [{"name": "llama3.2:3b", "status": "downloading", "completed": 1073741824, "total": 2019393189}],
 "active_model": "llama3:latest"}
```
`runs_on` is `gpu`, `cpu` (partly on the processor) or `too_big`. These values are estimates from download sizes. Only Meta models are listed.

### `POST /system/models/install` → 202 · `POST /system/models/install/cancel` (F03.7)
- **Permission:** `settings:write` (admin)
- **Body:** `{"name": "llama3.2:3b"}`. The name must be in the catalog; anything else returns 400 and is audited as denied.
- **Effect:** the local Ollama downloads the model in the background. Progress appears in `installs` above. Only weights come in from Ollama's library; no document data goes out. A non-local `VAULT_OLLAMA_URL` returns 400.
- **Errors:** 400, 401, 403, 422

### `PUT /settings/local-model` (F03.7)
- **Permission:** `settings:write` (admin)
- **Body:** `{"name": "llama3.1:8b"}`. It must be an installed Meta model (400 otherwise). VAULT reads with it from the next job on.
- **Response 200:** `{"active_model": "llama3.1:8b"}`

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
- **Body:** `multipart/form-data` with one or more `files` fields (max 500 per request; each up to `VAULT_MAX_UPLOAD_MB`, default 50 MB). Accepted types by content: PDF, PNG, JPEG, UTF-8 text with extension `.txt .md .csv .json .log`, and ZIP content named `.docx`, `.xlsx` or `.pptx` (stored with the Office media type). Other archives and macro-enabled Office files are rejected.
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

**Collections (F10.11):** `POST /collections` accepts `"is_demo": true`, and every Collection includes `is_demo` (0 or 1). The UI shows demo collections only in Demo mode and the others only in Real mode.

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

### `GET /training/{collection_id}` (F07.6)
- **Permission:** `findings:read`
- **Response 200:** `{report, history}`. It changes nothing.
  - `report` is `{source, graded_documents, read_documents, read_by[], fields: {train, heldout}: {field: {correct, total, rate}}, conflicts, mistakes[], readiness: {ready, reason}}`.
  - Demo collections are graded against the synthetic ground truth. Real collections are graded against labelled examples.
  - `mistakes` come from the practice set only.

### `POST /training/{collection_id}/grade` (F07.6)
- **Permission:** `jobs:create`
- **Response 200:** the same shape. The summary is also saved to `history`, which keeps the last 20.

### `GET /training/{collection_id}/suggestions` · `POST /training/{collection_id}/apply-suggestions` (F07.6)
- **Permission:** `corrections:create`
- **Suggestions:** rules from practice-set mistakes, each 100% precise on the practice set: `[{document_id, field, value, when_contains, fixes_train_docs}]`.
- **Apply:** publishes each rule as a correction with a new policy version, and returns `{applied: [...]}`. Re-read the collection to see the effect.

### `GET /collections/{collection_id}/brain` (F07.7)
- **Permission:** `documents:read`
- **Response 200:**
  - **Profile:** `documents`, `read`, `read_by`, `doc_types` (counts), `projects`, `parts`, `parties`, `markings` (each `[{"name", "documents"}]`), `date_range`, `quotes_verified`.
  - **`taught`:** counts of `meanings`, `instructions`, `rules` and `examples`.
  - **`knowledge`:** `[{"id", "kind": "meaning"|"instruction", "term", "text", "source", "created_by", "created_at"}]`.
  - **`questions`:** `[{"id": "<16 hex>", "kind": "marking"|"term"|"doc_type"|"project"|"check", "subject", "question", "document_id", "choices"}]`.
- Everything is scoped to this one collection. Rules and examples taught in another collection are not counted or used.
- **Errors:** 401, 403, 404

### `GET /collections/{collection_id}/brain/graph` (F07.8)
- **Permission:** `documents:read`
- **Response 200:** `{"nodes": [{"id": "doc:12", "kind": "document"|"project"|"doc_type"|"part"|"marking", "label", "weight", "document_id"?, "conflict"?}], "edges": [{"source", "target"}], "documents_total", "documents_shown"}`. At most 400 documents and 60 parts are included.

### `POST /collections/{collection_id}/brain/knowledge` → 201 · `DELETE /collections/{collection_id}/brain/knowledge/{knowledge_id}` (F07.7)
- **Permission:** `corrections:create`
- **Body:** `{"kind": "meaning", "term": "QA-7 stamp", "text": "Approved by the quality team"}` or `{"kind": "instruction", "text": "..."}`. Up to 500 characters. Teaching a term again replaces its meaning. Delete retires the entry; it is kept for the record but no longer used. Audited as `brain.teach` and `brain.forget`.

### `POST /collections/{collection_id}/brain/answer` · `POST /collections/{collection_id}/brain/skip` (F07.7)
- **Permission:** `corrections:create`
- **Body:** `{"gap_id": "<id from questions>", "answer": "..."}`. Only open questions are accepted (404 otherwise).
- **Effect by question kind:**
  - Markings and terms become meanings.
  - Document type and project answers become a correction plus a labelled example; a document type must be a valid type (422 otherwise).
  - Check questions are confirmed, or kept as an instruction.
- **Response 200:** `{"question", "saved_as": "meaning"|"example"|"instruction"|"confirmed", ...}`. Audited as `brain.answer`.

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

### `GET /collections/{collection_id}/records` (F08.5)
- **Permission:** `documents:read`. Each export is written to the audit log as `records.export`.
- **Query:** `format=json` (default) or `format=csv`.
- **Response 200 (json):**
```json
{"collection_id": 1, "count": 412, "columns": ["document_id", "filename", "sha256", "doc_type", "project", "doc_date",
  "title", "part_number", "description", "material", "pressure_rating_psi", "quantity", "evidence_page",
  "evidence_quote", "evidence_verified", "provider", "model", "locality"],
 "rows": [{"document_id": 12, "filename": "BOR-INS-0001.pdf", "part_number": "PV-5595", "pressure_rating_psi": 300.0,
           "evidence_page": 1, "evidence_quote": "PV-5595  Gate valve  hydrostatic test at 300 psi  - PASS",
           "evidence_verified": true, "provider": "ollama", "model": "llama3:latest", "locality": "local"}]}
```
One row per part from each document's latest extraction. A processed document with no parts still gets one row. `csv` returns the same columns as `text/csv` with `Content-Disposition: attachment`. Cells that start with `=`, `+`, `-` or `@` are prefixed with `'`, so a spreadsheet does not run them as formulas.
- **Errors:** 401, 403, 404 (unknown collection), 422 (unknown format)

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

### `POST /proposals/interpret` → 200 (F08.4)
- **Permission:** `proposals:create`
- **Body:** `{"instruction": "Group by year, then project", "provider": "ollama" | "meta_api" | "heuristic" | null, "confirm_remote": false}`. The instruction is 3–500 characters.
- **Response 200:** `{pattern, explanation, supported, provider, model, is_ai_model}`.
  - `pattern` is always one of the 15 allowed orderings of `{project}`, `{doc_type}` and `{year}`, or `"unsupported"`.
  - Model output outside that list is rejected with 502, never used.
  - Nothing is created; the client still calls `POST /proposals`.
- **Errors:** 401, 403 (permission, or remote inference disabled), 409 (remote without `confirm_remote`), 422, 502, 503.
- **Audit:** `proposal.interpret` records the provider and the chosen pattern, never the instruction.

### `POST /share-packs/interpret` (F08.6)
- **Permission:** `proposals:create`
- **Body:** `{"collection_id": 1, "instruction": "Everything on Alpha, hide names and prices", "provider": "ollama"}`. Only a local model is used; otherwise rules.
- **Response 200:** `{"criteria": {"projects", "doc_types", "include_confidential", "redact", "terms"}, "explanation", "by"}`. Creates nothing.

### `POST /share-packs` → 201 (F08.6)
- **Permission:** `proposals:create`
- **Body:** `{"collection_id": 1, "recipient": "Buyer Co", "instruction": "...", "criteria": {"projects": ["Alpha"], "doc_types": [], "include_confidential": false, "redact": ["emails", "phone_numbers", "id_numbers", "people_and_companies", "money", "terms"], "terms": ["unit cost"]}}`
- **Response 201:** a proposal with `kind: "share_pack"`. The plan lists every document as `shared`, with redaction counts, or `left_out`, with a reason.
  - Pictures and unread documents are always left out.
  - RESTRICTED, EXPORT-CONTROLLED, CUI and NUCLEAR documents are always left out.
  - CONFIDENTIAL documents are left out unless `include_confidential` is set.
- **Approving** it (`POST /proposals/{id}/approve`, admin) writes `exports/share-{id}/`:
  - redacted PDFs built from the checked text, never the original files;
  - `share-report.json` and `SHARE-REPORT.md`.
  - The result adds `left_out` and `redactions`.
- **Errors:** 401, 403, 404, 422

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
2. Update `frontend/src/lib/api.ts` in the same PR. Breaking changes need an entry in `coordination/DECISIONS.md`.
3. Additive changes (new optional field, new endpoint) are preferred over breaking ones. Never remove a field the frontend uses without a migration plan.
4. Planned additions not yet available: `POST /investigations` (F06.4), token revocation (F09.8). Do not build UI against them until they appear here.
