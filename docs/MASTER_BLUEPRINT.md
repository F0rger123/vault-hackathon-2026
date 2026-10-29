# VAULT Master Blueprint

This is the engineering design reference for VAULT. **For current status, read [`coordination/PROJECT_STATE.md`](../coordination/PROJECT_STATE.md) and [`coordination/TASKS.md`](../coordination/TASKS.md)**, because status notes in this file date from 2026-10-26. For the full product vision, read [`docs/PROJECT_VISION.md`](PROJECT_VISION.md). Other documents go deeper on single topics. If they disagree with this file, fix whichever is wrong and log the decision in `coordination/DECISIONS.md`.

- Repository: https://github.com/F0rger123/vault-hackathon-2026
- Event: Meta Global AI Developer Hackathon 2026 (Cerebral Valley), Indie track
- Team: Luke Knight, solo (Indie track), building with AI coding agents
- Status date: 2026-10-26 (day 1 of the build window)

**Labels used below**

- **Confirmed**: implemented in the repository and covered by a passing test or a manual run we recorded.
- **Planned**: designed, not built yet.
- **Assumption**: believed true, not verified.

---

## 1. Executive summary

VAULT is a private document intelligence and workflow platform. It runs on hardware the customer owns. It ingests large, messy collections (engineering drawings, inspection reports, contracts, parts lists, scanned images) and pulls structured facts out of them with a Meta model. It then finds conflicts *across* documents and shows the evidence for each one. Any change to how files are organized is only proposed; a human has to approve it before anything happens.

The MVP we are building in ten days is one thin vertical slice:

1. Import
2. Measure the hardware and benchmark the collection
3. Process with a Meta model in bounded parallel workers
4. Search, with evidence-backed findings
5. Approve or reject an organization proposal
6. Review the audit log

## 2. Elevator pitch

"Your engineering archive knows that valve PV-5595 is rated 1500 psi on the drawing but was tested at 300 psi in the field. VAULT finds that, shows you both pages, and never sends a byte off your network unless an administrator says so."

## 3. Target customers

- Engineering and manufacturing firms with decades of drawings, inspection records and supplier contracts.
- Contractors working under confidentiality obligations who cannot upload documents to a public AI service.
- Public-sector and regulated organizations. We do not claim compliance or certification for any of them.
- Document-control and QA teams who spend their days cross-referencing records by hand.

## 4. Primary use cases

- Find every document that mentions a part, project, supplier or date range.
- Detect conflicting specifications for the same part across documents. **Confirmed for pressure ratings.**
- Classify an unsorted archive by document type, project and year.
- Propose a folder structure, preview it, approve it, and export copies. **Confirmed.**
- Teach VAULT a new document layout by correcting one example. This produces a versioned rule. **Confirmed.**
- Estimate how long processing will take on this machine before committing to it. **Confirmed; the estimate is measured, not assumed.**

## 5. Problems being solved

- Information is spread across formats and naming schemes; keyword search misses alternate layouts.
- Discrepancies between documents surface late, during audits or failures.
- Cloud AI tools are off-limits for sensitive archives.
- AI answers without citations cannot be trusted for engineering decisions.
- Bulk reorganization scripts are risky and irreversible.

## 6. Competitive differentiation

| Typical RAG chatbot | VAULT |
|---|---|
| Answers one question at a time | Extracts structured facts from every document and analyses across all of them |
| Citations are optional and unchecked | Every evidence quote is checked against the source page text; unverified quotes are flagged |
| Cloud first | Local first; remote inference needs an admin to enable it **and** confirmation on each job |
| Opaque cost and duration | Hardware profile plus a measured benchmark before processing |
| Acts directly | Proposals need approval, and execution only exports copies |
| Permissions enforced in the UI | Permissions enforced on the server, and denials are audited |

## 7. Hackathon MVP (P0)

Everything below is **Confirmed** at the API/CLI level on 2026-10-26 unless marked otherwise.

- F01 Foundation: repo, backend, CLI, CI, Docker Compose, frontend scaffold.
- F02 Ingestion: upload, validation, hashing, read-only originals, PDF and text extraction. Image files record only their dimensions.
- F03 Hardware and collection analysis: profile, inventory, measured benchmark, worker recommendation.
- F04 Models: local Meta Llama 3 through Ollama (**Confirmed** working, quality needs tuning); Meta Model API provider (**Implemented, not yet exercised with a real key**); heuristic baseline.
- F05 Parallel processing: durable jobs, bounded workers, retries, cancellation, resume.
- F06 Search and findings: FTS5 with structured filters; rating conflicts with evidence.
- F07 Corrections: correction becomes a versioned policy rule, then reprocess.
- F08 Proposals: plan, approve or reject, copy-only export, audit.
- F09 Security: auth, RBAC, file validation, path containment, injection flagging, audit. Ten security tests pass.
- F10 UI: built and covered by browser tests (status in `coordination/PROJECT_STATE.md`).
- F11 Dataset and evaluation: deterministic generator plus scoring harness.
- F12 Submission: README, video, compliance review. **Planned.**

## 8. Stretch features (P2)

- Vision analysis of stamp images and scanned pages, using an image-capable Meta model (Muse Spark via the API, or Muse Glimmer locally).
- More conflict types: material, quantity, revision mismatches.
- Natural-language questions answered over the extracted facts, with citations.
- SSE or websocket progress streaming in place of polling.
- Side-by-side PDF evidence viewer with highlighted quotes.

## 9. Post-hackathon roadmap

See `docs/LONG_TERM_ROADMAP.md`. None of it is in scope before November 4.

## 10. Functional requirements

| ID | Requirement | Feature | State |
|---|---|---|---|
| FR1 | Upload PDF, PNG, JPEG and text files to a collection | F02 | Confirmed |
| FR2 | Reject files whose content does not match their extension, plus oversized, empty and corrupt files | F02/F09 | Confirmed |
| FR3 | De-duplicate by SHA-256 within a collection | F02 | Confirmed |
| FR4 | Report hardware, inventory and a measured runtime estimate | F03 | Confirmed |
| FR5 | Run extraction with a selectable provider and worker count | F04/F05 | Confirmed |
| FR6 | Show job progress; support cancel; resume after restart | F05 | Confirmed (resume is implemented but not yet covered by a test) |
| FR7 | Full-text search with doc_type, project, date and part filters, and page references | F06 | Confirmed |
| FR8 | Detect cross-document rating conflicts with verified evidence | F06 | Confirmed |
| FR9 | Record corrections and publish versioned rules | F07 | Confirmed |
| FR10 | Create, approve and reject organization proposals; export copies | F08 | Confirmed |
| FR11 | Audit every mutating action and every denial | F09 | Confirmed |
| FR12 | Browser UI covering the flows above | F10 | Scaffold only |

## 11. Nonfunctional requirements

- **Privacy:** no outbound inference by default. The local provider refuses a non-local Ollama URL.
- **Integrity:** originals are content-addressed and read-only. Exports are copies.
- **Traceability:** every extraction records the provider, model, locality, policy version and duration.
- **Performance:** an MVP target, not a guarantee. On the dev laptop, 150 documents in under 30 minutes with local Llama 3 8B. Measured: 6.8 minutes for 150 documents with prompt v3 (10.9 minutes with v1).
- **Portability:** Windows, Linux and Docker. No GPU required; the heuristic provider and CPU inference still work.
- **Recoverability:** job state lives in SQLite, and unfinished jobs resume on startup.

## 12. User journeys

1. **Analyst, first import.** Sign in, create a collection, upload, review the inventory and estimate, start processing, watch progress.
2. **Investigator.** Search for a part, open a finding, read both quoted source lines, open the original file.
3. **Document controller.** Propose "organize by project/type/year", preview the plan, ask an admin to approve, receive the export folder.
4. **Teacher.** See an alternate inspection layout misclassified, correct it with "when the document contains 'Field Verification Record'", reprocess, and see the improvement on held-out documents.
5. **Admin, security.** Review denied actions in the audit log, and decide whether to enable remote inference.

## 13. UI screens

The plan is to consolidate into six screens:

| Screen | What it shows |
|---|---|
| Dashboard | Stats, provider privacy badge, jobs, findings. Scaffold exists. |
| Import | Upload, inventory, estimate, confirm. |
| Library | Document list with filters and metadata. |
| Investigate | Search plus findings, with an evidence viewer. |
| Actions | Proposals with preview and approve/reject, for admins only. |
| Security & Settings | Providers, remote toggle, audit log. |

## 14. System architecture

See `docs/ARCHITECTURE.md`.

- **Monolith:** a FastAPI process that runs worker threads in the same process.
- **Database:** SQLite in WAL mode.
- **Storage:** local filesystem.
- **Frontend:** a Next.js client that talks only to the REST API.
- **CLI:** works directly on the same database.

## 15. Data flow

1. Upload
2. Validate
3. Hash
4. Store the read-only original
5. Extract page text
6. Insert into the FTS index
7. Create a job, with one item per document
8. Worker: run the provider, validate against the schema, apply policy rules, verify evidence, flag injection, store the extraction
9. Run collection analysis, which writes findings
10. Search, findings and proposals read the latest extraction for each document

## 16. Storage design

The SQLite schema is defined in `backend/storage/db.py`, with ordered migrations recorded in `schema_version`.

| Group | Tables |
|---|---|
| Identity | `users`, `api_tokens` (SHA-256 token hashes only) |
| Content | `collections`, `documents`, `pages`, `pages_fts` (FTS5, porter tokenizer, kept in sync by triggers) |
| Intelligence | `extractions` (JSON data and evidence, provider/model/locality, policy version), `findings` |
| Work | `jobs`, `job_items` |
| Governance | `proposals`, `audit_log`, `corrections`, `policies`, `settings_kv` |

Filesystem layout:

| Path | Contents |
|---|---|
| `data/runtime/originals/ab/<sha256>` | Read-only originals |
| `data/runtime/exports/proposal-<id>/...` | Export copies |

**Future PostgreSQL migration (Planned):** JSON columns map to JSONB, and FTS5 maps to tsvector or an external index. Every query lives in a handful of modules, so the port is contained.

## 17. Document ingestion

Implemented in `backend/ingest/service.py`.

- The file type is sniffed from its magic bytes, and the extension must agree with it.
- Uploads are capped by size (`VAULT_MAX_UPLOAD_MB`) and page count.
- PDFs are parsed with pypdf. Encrypted PDFs are rejected.
- Text files are split into 4,000-character pages.
- Images are decoded and verified with Pillow. Only their dimensions are recorded: no OCR yet, and vision is a stretch goal.
- Duplicates within a collection return the existing document.

## 18. Hardware profiling

Implemented in `backend/core/hardware.py`.

- **Measured with psutil and nvidia-smi:** CPU cores, total and available RAM, free disk, NVIDIA GPUs.
- **Worker recommendation:**
  - Heuristic: one worker per spare core, limited by free RAM.
  - Ollama: at most 2, because one local model serves one request at a time.
  - Remote: at most 8, because of rate limits.
- **Estimate:** really processes N sampled documents and projects a range: median to p90 per document, divided by the parallel speedup.

Measured on the dev laptop: RTX 5070 Laptop GPU with 8 GB, 31 GB RAM, 32 logical cores.

## 19. Worker orchestration

Implemented in `backend/workers/jobs.py`.

- One coordinator thread per job feeds a ThreadPoolExecutor of `workers` threads.
- Each item retries provider errors with exponential backoff, up to `VAULT_JOB_MAX_ATTEMPTS`.
- Unexpected errors are recorded by exception type only.
- Cancellation is cooperative and checked before each item.
- On startup, `running` items reset to `pending` and unfinished jobs restart.
- Final status is one of `completed`, `completed_with_errors`, `failed` or `cancelled`.

## 20. AI provider architecture

Implemented in `backend/providers/`.

- **Interface:** `info()` (name, model, locality, is_ai_model, tasks, privacy, available) and `extract(pages, filename, rules)`, which returns a validated `Extraction`.
- **Providers:**
  - `ollama`: local.
  - `meta_api`: remote.
  - `heuristic`: regex baseline, always labelled as *not an AI model*.
- **Isolation:** providers receive text only. They get no tools, filesystem or network, apart from their own inference endpoint.

## 21. Meta model integration

The model does the core work: classification and structured extraction (doc type, project, date, parts, pressure ratings, stamps), with evidence quotes. See `docs/MODEL_STRATEGY.md`.

- **Verified (via dev.meta.ai docs):**
  - The Meta Model API is at `https://api.meta.ai/v1` and uses bearer auth.
  - It supports OpenAI-compatible Chat Completions with `response_format: json_schema`.
  - `muse-spark-1.3` is the model ID used in Meta's examples.
- **Implemented:** `MetaModelAPIProvider`, gated on admin enablement, an API key, and per-job `confirm_remote`.
- **Locally tested:** `llama3:latest` (Meta Llama 3 8B) through Ollama with a JSON-schema-constrained format.

## 22. Local inference

Ollama on localhost.

| Model | Size | Status |
|---|---|---|
| `llama3:latest` | 8B, 4.7 GB | Default; fits the 8 GB GPU. **Confirmed** |
| `muse-glimmer:30b` | Apache-2.0, about 18 GB per its Ollama listing | Candidate quality upgrade. Would need CPU offload here. **Untested** |

No external inference traffic in this mode.

## 23. Search and retrieval

- SQLite FTS5 over page text, with bm25 ranking and snippets that carry page numbers.
- User input is reduced to quoted terms, so FTS operators cannot be injected.
- Filters come from the latest extraction for each document.

## 24. Evidence tracking

- Every extraction stores the evidence quotes the provider gave.
- `verify_evidence` checks each quote against the page text, after normalizing whitespace and case. A quote found on a different page is re-attributed to that page; a quote found nowhere is marked `verified: false`.
- Findings locate their evidence lines directly in the source pages.
- The extraction records the share of verified quotes as `verified_ratio`.

## 25. Cross-document reasoning

`backend/indexing/findings.py` groups the latest extractions by part number and compares pressure ratings. Two or more distinct values produce a `rating_conflict` finding.

- Each finding lists every document involved, with page and quote.
- Status is `verified` when every quote was located, otherwise `needs_review`.
- Analysis is deterministic over model-extracted facts, so the model proposes facts and code compares them.

## 26. Human corrections

Implemented at `POST /documents/{id}/corrections`.

- Stores the old and new value.
- With `when_contains`, it publishes a new policy version that adds a rule.
- Rules are applied after extraction, for every provider, and are also passed to model prompts as guidance.
- No model weights are trained. Improvement is measured by re-scoring the held-out split.

## 27. Organization proposals

Implemented in `backend/workers/proposals.py`.

- A pattern made from `{project}`, `{doc_type}` and `{year}` produces a per-document target path.
- Patterns are validated: no `..`, no absolute paths, no other fields.

## 28. Approval workflows

- Analysts create proposals. Only admins (`proposals:approve`) can approve or reject.
- A proposal can be decided once; a second decision returns 409.
- Approval executes immediately: a copy-only export under `exports/proposal-<id>/`.

## 29. Audit logging

- The `audit_log` table records actor, action, target, outcome (allowed, denied or error) and detail.
- Detail keys such as `token`, `api_key`, `password`, `text` and `content` are dropped before writing.
- Unauthenticated (401) and forbidden (403) requests are logged as denied.

## 30. Security architecture

See `docs/SECURITY.md`. In short:

- Bearer tokens, stored hashed.
- Server-side RBAC.
- Content-sniffed uploads.
- Path containment.
- Read-only originals.
- Remote inference gated twice.
- Schema-validated model output.
- No code path turns model output into actions.
- Localhost-only port bindings in Compose.
- Generic 500 errors.

## 31. Threat model

See `docs/THREAT_MODEL.md`. Ten test cases, S1 to S10, all passing as of 2026-10-26.

## 32. Synthetic dataset design

See `docs/DATASET_STRATEGY.md`.

- 150 fictional files from seed 2026 across five projects.
- Planted anomalies: 10 rating conflicts and 2 prompt-injection memos.
- Split: 105 train and 45 held-out.

## 33. Evaluation metrics

See `docs/EVALUATION_PLAN.md`.

- Accuracy of doc_type, project and doc_date.
- Part recall and rating accuracy.
- Evidence verification rate.
- Conflict recall and precision.
- Timing per document.

## 34. Failure handling

- **Provider errors:** retried, then the item is marked failed and the document set to `error` with a sanitized message.
- **Bad files:** rejected with a client-safe reason.
- **Unavailable provider:** 503 before the job is created.
- **Server errors:** a generic 500, with details only in server logs.
- **Restarts:** the job resumes.

## 35. Performance benchmarks

| Configuration | Measurement | Notes |
|---|---|---|
| Heuristic, 150 docs, 4 workers | About 2 s wall time end to end (CLI) | Baseline |
| Ollama `llama3:latest`, 3-doc sample | Median 7,718 ms/doc; p90 37,992 ms/doc | p90 includes first-call model load |
| Ollama `llama3:latest`, full 150 docs | Measured | Measured 2026-10-26 (prompt v3): held-out doc_type 0.956, project 0.889, date 0.917, part recall 1.000, rating accuracy 0.797; 10/10 planted conflicts, 0 false; 6.8 min for 150 docs with 2 workers. v1 and v2 results in `evaluation/results/SUMMARY.md`. |
| Meta Model API `muse-spark-1.3` | **Pending** | Needs an API key |

## 36. Testing

`pytest` runs 26 tests: unit, integration (full vertical slice) and security (S1 to S10).

Also run:

- `ruff` check and format
- `bandit`
- Frontend: lint, type check and build
- CI: the same checks, plus a dataset determinism check

## 37. Deployment

See `docs/DEPLOYMENT.md`. Three ways to run it:

- Native: uv/pip plus npm.
- Docker Compose, binding to localhost only.
- Ollama, on the host or in a Compose profile.

## 38. CLI functionality

`vault` commands:

- `init [--demo-users]`
- `token`
- `ingest`
- `hardware`
- `providers`
- `estimate`
- `process` (live progress; Ctrl-C cancels)
- `search`
- `findings`
- `serve`

## 39. Team coordination

See `AGENTS.md` and `coordination/`.

- GitHub Issues, branches named `luke/F..`, and PRs with CI.
- Markdown status files.
- No shared live memory between AI coding sessions.

## 40. Milestones

| Date | Milestone |
|---|---|
| Oct 26 | Foundation, docs, first vertical slice (backend). **Done** |
| Oct 27 | Frontend screens built against the existing API. |
| Oct 28 | First full Meta-model processing run is visible in the UI. |
| Oct 29 | Luke is working. Background progress on jobs and profiling UI. |
| Oct 30 | Search workbench and evidence viewer. |
| Oct 31 | Luke is working. Proposals and approval UI, audit viewer. |
| Nov 1 | Resource-aware tuning, security verification, evaluation runs, integration. |
| Nov 2 | **Feature freeze.** Fixes and end-to-end tests only. |
| Nov 3 | Rehearse and record the video. |
| Nov 4 | Final review. Submit and confirm receipt before 9:00 PM ET. |

## 41. Risks

| Risk | Mitigation |
|---|---|
| Official rules differ from our assumptions | Luke reads the logged-in participant guide on Oct 27; HACKATHON_COMPLIANCE.md is updated |
| Local Llama 3 8B extraction quality is weak (seen in the first sample) | Prompt tuning, few-shot rules, Meta Model API for the demo run, test Muse Glimmer |
| No Meta API key or credits | Local provider works now; heuristic baseline keeps the pipeline testable |
| The "work done during event only" rule (unverified) | All code was written from Oct 26; keep commit history honest |
| Luke's limited availability | Work is split into small, independently verifiable tasks with a stable API contract |
| Scope creep | Cut P2 features first, never the working demo |

## 42. Submission preparation

See `docs/SUBMISSION_CHECKLIST.md` and `docs/DEMO_STORYBOARD.md`.

## 43. Future enterprise scaling

See `docs/LONG_TERM_ROADMAP.md`. Main items:

- PostgreSQL and object storage
- A distributed queue and GPU worker pools
- SSO/RBAC with document-level ACLs
- Independent security audit

---

## Confirmed design decisions vs assumptions

**Confirmed decisions**

- SQLite + FTS5.
- A single process with worker threads.
- Bearer tokens.
- Copy-only exports.
- Remote inference off by default, with a two-step gate.
- Heuristic baseline kept and labelled.
- The model extracts facts; code compares them.

**Assumptions to verify**

- Final rules: video length, public repo, mandatory Meta model use.
- Whether the "Indie" track admits a two-person team.
- How credits are redeemed.
- Muse Glimmer performance on this hardware.
- Structured-output quality on `muse-spark-1.3` for our schema.

## Key tradeoffs

- **SQLite over PostgreSQL:** zero-ops local install, at the cost of write concurrency. WAL plus short transactions is enough at MVP scale.
- **Threads over a separate queue such as Redis or Celery:** fewer moving parts. The job records stay durable either way.
- **Deterministic conflict detection over free-form model reasoning:** auditable and testable, but narrower in what it can find.
- **Polling over push for progress:** simpler for the MVP.
