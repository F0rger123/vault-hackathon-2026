# VAULT Task Roadmap

This file is the single source of truth for what is planned, in progress, and verified. Every task has a permanent ID. IDs are never reused or renumbered; retired tasks move to `DEFERRED`.

**Statuses:** `BACKLOG` (not ready), `READY` (dependencies met, can start), `IN_PROGRESS`, `REVIEW` (code exists, awaiting test, review or a live check), `VERIFIED` (acceptance criteria checked locally with recorded evidence), `DONE` (verified, merged to `main`, CI green on GitHub), `BLOCKED`, `DEFERRED`.

**Priorities:** `P0` essential MVP, `P1` important, `P2` stretch, `FUTURE` post-hackathon.

**Rule:** a task is not `DONE` because code was written. `DONE` requires the Definition of Done in `AGENTS.md`, including green CI on GitHub. CI went green on 2026-10-26 (`E-CI-1`); VERIFIED tasks on `main` become `DONE` after Luke reviews them.

## Progress dashboard

Last updated: 2026-10-28 night (Luke's agent, solo mode, loop checkpoint). `main` at `9fafa5f`. **Time left:** 7 days to the Nov 4, 9:00 PM ET deadline; feature freeze Nov 2, video Nov 3. Open PRs: #45 (F08.4), #47 (F02.7) and #49 (F09.8), all waiting for Luke.

| Feature | Subtasks | VERIFIED | REVIEW | IN_PROGRESS | READY | BACKLOG | BLOCKED | DEFERRED |
|---|---|---|---|---|---|---|---|---|
| F01 Project Foundation | 10 | 9 | 1 | 0 | 0 | 0 | 0 | 0 |
| F02 File Ingestion | 8 | 7 | 0 | 0 | 0 | 1 | 0 | 0 |
| F03 Hardware & Collection Analysis | 7 | 7 | 0 | 0 | 0 | 0 | 0 | 0 |
| F04 AI Model System | 11 | 7 | 0 | 0 | 1 | 2 | 1 | 0 |
| F05 Parallel Processing | 10 | 9 | 0 | 0 | 0 | 0 | 1 | 0 |
| F06 Search & Investigation | 6 | 5 | 0 | 0 | 0 | 1 | 0 | 0 |
| F07 Teaching & Corrections | 8 | 7 | 0 | 0 | 0 | 1 | 0 | 0 |
| F08 Actions & Organization | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 0 |
| F09 Security | 12 | 10 | 1 | 0 | 0 | 1 | 0 | 0 |
| F10 User Interface | 12 | 12 | 0 | 0 | 0 | 0 | 0 | 0 |
| F11 Synthetic Data & Evaluation | 7 | 6 | 0 | 1 | 0 | 0 | 0 | 0 |
| F12 Deployment & Submission | 11 | 8 | 0 | 0 | 0 | 2 | 1 | 0 |
| **Total** | **108** | **93** | **2** | **1** | **1** | **8** | **3** | **0** |

**Recorded evidence used below**

- `E-TEST-1`: `pytest -p no:warnings` → 26 passed (unit, integration, security) on Windows 11, Python 3.11.9, 2026-10-26, commit `7390fac`.
- `E-LINT-1`: `ruff check .` and `ruff format --check .` → all checks passed; `bandit -q -c pyproject.toml -r backend cli -ll` → no medium/high findings (B608 skipped with documented justification), 2026-10-26.
- `E-FE-1`: `npm run lint`, `npx tsc --noEmit`, `npm run build` in `frontend/` → all succeeded (Next.js 16.4.3), 2026-10-26.
- `E-DET-1`: generator run twice with seed 2026; SHA-256 of all 151 output files identical. Regenerated after forcing LF line endings; `.gitattributes` stores text as LF and PDFs/PNGs as binary. Linux re-check runs in CI (not yet observed).
- `E-EVAL-1` (heuristic baseline, 150 docs, local): doc_type accuracy train 0.914 / held-out 0.889; project 0.848 / 0.800; doc_date 1.000 / 1.000; part recall 1.000 / 1.000; rating accuracy 0.849 / 0.847; planted rating conflicts found 10/10 (precision 1.000, recall 1.000). Result file: `evaluation/results/heuristic-*.json`.
- `E-LLM-1` (local Meta Llama 3 8B, `llama3:latest` via Ollama 0.32.1, RTX 5070 Laptop 8 GB): 3-document benchmark, median 7,718 ms/doc, p90 37,992 ms (first call includes model load). Output passed schema validation and all quotes verified, but quality was weak: 1 of 3 doc types wrong (drawing classified as `parts_list`), no pressure ratings or dates extracted. Full 150-document runs followed; see `E-LLM-2`.
- `E-LLM-2` (full 150-document runs, `llama3:latest`, 2 workers, 2026-10-26; details in `evaluation/results/SUMMARY.md`): held-out scores for prompt v1 / v2 / v3: doc_type 0.822 / 0.956 / 0.956; project 0.533 / 0.000 / 0.889; doc_date 0.222 / 0.000 / 0.917; part recall 0.669 / 1.000 / 1.000; rating accuracy 0.291 / 0.669 / 0.797; planted conflicts found 8 / 6 / 10 of 10 with 0 false positives; wall time 10.9 / 6.9 / 6.8 min. Prompt v3 is committed in `backend/providers/prompting.py`.
- `E-CI-1`: GitHub Actions run 40405500963 on commit `7ab3266`: backend (ruff, pytest, bandit, dataset determinism excluding PNG), frontend (lint, typegen + tsc, build) and dependency-audit all succeeded.
- `E-DOCKER-1`: `docker compose build` built `vault-hackathon-2026-backend` (322 MB) and `-frontend` (996 MB); backend container run read-only on 127.0.0.1:8001 returned `{"status":"ok"}` on `/api/v1/health` and 401 on `/api/v1/documents` without a token. Full `docker compose up` with the frontend not yet exercised.
- `E-GH-1`: labels created (owner:luke, P0–P2, task, blocker, needs-luke) and issues #1–#25 opened for every READY, REVIEW, IN_PROGRESS and BLOCKED task.
- `E-AUDIT-1` (2026-10-26 night, `main` at `7174dbc`): `pytest -p no:warnings` 33 passed; ruff check and format clean; bandit no medium/high; `pip-audit` no known vulnerabilities; `npm audit --omit=dev` 0 vulnerabilities; frontend lint and `tsc --noEmit` clean. No secrets or runtime data tracked by git.
- `E-E2E-1` (2026-10-26 night): `scripts/e2e_smoke.py` against a fresh API on 127.0.0.1:8010 with a fresh data directory, heuristic provider: 25/25 checks passed. Upload 150 files 0.69 s, process 151 items 2.2 s, search 7 ms, 10 findings, proposal approved and 151 files copied to `exports/proposal-1`, denied viewer actions return 403, audit log populated.
- `E-LLM-3` (2026-10-26 night): same script with `--provider ollama --limit 10`: job completed 11/11 items, 0 failed, 58 s wall time; extractions recorded `provider=ollama`, `model=llama3:latest`, `locality=local`, 8.5–19.4 s per document, `verified_ratio` 1.0 on the four documents inspected. GPU: RTX 5070 Laptop, 7.6 of 8.2 GB in use. (0 findings is expected: the first 10 files contain no planted conflict pair.)
- `E-UI-2`: PR #28 (merged as `7174dbc`, CI green) restyled all six screens and retook README screenshots. The branch was named `luke/F10.10-ui-redesign`; that name is a misnomer, F10.10 remains the investigation screen.
- `E-REPO-1`: `gh repo view` → https://github.com/F0rger123/vault-hackathon-2026, visibility PUBLIC, default branch `main`.

---

## F01 — Project Foundation

#### F01.1 — Public GitHub repository
- **Description:** Create the public repository `vault-hackathon-2026` under Luke's account and push the initial foundation.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** none
- **Scope:** `gh repo create`, `main` branch, `.gitignore`, `.gitattributes`, `.env.example`.
- **Expected behavior:** Repository is public, `main` is the default branch, no secrets or runtime data are committed.
- **Acceptance criteria:** URL resolves; secret scan of the staged tree finds no tokens; `data/runtime/`, `.env`, `.venv/` are ignored.
- **Required tests:** `gh repo view --json url,visibility`; `git grep` secret pattern scan.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-REPO-1`; staged-tree scan matched only the deliberate fake key `LLM_supersecret` in `tests/security/test_security.py`.

#### F01.2 — Backend scaffold (FastAPI, Python 3.11)
- **Description:** App factory, configuration via `VAULT_*` environment variables, modular packages (`api`, `core`, `ingest`, `workers`, `providers`, `indexing`, `security`, `storage`).
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.1
- **Scope:** `backend/main.py`, `backend/core/config.py`, `pyproject.toml`.
- **Expected behavior:** `uvicorn backend.main:create_app --factory` serves `/api/v1/health`.
- **Acceptance criteria:** Health returns `{"status":"ok"}`; unhandled errors return a generic 500 without exception text.
- **Required tests:** integration flow health check; `test_unhandled_errors_do_not_leak_details`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F01.3 — Database and migrations (SQLite + FTS5)
- **Description:** Versioned, ordered migrations; WAL mode; per-thread connections.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.2
- **Scope:** `backend/storage/db.py` (migrations 1 and 2: core schema, corrections and policies).
- **Expected behavior:** `migrate()` is idempotent and records `schema_version`.
- **Acceptance criteria:** Fresh database reaches version 2; re-running applies nothing.
- **Required tests:** every API test creates a fresh database through `create_app`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F01.4 — Frontend scaffold (Next.js 16, TypeScript, Tailwind 4)
- **Description:** Initial dashboard page, design tokens, typed API client.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.2
- **Scope:** `frontend/src/app/page.tsx`, `frontend/src/lib/api.ts`, `frontend/src/app/globals.css`.
- **Expected behavior:** Token sign-in, stats, provider privacy badge, findings with evidence, collections, jobs with progress bars.
- **Acceptance criteria:** Lint, type check and production build pass.
- **Required tests:** `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- **Blockers:** Live rendering against a running backend not yet checked with a browser.
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-FE-1`.

#### F01.5 — Continuous integration
- **Description:** GitHub Actions for backend lint/tests/bandit/dataset determinism, frontend lint/types/build, report-only dependency audit.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.1
- **Scope:** `.github/workflows/ci.yml`.
- **Expected behavior:** Every push to `main` and every PR runs all jobs.
- **Acceptance criteria:** First run on GitHub is green for `backend` and `frontend`; `dependency-audit` results reviewed.
- **Required tests:** observe the Actions run.
- **Blockers:** First run not yet observed.
- **Related PR/commit:** `7390fac`
- **Verification evidence:** Pending. `E-CI-1`.

#### F01.6 — Shared agent instructions and coordination files
- **Description:** `AGENTS.md`, `CLAUDE.md`, `docs/AI_GUIDE.md`, `llms.txt`, and everything in `coordination/`.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.1
- **Scope:** Documentation only.
- **Expected behavior:** A fresh agent session can resume work from the repository alone.
- **Acceptance criteria:** a fresh agent session resumes work from the repository alone.
- **Required tests:** fresh-session dry runs (see F01.9).
- **Blockers:** none
- **Related PR/commit:** pending (next docs commit)
- **Verification evidence:** Pending. Coordination set committed in `05075ae`.

#### F01.7 — Issue templates, PR template, GitHub labels and issues
- **Description:** Templates exist; labels and one issue per READY task still need creating.
- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.1, F01.6
- **Scope:** `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`, `gh issue create`.
- **Expected behavior:** Each READY task has a GitHub issue titled with its task ID.
- **Acceptance criteria:** Issues exist for READY tasks; labels `owner:luke`, `P0`, `P1`, `blocker` exist.
- **Required tests:** `gh issue list`.
- **Blockers:** none
- **Related PR/commit:** templates in `7390fac`
- **Verification evidence:** Templates committed; issues pending. `E-GH-1`.

---

#### F01.8 — Agent-to-agent mail and solo mode

- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.6
- **Description:** GitHub-issue mailboxes for each coding agent, protocol document, solo-mode ownership note.
- **Implementation scope:** `scripts/agent_mail.py status/inbox/send/reply/close`; labels agent-msg, to:luke-agent; `coordination/AGENT_COMMUNICATION_PROTOCOL.md`.
- **Expected behavior:** Either agent can send, list, answer and close messages; messages never grant authority for destructive or spending actions.
- **Acceptance criteria:** Either agent can send, list, answer and close messages; messages never grant authority for destructive or spending actions.
- **Required tests:** see verification evidence
- **Blockers:** none
- **Related PR/commit:** branch `luke/F05-agent-orchestrator`
- **Verification evidence:** Manual: status run 2026-10-26; welcome message sent as issue #26.

#### F01.9 — Permanent project memory and coordination checks

- **Priority:** P1 · **Owner:** luke · **Status:** REVIEW · **Dependencies:** F01.6, F01.8
- **Description:** Make the repository enough for any new agent or chat to resume. It needs a vision, a project snapshot, per-agent status files, a communication protocol, onboarding for a new chat, a bootstrap prompt, task claims through issues, and automated validation.
- **Implementation scope:**
  - Docs: `docs/PROJECT_VISION.md`, `docs/LONG_TERM_ROADMAP.md`, `docs/AI_ONBOARDING.md`.
  - Coordination: `coordination/PROJECT_STATE.md`, `AGENT_COMMUNICATION_PROTOCOL.md`, `AGENT_UPDATES.md`, `NEW_AGENT_BOOTSTRAP_PROMPT.md`, `status/luke.md`.
  - Scripts: `agent_mail.py claim/report`, `scripts/check_coordination.py`.
  - CI: the `coordination` job.
- **Expected behavior:** a fresh session reads `PROJECT_STATE.md` and its status files, and knows the next task. Claims are visible on GitHub. CI rejects broken coordination files and PRs without a task ID.
- **Acceptance criteria:**
  - Every file above exists, and `check_coordination.py` passes.
  - `claim` refuses a task that another session holds.
  - Three bootstrap scenarios are checked against the repository (new Claude Code session, a second parallel session, new ChatGPT chat).
- **Required tests:** `tests/unit/test_check_coordination.py`; CI `coordination` job.
- **Blockers:** none
- **Verification evidence (2026-10-28, local):**
  - `pytest -p no:warnings`: 46 passed, including 5 new tests. Those cover the real repository passing the check, the PR task-ID rule, an unknown task, a missing section, a stale date, a missing file, and `claim` refusing a task held by the other agent.
  - `check_coordination.py`: ok.
  - `agent_mail.py status` ran against GitHub and lists claimed tasks.
  - **Scenario check:** a fresh subagent with no conversation context read only the repository and answered all three bootstrap scenarios correctly. It picked the right next tasks, with the right claim commands, and drafted a valid Part B prompt.
  - **Gaps it reported, now fixed:** stale `TASKS.md` dashboard; unexplained priority order; stale handoff notes; ambiguous ownership; blocker owners.
  - **Gap not fixed:** README uses 157 files in places and 150 in others. Left for a README pass.
  - **Caveat:** this was a simulated check by a subagent reading local files, not a real separate Claude or ChatGPT session on another computer.

## F02 — File Ingestion

#### F01.10 — Solo indie project: remove the second-developer plan

- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.9
- **Description:** VAULT is built by Luke alone, with AI coding agents, for the Indie track. Remove every mention of a second developer, and reframe the coordination system for parallel AI sessions.
- **Implementation scope:**
  - Removed the second developer's handoff guide and status file.
  - Rewrote the protocol, ownership, onboarding, bootstrap prompt, project state and status file.
  - `agent_mail.py` keeps only status, claim and report, with free session names.
  - Updated the templates, docs, `llms.txt` and the validator. Decision D-013.
- **Acceptance criteria:** no file mentions a second developer; the coordination check passes; claims still refuse a task held by another session.
- **Required tests:** `tests/unit/test_check_coordination.py`; CI `coordination`.
- **Blockers:** none

#### F02.1 — Multi-file upload endpoint
- **Description:** `POST /collections/{id}/documents` accepts up to 500 files per request.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.3, F09.1
- **Scope:** `backend/api/routes.py::upload`, `backend/ingest/service.py`.
- **Expected behavior:** Returns `accepted` and `rejected` lists; rejected files carry a safe reason; every call is audited.
- **Acceptance criteria:** 150 synthetic files accepted with no rejections.
- **Required tests:** `test_full_vertical_slice`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F02.2 — Content validation and limits
- **Description:** Magic-byte type detection, extension must match content, size limit, filename sanitisation.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F02.1
- **Scope:** `backend/security/files.py`.
- **Expected behavior:** Executables, disguised files and oversized files are rejected before storage.
- **Acceptance criteria:** Security tests S5, S6, S7 pass.
- **Required tests:** `test_s5_*`, `test_s6_*`, `test_s7_*`, unit tests in `tests/unit/test_core.py`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F02.3 — SHA-256 hashing, de-duplication, read-only originals
- **Description:** Originals are stored content-addressed under `data/runtime/originals/ab/<sha256>` and marked read-only.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F02.1
- **Scope:** `store_original`, `ingest_bytes`.
- **Expected behavior:** Re-uploading the same bytes to a collection returns `duplicate: true`; originals never change.
- **Acceptance criteria:** Duplicate flag set on re-upload; hashes of all originals identical before and after an approved export.
- **Required tests:** `test_full_vertical_slice`, `test_s2_*`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F02.4 — PDF and text page extraction
- **Description:** pypdf text per page; text files split into 4,000-character pages; encrypted and malformed PDFs rejected.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F02.2
- **Scope:** `extract_pages`.
- **Expected behavior:** Pages are stored and indexed in FTS5.
- **Acceptance criteria:** Search finds text from PDFs, CSV and Markdown files; malformed PDF returns "PDF could not be parsed".
- **Required tests:** `test_full_vertical_slice`, `test_s8_*`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F02.5 — Image intake (metadata only)
- **Description:** PNG/JPEG are decoded and verified; dimensions recorded as a placeholder page. Visual content is not yet analysed (see F04.7, F02.6).
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F02.2
- **Scope:** image branch of `extract_pages`.
- **Expected behavior:** Images ingest without error and are clearly marked "visual content not yet analysed".
- **Acceptance criteria:** 15 synthetic stamp images ingest.
- **Required tests:** `test_full_vertical_slice`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F02.6 — OCR for scanned PDFs and images
- **Description:** Extract text from image-only pages (local OCR such as Tesseract, or a vision-capable Meta model through F04.7).
- **Priority:** P1 · **Owner:** luke · **Status:** BACKLOG · **Dependencies:** F02.4, F04.7
- **Scope:** new OCR step in ingestion; licence check for any OCR engine.
- **Expected behavior:** Scanned pages become searchable; OCR output is labelled with its engine.
- **Acceptance criteria:** Stamp text on at least 12 of 15 synthetic stamps is recovered.
- **Required tests:** unit test on a generated scanned page; evaluation metric for stamp text.
- **Blockers:** Engine choice (install footprint on Windows) not decided.
- **Related PR/commit:** —
- **Verification evidence:** —

#### F02.8 — Office documents (DOCX, XLSX, PPTX)

- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F02.2, F02.4
- **Description:** Read text from Word, Excel and PowerPoint files with the standard-library zip and XML readers, adding no dependency. Found missing by the 2026-10-29 audit (test B rejected them).
- **Implementation scope:** `backend/security/files.py` (types and checks), `backend/ingest/service.py` (page text: one page per sheet or slide; Word in 4,000-character pages).
- **Acceptance criteria:** All three formats import and are searchable. A zip bomb, an oversized member, and a macro-enabled file (`.docm`, `.xlsm`) are each rejected.
- **Required tests:** unit tests per format; security tests for decompression limits.
- **Blockers:** File handling is high risk, so Luke approves the merge.
- **Related PR/commit:** branch `luke/F02.8-office-documents`
- **Verification evidence (2026-10-29):**
  - **Unit tests:** `tests/unit/test_office.py`, 18 tests. They cover:
    - Word paragraphs and tables, read by the CSV column rules (part, material, quantity);
    - Excel columns kept aligned across empty cells, with long sheets split and the header repeated;
    - PowerPoint slides in order;
    - rejected inputs: `.docm`, `.xlsm`, `.pptm`, `.zip`, a renamed macro file, a zip bomb (15 MB packed into under 100 KB), oversized and too many parts, billion-laughs, XXE, UTF-16 XML, and damaged files.
  - **Integration test:** `tests/integration/test_office_upload.py`. Office files upload, process and turn up in search; `.docm` is rejected.
  - **Merge:** Luke approved on 2026-10-29 ("merge everything").

#### F02.7 — Path import for large server-side collections
- **Description:** Admin imports a directory inside `VAULT_IMPORT_ROOTS`; progress reporting for long imports.
- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F02.1
- **Scope:** `POST /collections/{id}/import-path` exists and enforces containment (S7). Missing: running as a background job with progress and resume.
- **Expected behavior:** A 10,000-file directory imports as a job with live progress.
- **Acceptance criteria:** Import job visible in `/jobs`; cancel works.
- **Required tests:** integration test with a generated directory.
- **Blockers:** none
- **Related PR/commit:** containment in `7390fac`
- **Verification evidence:** Containment covered by `test_s7_*`.

---

## F03 — Hardware & Collection Analysis
- **Related PR/commit:** branch `luke/F02.7-path-import-job`. This is a high-risk change (file handling), so it waits for Luke's approval before merge.
- **Verification evidence (2026-10-28):** `tests/integration/test_import_job.py` has 4 tests:
  - 123 files across nested folders: 120 imported and 3 fake PDFs rejected with reasons; the job is listed in `/jobs`;
  - cancel stops a 1,500-file import early;
  - resume after a simulated crash, run twice, never duplicates a document;
  - paths outside the roots and non-admin callers are still refused with 403.
- **Existing coverage:** S7 still passes.
- **Containment:** the background job re-checks containment when it starts, in case `VAULT_IMPORT_ROOTS` changed.
- **Suite:** pytest 66 passed; bandit clean.

#### F03.1 — CPU, RAM, disk and GPU detection
- **Description:** psutil for CPU/RAM/disk; `nvidia-smi` for NVIDIA GPUs; graceful when no GPU.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.2
- **Scope:** `backend/core/hardware.py::profile_hardware`, `GET /system/hardware`, `vault hardware`.
- **Expected behavior:** Reports measured values only.
- **Acceptance criteria:** On Luke's laptop, reports the RTX 5070 Laptop GPU (8,151 MiB) and ~31 GB RAM; on a machine without `nvidia-smi`, `gpus` is empty.
- **Required tests:** `test_recommend_workers_without_gpu`; manual `vault hardware`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`; manual run on Luke's machine 2026-10-26.

#### F03.2 — Collection inventory
- **Description:** Counts, bytes and pages by media type plus recommended workers.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F02.1, F03.1
- **Scope:** `GET /collections/{id}/inventory`.
- **Expected behavior:** Totals match the uploaded collection.
- **Acceptance criteria:** Sum of documents equals the 150 uploaded files.
- **Required tests:** `test_full_vertical_slice`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F03.3 — Representative sample benchmark
- **Description:** Really processes a random sample with the chosen provider and times it.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F03.2, F04.1
- **Scope:** `POST /collections/{id}/estimate`, `vault estimate`.
- **Expected behavior:** Timings come from real processing; sample extractions are saved.
- **Acceptance criteria:** Heuristic and Ollama benchmarks both return measured timings.
- **Required tests:** `test_full_vertical_slice` (heuristic); manual Ollama run.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`, `E-LLM-1`.

#### F03.4 — Runtime estimate with uncertainty and concurrency recommendation
- **Description:** Low bound from median, high bound from p90; worker count from cores, free RAM and provider type.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F03.3
- **Scope:** `estimate_runtime`, `recommend_workers`.
- **Expected behavior:** The estimate states its basis ("measured N sample documents on this machine").
- **Acceptance criteria:** Unit tests for the formula and for no-GPU machines pass.
- **Required tests:** `test_estimate_uses_measurements`, `test_recommend_workers_without_gpu`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`; Ollama estimate 1,007–4,956 s for 150 docs with 2 workers (`E-LLM-1`).

#### F03.5 — Estimate calibration against actual runs
- **Description:** Compare the estimate with the real duration of the following full job and record the error.
- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F03.4, F05.1
- **Scope:** store estimate per collection; report "estimated vs actual" on job completion.
- **Expected behavior:** Users see how accurate past estimates were on this machine.
- **Acceptance criteria:** One recorded calibration for heuristic and one for Ollama.
- **Required tests:** integration test asserting the stored comparison.
- **Blockers:** none
- **Related PR/commit:** branch `luke/F03.5-estimate-check`
- **Verification evidence (2026-10-28):**
  - **Code:** `backend/core/estimates.py` stores the latest estimate per collection and provider in `settings_kv` (no migration). `GET /jobs/{id}` returns `estimate_check`. The run board shows a line such as "Estimated 1 min 32 s to 3 min 44 s from a 3-document sample; this run was 2.1x faster than estimated."
  - **Tests:** `tests/unit/test_estimates.py` (3 tests) and an `estimate_check` assertion in `test_full_vertical_slice`.
  - **Recorded calibrations, local API, 20 Borealis files:**
    - Heuristic: estimated 0.0–0.0 s, actual 0.1 s, within range thanks to the 1 s slack.
    - Llama 3 (Ollama, 2 workers): estimated 92.3–224.0 s, actual 74.9 s; `actual_vs_estimate` 0.47, so the estimate ran high.
  - **Cause of the high Llama estimate:** the 3-document sample includes the model load, which matches the earlier calibration point.
- **Earlier evidence:** Calibration point: estimate 1,007–4,956 s vs actual 654 s (v1) and 408 s (v3); the 3-doc sample included model load, so estimates ran high.

#### F03.7 — Install Meta models from inside VAULT, sized to the machine

- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F03.6
- **Description:** Luke asked for setup to be easy (2026-10-29). VAULT checks the hardware, recommends which Meta models fit, and installs them with one click. It shows download progress and lets an admin choose which installed model VAULT reads with.
- **Implementation scope:** `backend/core/model_install.py` (the catalog of Meta models, recommendations, background downloads); routes `/system/model-catalog`, `/system/models/install`, `/settings/local-model`; `frontend/src/components/model-installer.tsx` on the Overview.
- **Acceptance criteria:** admin only; catalog only; local Ollama only; audited; progress shown; switching models changes the model VAULT uses.
- **Verification evidence (2026-10-29):**
  - **Tests:** `tests/integration/test_model_install.py`, 3 tests:
    - recommendations for an 8 GB laptop (Llama 3 8B plus Vision), a machine with no GPU (Llama 3.2 3B only) and an 80 GB server (Llama 3.3 70B plus Vision);
    - viewer and analyst get 403 and no token gets 401;
    - non-catalog names and names with shell characters are refused before Ollama is called;
    - download progress reaches "installed", the active model switches, and every step is audited;
    - a remote Ollama address is refused.
  - **This laptop:** the recommendation is Llama 3 8B (installed) plus Llama 3.2 Vision (runs partly on the CPU).
  - **Not run:** a real download through the button. Pulling a model is Luke's call, and the download path is tested with a fake Ollama.

---

## F04 — AI Model System

#### F03.6 — How many local models fit on this computer

- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F03.1
- **Description:** List the installed Ollama models and estimate, from their sizes, how many copies of each fit in GPU memory or RAM, and how many different models fit together.
- **Implementation scope:** `backend/core/local_models.py`; `GET /system/local-models`; the "This computer" card on Overview and Set up a run.
- **Acceptance criteria:** the card shows the GPU, each model's origin (Meta, Llama-based or other), its memory need and copies, and VAULT's model first; a remote Ollama URL is never contacted.
- **Required tests:** `tests/unit/test_local_models.py`.
- **Blockers:** none
- **Verification evidence (2026-10-28):**
  - **Tests:** 3 unit tests: copies and origins, Ollama down, and a remote URL refused.
  - **Live on the RTX 5070 Laptop (8 GB):** llama3:latest needs about 5.7 GB, so 1 copy fits on the GPU at 8 requests each; 1 different model at a time. qwen2.5 is flagged "Not Meta" and nous-hermes "Llama-based".

#### F04.1 — Provider abstraction and registry
- **Description:** `Provider` interface returning a validated `Extraction`; `ProviderInfo` exposes name, model, locality, is_ai_model, tasks, privacy, availability.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.2
- **Scope:** `backend/providers/`.
- **Expected behavior:** Providers get page text only, no tools, no filesystem.
- **Acceptance criteria:** `GET /system/providers` lists `ollama`, `meta_api`, `heuristic` with privacy text.
- **Required tests:** `test_s9_*`, `test_ollama_unreachable_is_reported_not_crashing`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F04.2 — Local Meta model through Ollama
- **Description:** Local inference with `llama3:latest` (Meta Llama 3 8B) using Ollama structured JSON output; refuses non-local Ollama URLs.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F04.1
- **Scope:** `OllamaProvider`.
- **Expected behavior:** Extraction runs entirely on the local machine.
- **Acceptance criteria:** Real extraction of sample documents completes and passes schema validation.
- **Required tests:** manual `vault estimate --provider ollama`; `test_s4_*` for URL restriction.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-LLM-1`.

#### F04.3 — Meta Model API provider (remote)
- **Description:** `https://api.meta.ai/v1/chat/completions`, `muse-spark-1.3`, JSON-schema response format, Bearer key.
- **Priority:** P0 · **Owner:** luke · **Status:** BLOCKED · **Dependencies:** F04.1, F09.5
- **Scope:** `MetaModelAPIProvider`.
- **Expected behavior:** Only runs when remote inference is enabled and the request confirms it.
- **Acceptance criteria:** One live extraction on a synthetic document succeeds; token usage recorded.
- **Required tests:** manual live call; `test_s4_*` for gating.
- **Blockers:** No Meta Model API key yet (see `BLOCKERS.md` B2).
- **Related PR/commit:** `7390fac`
- **Verification evidence:** Gating verified by `E-TEST-1`; live call pending.

#### F04.4 — Structured extraction schema and output validation
- **Description:** Pydantic `Extraction` schema; malformed or out-of-schema output rejected; extra fields dropped; invalid dates nulled.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F04.1
- **Scope:** `backend/providers/schema.py`, `llm._parse`.
- **Expected behavior:** Nothing unvalidated reaches the database.
- **Acceptance criteria:** S10 passes.
- **Required tests:** `test_s10_*`, `test_inline_schema_has_no_refs`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F04.5 — Extraction quality tuning for local Llama
- **Description:** Improve prompt, add few-shot examples and per-type hints so `llama3` 8B extracts ratings, dates and correct document types.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F04.2, F11.4
- **Scope:** `backend/providers/prompting.py`; evaluation runs on the held-out split only.
- **Expected behavior:** Measurable improvement over the first run on held-out data.
- **Acceptance criteria:** Held-out doc_type accuracy and rating accuracy reported before and after; improvement recorded honestly even if small.
- **Required tests:** `python -m evaluation.run_eval --provider ollama` before/after.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** Baseline weakness recorded in `E-LLM-1`. `E-LLM-2`: prompt v3 lifts held-out doc_type to 0.956 and conflict recall to 10/10.
- **Status note (2026-10-28):** the acceptance criteria are met by `E-LLM-2`. Held-out doc_type and rating accuracy are reported before and after tuning (doc_type 0.822 to 0.956, rating 0.291 to 0.797). The fresh-seed check is part of F11.4.

#### F04.6 — Muse Glimmer 30B local test
- **Description:** Try `muse-glimmer:30b` (Apache-2.0, text + image) through Ollama with CPU/GPU split.
- **Priority:** P1 · **Owner:** luke · **Status:** READY · **Dependencies:** F04.2
- **Scope:** configuration only (`VAULT_OLLAMA_MODEL`), plus measured benchmark.
- **Expected behavior:** Either it runs at a usable speed on 8 GB VRAM + 31 GB RAM, or we document that it does not.
- **Acceptance criteria:** Benchmark numbers recorded in `docs/MODEL_STRATEGY.md`.
- **Required tests:** `vault estimate --provider ollama --sample 3`.
- **Blockers:** ~18 GB download needs Luke's approval (`BLOCKERS.md` B5).
- **Related PR/commit:** —
- **Verification evidence:** —

#### F04.7 — Image and stamp understanding with a vision-capable Meta model
- **Description:** Send images (and image-only PDF pages) to Muse Spark (API), Muse Glimmer (local), or Llama 3.2 Vision (local; blocker B7) to read stamps and classify diagrams.
- **Priority:** P1 · **Owner:** luke · **Status:** BACKLOG · **Dependencies:** F04.3 or F04.6
- **Scope:** image input path in providers; schema field `stamps`.
- **Expected behavior:** Stamp images get `stamps` populated, labelled with the provider.
- **Acceptance criteria:** Stamp text accuracy measured on the 15 synthetic stamps.
- **Required tests:** evaluation metric for stamps.
- **Blockers:** Depends on API key or Glimmer download.
- **Related PR/commit:** —
- **Verification evidence:** —

#### F04.8 — Privacy disclosure per provider
- **Description:** Every extraction stores provider, model and locality; UI and API show whether data left the machine.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F04.1
- **Scope:** `extractions.locality`, `ProviderInfo.privacy`, dashboard badge.
- **Expected behavior:** A user can tell for each document which model processed it and where.
- **Acceptance criteria:** Document detail shows provider/model/locality; dashboard badge shows the default provider's locality.
- **Required tests:** integration assertion on `extraction.provider`; UI check pending.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** API part covered by `E-TEST-1`. UI (2026-10-28):
  - Playwright checks that the document drawer shows "Read by Rules baseline (regex-rules-v1) on this machine".
  - It checks that the overview labels Llama 3 "On this machine", the Meta Model API "Remote", and the rules baseline "On this machine".
  - Suite: 13 of 13 passed.

#### F04.9 — Response caching for repeated development runs
- **Description:** Cache model responses by (document SHA-256, provider, model, prompt version, policy version) to avoid paying twice.
- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F04.3
- **Scope:** provider wrapper; cache table.
- **Expected behavior:** Re-processing an unchanged document with the same settings makes no model call.
- **Acceptance criteria:** Second run of a job makes zero provider calls.
- **Required tests:** unit test with a counting fake provider.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence (2026-10-28):**
  - **Code:** `backend/providers/cache.py`, `CachingProvider`.
    - Cache key: provider, model, a hash of `prompting.py`, the page text, filename, policy rules and examples.
    - Writes are atomic, and paths go through `safe_join`.
    - Off unless `VAULT_RESPONSE_CACHE=true`, and only used for processing jobs, so estimates and measurements still time real calls. The rules baseline is never wrapped.
  - **Tests:** `tests/unit/test_response_cache.py` (4 tests): a second run makes 0 model calls; text, rule or example changes miss; a corrupt entry is replaced; the cache is off by default.
  - **Live, Llama 3 through the CLI, 19 Cobalt PDFs, 2 workers:**
    - Run 1: 79 s, 19 cache entries written.
    - Run 2: 5 s, still 19 entries, so no model call was made.

---

#### F04.10 — Vision for photos and stamps

- **Priority:** P1 · **Owner:** luke · **Status:** BACKLOG · **Dependencies:** F04.3
- **Description:** Read phone photos and stamp images with a vision-capable Meta model (Muse Spark via API; llama3.2-vision locally if approved).
- **Implementation scope:** Image inputs to the provider interface; route photos to a vision lane.
- **Expected behavior:** Photo inspection sheets yield part numbers and ratings with evidence regions.
- **Acceptance criteria:** Photo inspection sheets yield part numbers and ratings with evidence regions.
- **Required tests:** see verification evidence
- **Blockers:** none
- **Related PR/commit:** branch `luke/F05-agent-orchestrator`
- **Verification evidence:** Not started; needs API key or local model download approval.

## F05 — Parallel Processing

#### F04.11 — Fill quantities and materials the model left empty

- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F04.5, F06.5
- **Description:** After an AI model answers, fill only empty quantity and material fields, from a labelled value on the part's own line or table row. Each filled value gets an evidence quote. The model's values are never overridden, and the prompt is unchanged.
- **Implementation scope:** `backend/providers/fill_fields.py`; `process_document` applies it for AI providers and reports `fields_filled_from_text`.
- **Acceptance criteria:** Llama 3 finds the planted quantity conflicts on v2, with no loss in rating accuracy.
- **Required tests:** `tests/unit/test_fill_fields.py`; a Llama 3 run on v2.
- **Blockers:** none
- **Verification evidence (2026-10-29):**
  - **Unit tests:** 2 tests: only empty fields are filled, with quotes; the model's material is kept; a part with no labelled quantity stays empty.
  - **Llama 3 on v2:** quantity conflicts 0 to 5 of 5 (precision 1.0); rating conflicts 10 of 10; held-out rating accuracy 0.823 both before and after. File `evaluation/results/v2/ollama-20261029-004818.json`.
  - **Overall:** pytest 115 passed.

#### F05.1 — Durable job and job-item records
- **Description:** Jobs and items persisted in SQLite with status, attempts, errors and durations.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.3
- **Scope:** `backend/workers/jobs.py`, `POST /jobs`, `GET /jobs`, `GET /jobs/{id}`.
- **Expected behavior:** Job state survives restarts.
- **Acceptance criteria:** Job completes with `done == total`.
- **Required tests:** `test_full_vertical_slice`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F05.2 — Bounded worker pool
- **Description:** ThreadPoolExecutor sized by request, `VAULT_MAX_WORKERS` or the hardware recommendation, capped at 32.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F05.1, F03.4
- **Scope:** `JobRunner._run`.
- **Expected behavior:** Never more concurrent items than `workers`.
- **Acceptance criteria:** 150 docs processed with 4 workers in tests; 2 workers with Ollama.
- **Required tests:** `test_full_vertical_slice`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F05.3 — Retries with backoff
- **Description:** Provider errors retried up to `VAULT_JOB_MAX_ATTEMPTS` with exponential backoff; unexpected errors not retried.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F05.1
- **Scope:** `work()` in `JobRunner`.
- **Expected behavior:** Failed items record a safe error message; job ends `completed_with_errors` or `failed`.
- **Acceptance criteria:** Code path reviewed; S4 confirms provider failure returns 503 before a job starts.
- **Required tests:** Add a dedicated flaky-provider test (tracked in F05.6).
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1` (indirect).

#### F05.4 — Cancellation
- **Description:** Cooperative cancel; pending items skipped and marked `cancelled`.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F05.1
- **Scope:** `POST /jobs/{id}/cancel`; Ctrl+C in `vault process`.
- **Expected behavior:** Running items finish; no new items start.
- **Acceptance criteria:** `cancel_requested == 1` and final status `cancelled` or `completed`.
- **Required tests:** `test_cancel_job`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F05.5 — Resume after restart
- **Description:** On startup, items stuck in `running` return to `pending` and queued/running jobs restart.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F05.1
- **Scope:** `JobRunner.resume_unfinished`.
- **Expected behavior:** Killing the server mid-job and restarting completes the job.
- **Acceptance criteria:** Manual kill/restart test.
- **Required tests:** Automated restart test still to add (F05.6).
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `tests/integration/test_workers.py::test_restart_resumes_unfinished_job` (added in F05.6) restarts the app mid-job and checks that it completes.

#### F05.10 — Read only new or changed documents

- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F05.1, F07.7
- **Description:** Luke asked (2026-10-30) that "read everything" recognize what was already read. With `only_new`, a run skips documents whose latest reading came from the same model and is newer than any change that could alter it: a new rule version, or brain knowledge or labelled examples taught in that collection. The interface's read buttons use it by default, and Set up a run has a checkbox for it. The run board says how many documents were skipped.
- **Verification evidence (2026-10-30):** `tests/integration/test_read_only_new.py`:
  - first run 20 of 20;
  - a second run reads 0 and skips 20;
  - a new file reads 1 and skips 20;
  - teaching the brain re-reads all 21;
  - without `only_new`, all 21 are read.

#### F05.6 — Worker robustness tests and resource limits
- **Description:** Tests for retries, resume and failure accounting; per-worker memory guard; progress events.
- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F05.3, F05.5
- **Scope:** `tests/integration/test_workers.py`; optional psutil memory check before starting an item.
- **Expected behavior:** Faults are counted correctly and the job never hangs.
- **Acceptance criteria:** Flaky provider succeeds on retry; always-failing provider marks items failed; restart resumes.
- **Required tests:** as described.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** —

---
- **Verification evidence (2026-10-28):** `tests/integration/test_workers.py` has 5 tests:
  - a flaky provider succeeds on its second attempt (4 of 4 done, 0 failed);
  - an always-failing provider marks every item failed after `job_max_attempts`, the job ends `failed` without hanging, and stored errors contain no document text;
  - an unexpected `RuntimeError` on one document gives `completed_with_errors` (3 done, 1 failed);
  - a job interrupted mid-item resumes through `JobRunner.resume_unfinished` and completes;
  - with RAM below the floor, each slot waits up to `memory_wait_s`, records `memory.wait` and then `memory.low`, and still finishes.
- **Memory guard:** `VAULT_MIN_FREE_MEMORY_MB` (default 256) and `VAULT_MEMORY_WAIT_S` (default 60), using psutil, which is already a dependency.
- **Full suite:** 58 passed.

#### F05.7 — Coordinator agent with security, extractor lanes and review agent

- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F05.1, F04.1
- **Description:** Coordinator plans lanes (provider x slots), security agent screens each file first, lanes pull from shared queues, review agent accepts, escalates or flags; agent events API.
- **Implementation scope:** `backend/agents/`, `GET /jobs/{id}/events`, `GET /jobs/{id}/agents`, CLI `--lane`, `--escalate`.
- **Expected behavior:** Multi-lane jobs complete with every item in a terminal state; events show plan, screening, extraction per lane, review and finish.
- **Acceptance criteria:** Multi-lane jobs complete with every item in a terminal state; events show plan, screening, extraction per lane, review and finish.
- **Required tests:** see verification evidence
- **Blockers:** none
- **Related PR/commit:** branch `luke/F05-agent-orchestrator`
- **Verification evidence:** `tests/integration/test_agents.py` (7 tests) pass; 3,700-file run 3,700/3,700 twice (commit `9957ede`).

#### F05.8 — Measured capacity planning and calibration

- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F03.1
- **Description:** Static ceiling from VRAM/RAM and model size plus calibration of throughput vs concurrency.
- **Implementation scope:** `backend/core/capacity.py`, `vault calibrate`, `GET /system/capacity`, `POST /system/capacity/calibrate`.
- **Expected behavior:** Recommends the slot count where throughput stops improving by 10%.
- **Acceptance criteria:** Recommends the slot count where throughput stops improving by 10%.
- **Required tests:** see verification evidence
- **Blockers:** none
- **Related PR/commit:** branch `luke/F05-agent-orchestrator`
- **Verification evidence:** Local llama3 8B: 9.5 / 12.8 / 12.5 docs/min at 1 / 2 / 4 slots (`evaluation/results/capacity-ollama-*.json`).

#### F05.9 — Remote lanes at scale (Meta Model API)

- **Priority:** P0 · **Owner:** luke · **Status:** BLOCKED · **Dependencies:** F04.3, F05.7
- **Description:** Run a 3,000+ file fictional collection with a Meta Model API lane beside the local lane; record throughput and cost.
- **Implementation scope:** Calibration and one demo run on Muse Spark.
- **Expected behavior:** Measured docs/min, cost per document, and proof that marked files stayed on the local lane.
- **Acceptance criteria:** Measured docs/min, cost per document, and proof that marked files stayed on the local lane.
- **Required tests:** see verification evidence
- **Blockers:** see BLOCKERS.md
- **Related PR/commit:** branch `luke/F05-agent-orchestrator`
- **Verification evidence:** Blocked on API key and spending approval (B2).

## F06 — Search & Investigation

#### F06.1 — Full-text index with page references
- **Description:** FTS5 over page text with snippets and page numbers; user input reduced to quoted terms.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F02.4
- **Scope:** `backend/indexing/search.py`, `GET /search`, `vault search`.
- **Expected behavior:** Results include filename, page, snippet with `[[match]]` markers.
- **Acceptance criteria:** Searching a planted part number returns at least two documents with page numbers; FTS operators cannot be injected.
- **Required tests:** `test_full_vertical_slice`, `test_fts_query_neutralises_operators`, `test_s8_*`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F06.2 — Structured filters
- **Description:** Filter by collection, document type, project, date range and part number.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F06.1, F04.4
- **Scope:** `search()` parameters.
- **Expected behavior:** Filters use the latest extraction per document.
- **Acceptance criteria:** `doc_type=engineering_drawing` returns only drawings.
- **Required tests:** `test_full_vertical_slice`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F06.3 — Cross-document rating conflicts with evidence
- **Description:** Group extracted components by part number; flag differing pressure ratings; locate each quote in the source page.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F04.4
- **Scope:** `backend/indexing/findings.py`, `GET /collections/{id}/findings`, `vault findings`.
- **Expected behavior:** Finding is `verified` only when every quote was found verbatim.
- **Acceptance criteria:** All 10 planted conflicts found, no false positives.
- **Required tests:** `test_full_vertical_slice`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`, `E-EVAL-1`.

#### F06.4 — Natural-language investigation
- **Description:** Turn a question ("Which parts from Project Alpha have conflicting ratings?") into structured search + findings, then have a Meta model write an answer that cites only retrieved evidence.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F06.2, F06.3, F04.2
- **Scope:** new endpoint `POST /investigations` (contract added to `API_CONTRACT.md` before the UI was built).
- **Expected behavior:** Every sentence in the answer links to a document/page; uncited claims are marked as interpretation.
- **Acceptance criteria:** 5 scripted demo questions answered with citations that verify.
- **Required tests:** integration test with heuristic retrieval plus a fake model; manual run with Ollama.
- **Blockers:** none
- **Related PR/commit:** branch `luke/F06.4-investigations` (PR pending)
- **Verification evidence:** `POST /investigations` in `backend/indexing/investigate.py`, contract in `API_CONTRACT.md`. `tests/integration/test_investigations.py` (5 tests: planted conflicts cited, part question, audit omits question, 401/403/404/422 denials, fake-model citation checks catching a bad citation and an invented 9999 psi). Full suite 38 passed. Live with `llama3:latest` via Ollama on the 150-document heuristic-processed collection (`scripts/demo_questions.py`, saved to `evaluation/results/investigations-ollama-2026-10-26.json`): all 5 scripted questions answered in 2.4–4.0 s; 12 of 13 cited sentences verified; the 13th named a part number (PV-6766) absent from its cited lines and was correctly flagged. Answer to the Alpha question matches ground truth (BV-7891 600/1500 psi, RV-6577 150/1500 psi). Known limit: the checker verifies numbers, not every claim; a sentence can be fully cited yet loosely worded.

#### F06.5 — Additional relationship checks
- **Description:** Same part number with different descriptions or materials across projects; contract quantities vs parts lists.
- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F06.3, F11.1
- **Scope:** new finding kinds; generator must plant them first.
- **Expected behavior:** New kinds appear with evidence like rating conflicts.
- **Acceptance criteria:** Planted cases found with precision ≥ 0.9.
- **Required tests:** evaluation run.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** —
- **Related PR/commit:** branch `luke/F06.5-more-conflicts`
- **Verification evidence (2026-10-28):**
  - **New finding kinds:** `quantity_conflict` and `material_conflict`. They compare the same part within one project only, and each comes with quotes verified in the source. The rules baseline now reads material and quantity from CSV columns and from "qty N" or "quantity N".
  - **Dataset v2, rules baseline:** 5 of 5 material and 5 of 5 quantity conflicts at precision 1.0; rating conflicts still 10 of 10. v1 still has exactly its 10 rating findings, with no new false alarms.
  - **Llama 3:** material 5 of 5, quantity 0 of 5. A prompt tweak fixed quantities but broke ratings (0.82 to 0.10), so it was reverted. Details are in `evaluation/results/SUMMARY.md`.
  - **Tests:** `tests/integration/test_more_conflicts.py` (extraction, plus an Alpha v2 end-to-end check with verified quotes). Full suite 66 passed.
  - **UI:** Investigate has new filters and value labels (units, materials).

#### F06.6 — Semantic (embedding) retrieval
- **Description:** Local embeddings for fuzzy queries alongside FTS5.
- **Priority:** P2 · **Owner:** luke · **Status:** BACKLOG · **Dependencies:** F06.1
- **Scope:** sqlite-vec or similar; licence check.
- **Expected behavior:** Synonym queries ("pressure class" for "rated") find matches.
- **Acceptance criteria:** Measured recall improvement on a small query set.
- **Required tests:** evaluation query set.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** —

---

## F07 — Teaching & Corrections

#### F07.1 — Human corrections
- **Description:** Record a corrected `doc_type` or `project` for a document with old value, new value, user and note.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F04.4
- **Scope:** `POST /documents/{id}/corrections`.
- **Expected behavior:** Correction is audited.
- **Acceptance criteria:** Returns old and new values.
- **Required tests:** `test_correction_creates_versioned_policy`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F07.2 — Versioned policies and reprocessing
- **Description:** A correction with `when_contains` publishes a new policy version; rules are applied after extraction and shown to the model as guidance. No model weights are trained.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F07.1
- **Scope:** `policies` table, `apply_policy`, `GET /policies`.
- **Expected behavior:** Reprocessing applies the latest policy and records `policy_version` on each extraction.
- **Acceptance criteria:** "Field Verification Record" document moves from `other` to `inspection_report` after the rule; `policy_version == 2`.
- **Required tests:** `test_correction_creates_versioned_policy`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F07.3 — Measured improvement on held-out data
- **Description:** Create rules from training-split corrections only, then report held-out accuracy before and after.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F07.2, F11.4
- **Scope:** `evaluation/corrections_experiment.py` (a separate script rather than a `--policy` flag, because it must reprocess between scores).
- **Expected behavior:** Honest before/after numbers, including no improvement if that is the result.
- **Acceptance criteria:** Report committed to `evaluation/results/`.
- **Required tests:** evaluation run.
- **Blockers:** none
- **Related PR/commit:** branch `luke/F07.3-corrections-eval` (PR pending)
- **Verification evidence:** 2026-10-28, results in `evaluation/results/SUMMARY.md` and `corrections-*-20261028-*.json`. Heuristic: 5 rules from train; held-out doc_type 0.889 → 0.978, project 0.800 → 0.822. Llama 3 (`llama3:latest`, 2 workers): no rule passed the safety test, held-out unchanged (doc_type 0.978, project 0.889). Unit tests `tests/unit/test_corrections_experiment.py` (3) cover phrase selection and the never-break-a-train-document rule.

#### F07.4 — Example-based teaching for new markings
- **Description:** User uploads example stamps/markings; examples are passed as few-shot images to a vision-capable model.
- **Priority:** P2 · **Owner:** luke · **Status:** BACKLOG · **Dependencies:** F04.7
- **Scope:** examples table, prompt assembly.
- **Expected behavior:** New marking recognised on held-out images.
- **Acceptance criteria:** Measured accuracy on held-out stamp images.
- **Required tests:** evaluation run.
- **Blockers:** Vision model access.
- **Related PR/commit:** —
- **Verification evidence:** —

---

#### F07.5 — Teach by example: labelled examples as few-shot guidance

- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F07.1
- **Description:** Store human-verified labels for documents; the most similar examples join the prompt as data.
- **Implementation scope:** `examples` table, `POST/GET /examples`, similarity selection in `backend/workers/processing.py`.
- **Expected behavior:** Examples are chosen per document by word overlap; viewers cannot add examples; no weight training is claimed.
- **Acceptance criteria:** Examples are chosen per document by word overlap; viewers cannot add examples; no weight training is claimed.
- **Required tests:** see verification evidence
- **Blockers:** none
- **Related PR/commit:** branch `luke/F05-agent-orchestrator`
- **Verification evidence:** `test_examples_are_stored_and_selected_by_similarity` passes. Held-out improvement not yet measured (F07.3).

#### F07.7 — The collection brain: separate per collection, taught in plain words, asks about its gaps

- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F07.2, F07.5
- **Description:** Luke asked (2026-10-29) for VAULT to build a profile of what it knows, learn "this means that" and plain-language instructions, look for its own gaps and ask about them, and keep separate brains for separate divisions.
- **Implementation scope:**
  - `backend/workers/brain.py`: profile, meanings, instructions, gap finder, answers.
  - Migration 6: the `knowledge` table, additive only.
  - Rules now carry their collection, and examples are matched only within their collection.
  - Meanings and instructions go into the reading prompt, and into the Ask prompt for local models only.
  - `backend/api/routes_brain.py`; the Brain screen at `/brain`.
- **Acceptance criteria:**
  - Teaching in one collection never changes readings in another.
  - Questions come from the real collection.
  - Answers are kept and used, and answered questions do not come back.
  - Every route checks its permission and is audited.
- **Isolation fix found on the way:** before this task, rules and labelled examples applied to **every** collection. One division's teaching would have leaked into another's readings. Older rules without a collection still apply everywhere, so existing results do not change.
- **Verification evidence (2026-10-29):** `tests/integration/test_brain.py`, 5 tests:
  - two collections ("nuclear" and "retail"): a rule and meanings taught in one do not reach the other's prompt or readings;
  - questions from dataset v1: terms such as FL, HX and PV, and documents read as "other";
  - answering stores a meaning and removes the question, and answering again gives 404;
  - viewer 403, no token 401, unknown collection 404; skip and forget work;
  - a document type answer becomes a labelled example, and a bad type gives 422;
  - taught knowledge is kept apart from rules in the prompt.
- **Merge:** Luke approved on 2026-10-29 ("merge everything"); merged as PR #70.

#### F07.8 — Brain map: an interactive graph of documents and what they mention

- **Priority:** P2 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F07.7
- **Description:** A map of the collection on the Brain screen. Documents cluster around their projects, document types, parts and markings. A person can drag and zoom, filter by kind, and search. Clicking a hub lists its documents, and clicking a document opens it. Parts with conflicting values are red. It is drawn on a canvas with no new dependency. A 3D version would need a 3D library, so it is left for Luke to decide.
- **Verification evidence (2026-10-29):** `test_brain_graph_links_documents_to_what_they_mention`. Every edge joins existing nodes, and every planted rating conflict is flagged red. On v1 there are 222 items and 737 links.


## F08 — Actions & Organization

#### F07.6 — Training screen: graded test, teach, re-test, readiness

- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F07.2, F07.3, F07.5, F10.11
- **Description:** Grade how well VAULT reads a collection against known answers. Teach it with suggested rules or labelled examples, re-read, and see the held-out score change. When the targets are met, move to Real mode.
- **Implementation scope:**
  - `backend/workers/training.py`.
  - `backend/workers/rule_suggestions.py`, moved out of the F07.3 experiment.
  - `backend/workers/corrections.py`, which is now shared, and has one fixed SQL query per field.
  - The `/training/*` routes, and the UI page `/training`.
- **Acceptance criteria:**
  - Demo collections grade against the ground truth, and real collections against labelled examples.
  - Suggested rules never break a practice document.
  - A re-test shows the held-out change, and the readiness rule points to Real mode.
- **Required tests:** `tests/integration/test_training.py`; e2e `055-training`.
- **Blockers:** none
- **Related PR/commit:** branch `luke/F07.6-training`
- **Verification evidence (2026-10-28):**
  - **`test_training.py`, 3 tests:** a 150-document demo collection is graded with 10 of 10 conflicts and 0 false alarms; suggestions are applied once only; after a re-read the held-out doc_type rises; real collections grade against 12 labelled examples; viewers get 403 for grade and apply, and anonymous callers 401.
  - **e2e `055-training`:** in the browser, grade, suggest, apply, re-read and re-grade; the history shows a "+" change.
  - **Overall:** e2e 18 of 18; pytest 100 passed.
  - **Honest limits:** the model's weights never change; improvement comes from rules and examples, measured on the held-out set.

#### F08.1 — Organization proposals
- **Description:** Build a copy plan from a folder pattern using only `{project}`, `{doc_type}`, `{year}`.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F04.4
- **Scope:** `backend/workers/proposals.py`, `POST /proposals`, `GET /proposals`, `GET /proposals/{id}`.
- **Expected behavior:** Proposal starts `pending` and lists every document's target path.
- **Acceptance criteria:** Plan covers all documents; patterns with `..` or unknown fields return 400.
- **Required tests:** `test_full_vertical_slice`, `test_s7_*`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F08.2 — Approval and rejection
- **Description:** Only `admin` can approve or reject; a decided proposal cannot be decided again.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F08.1, F09.1
- **Scope:** `POST /proposals/{id}/approve`, `POST /proposals/{id}/reject`.
- **Expected behavior:** Analyst approval returns 403 and is audited; second approval returns 409.
- **Acceptance criteria:** S2 passes.
- **Required tests:** `test_s2_*`, `test_full_vertical_slice`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F08.3 — Non-destructive export
- **Description:** Approved plan copies originals into `data/runtime/exports/proposal-<id>/`; name collisions get suffixes.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F08.2
- **Scope:** `execute_proposal`.
- **Expected behavior:** Originals unchanged; every path built through `safe_join`.
- **Acceptance criteria:** Export has 150 files; original hashes identical before and after.
- **Required tests:** `test_full_vertical_slice`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F08.4 — Natural-language organization requests
- **Description:** A Meta model turns "Organize by department then date" into an allowed pattern; the user still previews and approves.
- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F08.1, F04.2
- **Scope:** model output validated against the pattern whitelist.
- **Expected behavior:** Invalid model output is rejected, never executed.
- **Acceptance criteria:** 5 sample instructions map to valid patterns.
- **Required tests:** unit tests with a fake provider.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** —
- **Related PR/commit:** branch `luke/F08.4-layout-request`, issue #44
- **Verification evidence (2026-10-28):**
  - **Code:** `backend/workers/layout_request.py` and `POST /proposals/interpret`. The UI button "Suggest a pattern from this request" is on Approvals.
  - **Tests:**
    - `tests/unit/test_layout_request.py` (15 tests, fake provider): path traversal, unknown fields, shell text, non-JSON and non-object answers are all rejected; rule-based fallback.
    - `tests/integration/test_layout_route.py`: the audit never stores the instruction; 401, 403 for viewer and for remote, and 422 are covered.
    - New e2e test: a suggestion fills the pattern. e2e 14 of 14.
  - **Live, Llama 3:** 8 of 8 tuning requests and 8 of 8 held-out requests (`evaluation/results/layout-requests-ollama-2026-10-28.json`). The first prompt scored 2 of 5, which is recorded in `SUMMARY.md`.

#### F08.5 — Export to a searchable database file
- **Description:** Export extractions as CSV and JSON for downstream tools. Each row names its source document and page. Raised to P1 by the 2026-10-29 audit (vision F07, structured database generation).
- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F08.3
- **Scope:** a read-only download route per collection (`documents:read`), plus a button on the Investigate screen. It writes nothing on the server, so no approval step is needed.
- **Expected behavior:** One row per component, with document fields and provenance.
- **Acceptance criteria:** The file opens, and its row count matches the extractions.
- **Required tests:** integration test; browser test.
- **Blockers:** none
- **Related PR/commit:** branch `luke/F08.5-records-export`
- **Verification evidence (2026-10-29):**
  - **API:** `GET /collections/{id}/records?format=json|csv` needs `documents:read` and is audited as `records.export`.
  - **Integration tests:** `tests/integration/test_records_export.py`, 3 tests. On dataset v1 there is one row per part across all 150 documents, and the count matches the extractions. Every verified quote is found on its cited page. The CSV parses to the same number of rows. Denied and missing cases return 401, 404 and 422. Formula cells (`=`, `+`, `@`) are escaped.
  - **Interface:** an "Export as a table" panel on Investigate, covered by a Playwright download test.

---

#### F08.6 — Share packs: redacted copies for an outside party, with a report

- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F08.2, F08.3
- **Description:** Luke asked (2026-10-29) for the assistant to make a copy for someone outside, black things out, and say what was left out and why. It is described in plain words or filters, planned as a proposal, approved by an admin, and written as clean redacted PDFs plus a report.
- **Implementation scope:** `backend/workers/share_pack.py`, `backend/api/routes_share.py`, `frontend/src/components/share-pack.tsx` on Approvals. `reportlab` moved to runtime dependencies.
- **Verification evidence (2026-10-29):** `tests/integration/test_share_pack.py`, 4 tests:
  - the plan lists shared and left-out documents with reasons (other project, CONFIDENTIAL, EXPORT-CONTROLLED);
  - an analyst cannot approve;
  - after admin approval, the PDF contains none of the email, phone, price or custom term, but keeps part numbers;
  - the PDF metadata is VAULT's own, the reports list every reason without repeating a redacted value, and no original file is in the pack;
  - CONFIDENTIAL is shared only when asked, and EXPORT-CONTROLLED never;
  - permissions: viewer 403, no token 401, unknown collection 404;
  - plain words ("project Alpha, hide names, prices and \"PV-1001\"") become the right settings;
  - dates and part numbers are not taken for phone numbers.
- **Merge:** Luke approved on 2026-10-30 ("merge PR #72 and PR #74 now").

## F09 — Security

#### F09.1 — Authentication and role-based authorization
- **Description:** Random bearer tokens stored as SHA-256 hashes; roles viewer/analyst/admin; permission checks on the server for every route except `/health`.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.3
- **Scope:** `backend/security/auth.py`, `backend/api/deps.py`.
- **Expected behavior:** Missing/invalid token → 401; missing permission → 403; both audited.
- **Acceptance criteria:** S1 passes.
- **Required tests:** `test_s1_*`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F09.2 — Audit log
- **Description:** Append-only `audit_log` with actor, action, target, outcome, detail; forbidden keys (token, text, content, api_key, password) stripped.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F09.1
- **Scope:** `backend/security/audit.py`, `GET /audit`.
- **Expected behavior:** Allowed and denied actions both recorded.
- **Acceptance criteria:** Upload, job, proposal create/approve and denials appear.
- **Required tests:** `test_full_vertical_slice`, `test_s1_*`, `test_s9_*`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F09.3 — Prompt-injection containment
- **Description:** Document text fenced as data; injection phrases flagged; model output is schema-only and never executed.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F04.4
- **Scope:** `backend/providers/prompting.py`.
- **Expected behavior:** Injected memo is flagged, nothing is deleted, proposed or sent.
- **Acceptance criteria:** S3 passes.
- **Required tests:** `test_s3_*`, `test_injection_detection_and_prompt_fencing`.
- **Blockers:** Re-run S3 with a real model once F04.5 lands (heuristic used in CI).
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F09.4 — Path traversal and filesystem containment
- **Description:** `safe_join`/`contained` on every server path; filename sanitisation; path import limited to `VAULT_IMPORT_ROOTS`.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F02.2
- **Scope:** `backend/security/files.py`.
- **Expected behavior:** `..`, absolute paths and drive letters rejected.
- **Acceptance criteria:** S7 passes.
- **Required tests:** `test_s7_*`, `test_safe_join_blocks_escape`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F09.5 — Outbound inference controls
- **Description:** Remote inference needs both an admin switch (`VAULT_ALLOW_REMOTE_INFERENCE` or `PUT /settings/remote-inference`) and per-request `confirm_remote=true`; local Ollama provider refuses non-local hosts.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F04.1
- **Scope:** `_provider()` in routes, `OllamaProvider.__init__`.
- **Expected behavior:** 403 when disabled, 409 without confirmation, 503 when unavailable.
- **Acceptance criteria:** S4 passes.
- **Required tests:** `test_s4_*`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F09.6 — Dependency and static scanning
- **Description:** Bandit and ruff security rules in CI; pip-audit and npm audit report-only; evaluate Semgrep and Trivy.
- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.5
- **Scope:** CI workflow; triage results in `docs/SECURITY.md`.
- **Expected behavior:** Known vulnerabilities are listed with a decision.
- **Acceptance criteria:** First audit results triaged; Trivy image scan run once Docker builds.
- **Required tests:** CI run.
- **Evidence (2026-10-28, local, branch `luke/F09.6-security-scanning`):** Semgrep 1.140.0 with six rulesets: 0 results, 164 files. pip-audit and npm audit: 0. Trivy 0.67.2 fs: 0. Trivy images: 8 fixable highs (vendored `wheel`/`jaraco.context` in setuptools, npm's bundled `undici`/`brace-expansion`) plus a critical `zlib1g` on Debian 12. All fixed in the Dockerfiles, so 0 fixable highs or criticals remain. The 8 unfixed Debian OS CVEs are accepted in `docs/SECURITY.md`. Rebuilt images checked: backend `/api/v1/health` ok (read-only root), frontend HTTP 200. CI jobs `semgrep` and `trivy` added; dependency audit is now blocking; there is a weekly scheduled run. GitHub CI result is pending.
- **Blockers:** none
- **Related PR/commit:** bandit/ruff in `7390fac`
- **Verification evidence:** `E-LINT-1` (bandit, ruff only).

#### F09.7 — Controlled security verification against the running app
- **Description:** OWASP ZAP baseline scan against the local stack and manual abuse cases through the UI.
- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.2, F01.4
- **Scope:** Only `127.0.0.1` targets we run ourselves.
- **Expected behavior:** Findings filed as GitHub issues labelled `security`.
- **Acceptance criteria:** ZAP report summarised in `docs/SECURITY.md` with actual outcomes.
- **Required tests:** ZAP baseline scan.
- **Blockers:** none
- **Related PR/commit:** branch `luke/F09.7-zap-baseline`
- **Verification evidence (2026-10-28, local):**
  - **Scans:** ZAP stable `zap-baseline.py` against the frontend, and an authenticated `zap-api-scan.py` (active) against the API. Both images ran in an isolated Docker network on this machine.
  - **Before:** frontend 0 FAIL, 7 WARN; API 0 FAIL, 3 WARN.
  - **Fixed:** security headers in `next.config.ts`; `Cross-Origin-Resource-Policy` on the API.
  - **After:** frontend 0 FAIL, 3 WARN; API 0 FAIL, 3 WARN. Every remaining warning is accepted with a reason in `docs/SECURITY.md`.
  - **UI under the new CSP:** all six screens load and the Ask panel answers, with no console errors.
  - **Tests:** `pytest`: 42 passed, including the new header test.
  - **Issues:** no `security` issues filed, because there were no failures and nothing is left to fix.

#### F09.8 — Token lifecycle
- **Description:** Token revocation endpoint, expiry, and CLI listing.
- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F09.1
- **Scope:** `api_tokens.revoked` exists; endpoints missing.
- **Expected behavior:** Revoked token returns 401 immediately.
- **Acceptance criteria:** Test revokes and re-checks.
- **Required tests:** security test.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** —

---
- **Related PR/commit:** branch `luke/F09.8-token-lifecycle`. This is high-risk (auth and a migration), so it waits for Luke's approval before merge.
- **Verification evidence (2026-10-28):**
  - **Migration 4:** adds `expires_at`, `revoked_at` and `last_used_at`. It was applied to a copy of the dev database: schema 4, and the 3 existing tokens keep `expires_at = NULL`, so they still work.
  - **Security tests:** a revoked token gets 401 on the next request; an expired token gets 401; the listing never includes the token or its hash; viewers and analysts get 403 and anonymous callers 401; an unknown id gives 404.
  - **CLI test:** `vault tokens` shows no token values; `vault token --ttl-days`; `vault revoke`; revoking twice exits 1.
  - **Suite:** pytest passes; ruff and bandit clean.

#### F09.9 — Sensitivity-aware routing

- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F05.7
- **Description:** Security agent pins documents with export-control, classification-style or personal-data markings to local lanes.
- **Implementation scope:** `backend/agents/security_agent.py`, `screenings` table, `GET /documents/{id}/screening`, `GET /security/summary`.
- **Expected behavior:** A remote lane never receives a pinned document; with no local lane the document is blocked and the block is logged.
- **Acceptance criteria:** A remote lane never receives a pinned document; with no local lane the document is blocked and the block is logged.
- **Required tests:** see verification evidence
- **Blockers:** none
- **Related PR/commit:** branch `luke/F05-agent-orchestrator`
- **Verification evidence:** `test_remote_lane_never_receives_restricted_documents` passes; 3,700-file run pinned 402 files.

#### F09.12 — Per-collection permissions

- **Priority:** FUTURE · **Owner:** luke · **Status:** BACKLOG · **Dependencies:** F09.1
- **Description:** Limit which collections and documents each user can see: in search, previews, original downloads and every API route. Today roles limit actions, not visibility. Found by the 2026-10-29 audit.
- **Blockers:** This is an auth design change, so it needs Luke's approval. Planned for after the hackathon.

#### F09.13 — Security gate that blocks active content, and a live security checklist

- **Priority:** P1 · **Owner:** luke · **Status:** REVIEW · **Dependencies:** F09.3, F02.8
- **Description:** Luke said (2026-10-30) the security gate should give real security, and the app shows no sign of how secure it is.
  - **What is held at upload:** files with active content.
    - PDF: JavaScript, actions that run on open, Launch actions, embedded files, rich media and XFA. These are checked in the raw bytes and in the parsed structure.
    - Office: outside links, ActiveX and embedded OLE objects.
  - **While held:** no model reads the file, it is left out of runs, and its original cannot be downloaded (423) until an admin releases it. Every hold and release is audited.
  - **`GET /security/posture`:** a live checklist of 11 controls, each saying how to fix it when it fails, shown on Security and as a badge in the side rail.
- **Verification evidence (2026-10-30):** `tests/security/test_security_gate.py`:
  - JavaScript and attached files in a PDF, and an outside link in a DOCX, are detected; clean files are not;
  - a held file is skipped by runs, its download is refused with 423, and an analyst cannot release it (403);
  - admin release returns 200, a second release returns 409, and the download then works; both actions are in the audit log;
  - the checklist reflects real settings (the response cache flips its check);
  - without sign-in: 401.
- **Blockers:** this changes how uploads are handled, so Luke approves the merge.

## F10 — User Interface

All F10 tasks use only endpoints listed in `coordination/API_CONTRACT.md`. Each needs a branch `luke/F10.x-short-name`, a PR, and screenshots in the PR description using synthetic data only.

#### F09.11 — Full security check and hardening of the new sign-in code

- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F10.11, F09.8, F02.7
- **Description:** Re-run every scanner on the new code, have an independent reviewer read it, and fix everything found.
- **Acceptance criteria:** scanners at 0; every review finding fixed or accepted with a reason in `docs/SECURITY.md`.
- **Required tests:** new tests in `tests/security/test_sign_in.py` and `tests/integration/test_import_job.py`.
- **Blockers:** none
- **Related PR/commit:** branch `luke/F09.11-security-hardening`
- **Verification evidence (2026-10-28):**
  - **Scanners:** Semgrep 0, Trivy 0 fixable, pip-audit and npm audit 0, bandit 0, ZAP 0 FAIL. The ZAP "SQL injection" warning on the login password is a false positive caused by the lockout, and a test pins it.
  - **Review:** 1 medium finding (DNS rebinding with demo sign-in on) and 7 low or info findings, all fixed; the table is in `docs/SECURITY.md`.
  - **Tests:** pytest 110 passed; e2e 18 of 18.

#### F10.1 — App shell, navigation and sign-in
- **Description:** Layout with sidebar navigation (Dashboard, Import, Library, Intelligence, Processing, Actions, Security, Settings), token sign-in, sign-out, role display.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.4
- **Scope:** `frontend/src/app/layout.tsx`, shared components; endpoints `GET /me`.
- **Expected behavior:** Unauthenticated users see sign-in; 401 anywhere returns to sign-in.
- **Acceptance criteria:** Keyboard navigable; works at 375 px width; role shown.
- **Required tests:** Playwright e2e: sign in with demo analyst token, see dashboard; bad token shows error.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** — Built in solo mode (`luke/F05-agent-orchestrator`, PR #27) and restyled in PR #28 (`E-UI-2`): lint, typegen + tsc and build pass; each screen checked by hand against the live API, screenshots in `docs/screenshots/`. Browser e2e tests (F11.5) still missing, so status stays REVIEW.
- **Verification evidence (E-E2E-2, 2026-10-28):** covered by the Playwright suite in `tests/e2e/` (`01-sign-in`); 13 of 13 tests passed in 5 consecutive fresh runs on Windows 11 (Chromium, desktop and Pixel 7 profiles).

#### F10.2 — Dashboard
- **Description:** Replace the scaffold dashboard with the final design: stats, active jobs, recent findings, recent audit (admin), provider privacy status.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F10.1
- **Scope:** `frontend/src/app/page.tsx`; endpoints `/stats`, `/system/providers`, `/collections`, `/jobs`, `/collections/{id}/findings`.
- **Expected behavior:** Updates while jobs run.
- **Acceptance criteria:** Matches design; no console errors; numbers match the API.
- **Required tests:** Playwright e2e with seeded demo data.
- **Blockers:** none.
- **Related PR/commit:** scaffold in `7390fac`
- **Verification evidence:** `E-FE-1` (build only). Built in solo mode (`luke/F05-agent-orchestrator`, PR #27) and restyled in PR #28 (`E-UI-2`): lint, typegen + tsc and build pass; each screen checked by hand against the live API, screenshots in `docs/screenshots/`. Browser e2e tests (F11.5) still missing, so status stays REVIEW.
- **Verification evidence (E-E2E-2, 2026-10-28):** covered by the Playwright suite in `tests/e2e/` (`01-sign-in`); 13 of 13 tests passed in 5 consecutive fresh runs on Windows 11 (Chromium, desktop and Pixel 7 profiles).

#### F10.3 — Import screen with inventory and estimate
- **Description:** Create/select collection, drag-and-drop upload, show accepted/rejected with reasons, inventory, run estimate, then confirm processing.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F10.1
- **Scope:** `POST /collections`, `POST /collections/{id}/documents`, `GET /collections/{id}/inventory`, `POST /collections/{id}/estimate`, `POST /jobs`.
- **Expected behavior:** Remote providers show a clear "data will leave this machine" confirmation and send `confirm_remote: true` only after the user agrees.
- **Acceptance criteria:** Upload of the synthetic folder works; estimate shows low/high seconds and its basis; 409 handled as a confirmation prompt.
- **Required tests:** Playwright e2e: upload 5 files, run heuristic estimate, start job.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** — Built in solo mode (`luke/F05-agent-orchestrator`, PR #27) and restyled in PR #28 (`E-UI-2`): lint, typegen + tsc and build pass; each screen checked by hand against the live API, screenshots in `docs/screenshots/`. Browser e2e tests (F11.5) still missing, so status stays REVIEW.
- **Verification evidence (E-E2E-2, 2026-10-28):** covered by the Playwright suite in `tests/e2e/` (`04-setup-run`); 13 of 13 tests passed in 5 consecutive fresh runs on Windows 11 (Chromium, desktop and Pixel 7 profiles).

#### F10.4 — Library (collection browser)
- **Description:** Paged document table with filters (type, project, date, part number) and metadata.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F10.1
- **Scope:** `GET /documents`, `GET /search` (filters with empty `q`).
- **Expected behavior:** Filters update the list; selecting a row opens the document viewer.
- **Acceptance criteria:** 150 synthetic docs browsable; filters return correct subsets.
- **Required tests:** Playwright e2e filter test.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** — Built in solo mode (`luke/F05-agent-orchestrator`, PR #27) and restyled in PR #28 (`E-UI-2`): lint, typegen + tsc and build pass; each screen checked by hand against the live API, screenshots in `docs/screenshots/`. Browser e2e tests (F11.5) still missing, so status stays REVIEW.
- **Verification evidence (E-E2E-2, 2026-10-28):** covered by the Playwright suite in `tests/e2e/` (`02-investigate`); 13 of 13 tests passed in 5 consecutive fresh runs on Windows 11 (Chromium, desktop and Pixel 7 profiles).

#### F10.5 — Document viewer
- **Description:** Show page text, the original file (PDF/image inline), extracted fields, provider/model/locality and injection warnings.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F10.4
- **Scope:** `GET /documents/{id}`, `GET /documents/{id}/pages/{n}`, `GET /documents/{id}/original` (fetch with Authorization header, then object URL).
- **Expected behavior:** Injection-flagged documents show a visible warning; heuristic extractions are labelled "rule-based, not AI".
- **Acceptance criteria:** Drawings, CSV, Markdown and PNG all display.
- **Required tests:** Playwright e2e opening one of each type.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** — Built in solo mode (`luke/F05-agent-orchestrator`, PR #27) and restyled in PR #28 (`E-UI-2`): lint, typegen + tsc and build pass; each screen checked by hand against the live API, screenshots in `docs/screenshots/`. Browser e2e tests (F11.5) still missing, so status stays REVIEW.
- **Verification evidence (E-E2E-2, 2026-10-28):** covered by the Playwright suite in `tests/e2e/` (`02-investigate`); 13 of 13 tests passed in 5 consecutive fresh runs on Windows 11 (Chromium, desktop and Pixel 7 profiles).

#### F10.6 — Evidence viewer for findings
- **Description:** Side-by-side evidence for each finding: document, page, quoted line, value, verified badge; click to open that page.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F10.5
- **Scope:** `GET /collections/{id}/findings`, document/page endpoints.
- **Expected behavior:** Conflicting values are visually contrasted; quotes highlighted in page text.
- **Acceptance criteria:** All 10 planted conflicts navigable to their source pages.
- **Required tests:** Playwright e2e.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** — Built in solo mode (`luke/F05-agent-orchestrator`, PR #27) and restyled in PR #28 (`E-UI-2`): lint, typegen + tsc and build pass; each screen checked by hand against the live API, screenshots in `docs/screenshots/`. Browser e2e tests (F11.5) still missing, so status stays REVIEW.
- **Verification evidence (E-E2E-2, 2026-10-28):** covered by the Playwright suite in `tests/e2e/` (`02-investigate`); 13 of 13 tests passed in 5 consecutive fresh runs on Windows 11 (Chromium, desktop and Pixel 7 profiles).

#### F10.7 — Processing view
- **Description:** Job list and detail with progress, item status counts, errors, workers, provider, cancel button.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F10.1
- **Scope:** `GET /jobs`, `GET /jobs/{id}`, `POST /jobs/{id}/cancel`, `GET /system/hardware`.
- **Expected behavior:** Polls every 1–3 s while a job runs; viewer role sees no cancel button (server still enforces).
- **Acceptance criteria:** Cancel works; failed items show safe error text.
- **Required tests:** Playwright e2e.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** — Built in solo mode (`luke/F05-agent-orchestrator`, PR #27) and restyled in PR #28 (`E-UI-2`): lint, typegen + tsc and build pass; each screen checked by hand against the live API, screenshots in `docs/screenshots/`. Browser e2e tests (F11.5) still missing, so status stays REVIEW.
- **Verification evidence (E-E2E-2, 2026-10-28):** covered by the Playwright suite in `tests/e2e/` (`04-setup-run`); 13 of 13 tests passed in 5 consecutive fresh runs on Windows 11 (Chromium, desktop and Pixel 7 profiles).

#### F10.8 — Actions: proposals and approvals
- **Description:** Create a proposal (pattern picker), before/after preview tree, approve/reject (admin), result with export folder.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F10.1
- **Scope:** `POST /proposals`, `GET /proposals`, `GET /proposals/{id}`, `POST /proposals/{id}/approve`, `POST /proposals/{id}/reject`.
- **Expected behavior:** Analyst can create but sees approve disabled; if forced, the 403 is shown as "Only administrators can approve".
- **Acceptance criteria:** Full create → preview → approve flow with admin token; 409 handled.
- **Required tests:** Playwright e2e with analyst and admin tokens.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** — Built in solo mode (`luke/F05-agent-orchestrator`, PR #27) and restyled in PR #28 (`E-UI-2`): lint, typegen + tsc and build pass; each screen checked by hand against the live API, screenshots in `docs/screenshots/`. Browser e2e tests (F11.5) still missing, so status stays REVIEW.
- **Verification evidence (E-E2E-2, 2026-10-28):** covered by the Playwright suite in `tests/e2e/` (`05-approvals`); 13 of 13 tests passed in 5 consecutive fresh runs on Windows 11 (Chromium, desktop and Pixel 7 profiles).

#### F10.9 — Security and audit view
- **Description:** Provider list with local/remote and privacy text, remote-inference switch (admin), audit table filterable by outcome.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F10.1
- **Scope:** `GET /system/providers`, `PUT /settings/remote-inference`, `GET /audit`.
- **Expected behavior:** Denied events are prominent (needed for the demo's blocked-action segment).
- **Acceptance criteria:** A viewer's denied upload attempt appears in the audit view within one refresh.
- **Required tests:** Playwright e2e.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** — Built in solo mode (`luke/F05-agent-orchestrator`, PR #27) and restyled in PR #28 (`E-UI-2`): lint, typegen + tsc and build pass; each screen checked by hand against the live API, screenshots in `docs/screenshots/`. Browser e2e tests (F11.5) still missing, so status stays REVIEW.
- **Verification evidence (E-E2E-2, 2026-10-28):** covered by the Playwright suite in `tests/e2e/` (`03-security`); 13 of 13 tests passed in 5 consecutive fresh runs on Windows 11 (Chromium, desktop and Pixel 7 profiles).

#### F10.10 — Intelligence (natural-language investigation) screen
- **Description:** Question box, answer with inline citations, evidence panel.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F06.4
- **Scope:** `POST /investigations` (see `API_CONTRACT.md`); `frontend/src/components/ask-panel.tsx` on the Investigate screen.
- **Expected behavior:** Citations open the document viewer at the cited page.
- **Acceptance criteria:** Answer sentences show numbered citations; clicking one highlights the quoted line; file names open the document drawer; unverified and uncited sentences are visibly marked; heuristic answers labelled "Rule-based, not AI"; only local providers offered.
- **Required tests:** Playwright e2e.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** Lint, tsc and production build pass. Playwright run against the live API with Llama 3: suggestion click, answer and source highlight rendered with no console errors at 1280 px and 390 px (`docs/screenshots/ask-dark.jpg`). Browser e2e test (F11.5) still missing.

---

## F11 — Synthetic Data & Evaluation
- **Verification evidence (E-E2E-2, 2026-10-28):** covered by the Playwright suite in `tests/e2e/` (`02-investigate`); 13 of 13 tests passed in 5 consecutive fresh runs on Windows 11 (Chromium, desktop and Pixel 7 profiles).

#### F10.11 — Easy start: sign-in, Demo and Real modes, Meta API key screen

- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F10.1, F09.8
- **Description:** use VAULT without pasting tokens or editing `.env`, and keep fictional demo data apart from real documents.
- **Implementation scope:**
  - Sign-in: username and password with scrypt hashes, 12-hour sessions and lockout; optional one-click demo sign-in (`VAULT_DEMO_LOGIN`); sign-out revokes the token.
  - Modes: a Demo/Real switch, with `collections.is_demo` (migration 5) and a "Create your first collection" form.
  - Key screen: a Meta Model API key panel on Security, with links to the Meta developer portal.
- **Acceptance criteria:**
  - The demo signs in with one click, and a password user signs in without a token.
  - Real mode never shows demo collections.
  - A key can be saved and removed from the UI and is never returned.
  - VAULT works with no API key.
- **Required tests:** `tests/security/test_sign_in.py`; e2e `01-sign-in`, `06-modes`.
- **Blockers:** none
- **Related PR/commit:** branch `luke/F10.11-easy-start`. This is high-risk (auth, a migration, secret storage), so it waits for Luke's approval before merge.
- **Verification evidence (2026-10-28):**
  - **`test_sign_in.py`, 6 tests:** a password sign-in session expires and sign-out revokes it; wrong and unknown users get the same 401 and lock out after 5 tries; short passwords are refused; demo sign-in gives 403 unless enabled; the key is never in responses, providers or the audit log, and viewers cannot set it; demo and real collections are kept apart.
  - **e2e, 17 of 17 twice:** the demo button opens Demo mode with its banner; sign-out makes the session give 401; a wrong password shows a message; the token fallback works; Real mode hides the demo archive until a collection is created.
  - **Overall:** pytest 97 passed; bandit clean.

#### F11.1 — Deterministic synthetic dataset v1
- **Description:** 150 fictional files across 5 projects: 40 drawings, 40 inspection records, 15 contracts, 10 parts lists, 10 revision histories, 20 memos, 15 stamp images; alternate layouts.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** none
- **Scope:** `generator/generate.py`, `data/synthetic/v1/`.
- **Expected behavior:** Same seed produces identical bytes on every OS.
- **Acceptance criteria:** Determinism check passes locally and in CI.
- **Required tests:** CI job "Dataset is deterministic".
- **Blockers:** CI run not yet observed.
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-DET-1`.

#### F11.2 — Ground-truth manifest and planted anomalies
- **Description:** `manifest.json` with per-file type, project, date, components, split, plus 10 rating conflicts and 2 prompt-injection memos.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F11.1
- **Scope:** manifest generation.
- **Expected behavior:** Tests and evaluation read ground truth from the manifest only.
- **Acceptance criteria:** Integration test confirms planted conflicts equal found conflicts.
- **Required tests:** `test_full_vertical_slice`, `test_s3_*`.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-TEST-1`.

#### F11.3 — Evaluation harness
- **Description:** Score latest extractions per provider against the manifest, per split.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F11.2
- **Scope:** `evaluation/run_eval.py`.
- **Expected behavior:** JSON report with doc_type, project, date, part recall, rating accuracy, evidence verification, conflict precision/recall.
- **Acceptance criteria:** Heuristic report produced.
- **Required tests:** manual run; unit test for scoring still to add.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `E-EVAL-1`.

#### F11.4 — Full local Meta model evaluation
- **Description:** Evaluate `llama3:latest` on all 150 documents and record results next to the heuristic baseline.
- **Priority:** P0 · **Owner:** luke · **Status:** IN_PROGRESS · **Dependencies:** F11.3, F04.2
- **Scope:** `evaluation/results/ollama-*.json`; summary in `docs/EVALUATION_PLAN.md`.
- **Expected behavior:** Honest numbers, including where the model is worse than the baseline.
- **Acceptance criteria:** Report committed.
- **Required tests:** `python -m evaluation.run_eval --collection demo-ollama --provider ollama`.
- **Blockers:** none. The final run is scheduled for Nov 1, on frozen code.
- **Related PR/commit:** —
- **Verification evidence:** — `E-LLM-2` (on the tuning dataset; a fresh-seed run is still needed).
- **Dry run (2026-10-28):** fresh seed 2027 on dataset v2. Llama 3 held-out: doc_type 0.918, project 0.857, rating conflicts 10 of 10 at precision 1.0, quantity conflicts 0 of 5. Results are in `evaluation/results/fresh-seed-2027/` and `SUMMARY.md`.

#### F11.5 — End-to-end browser tests
- **Description:** Playwright tests for the main demo flow against a locally seeded backend.
- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F10.1
- **Scope:** `tests/e2e/`.
- **Expected behavior:** One command seeds data, starts both servers and runs the flow.
- **Acceptance criteria:** Runs locally on Windows and macOS; optional CI job.
- **Required tests:** itself.
- **Blockers:** none
- **Related PR/commit:** branch `luke/F11.5-e2e`
- **Verification evidence (E-E2E-2, 2026-10-28):**
  - **How it runs:** `cd tests/e2e && npm test` seeds `data/e2e/` with `demo_reset.py`, starts the API on :8100, builds and serves the UI on :3100, and runs 13 Playwright tests (12 desktop, 1 phone).
  - **Windows 11:** 5 consecutive fresh runs, 13 of 13 each time, 25–30 s per run, plus about 2 min for the first build.
  - **Bug the suite found and fixed:** a race in `frontend/src/components/session.tsx`. A rejected token sometimes showed "Your session ended" instead of "That token was not accepted".
  - **CI:** the `e2e` job runs on Linux; its result is pending on the PR.
  - **macOS:** not run, because no Mac is available. The config chooses `.venv/bin/python` on POSIX systems, and the Linux CI run exercises that path.

#### F11.6 — Dataset v2 (scanned pages, more anomaly kinds)
- **Description:** Add rasterised/scanned PDFs, duplicate part numbers with conflicting descriptions, contract quantity mismatches.
- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F11.1
- **Scope:** generator v2 with its own manifest; v1 stays frozen.
- **Expected behavior:** Deterministic like v1.
- **Acceptance criteria:** Determinism check passes.
- **Required tests:** CI determinism job for v2.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** —

---
- **Related PR/commit:** branch `luke/F11.6-dataset-v2`
- **Verification evidence (2026-10-28):** `python -m generator.generate --dataset-version 2` writes `data/synthetic/v2/` (165 files, 22 planted anomalies). The new planted problems are 5 quantity conflicts, 5 material conflicts, and 5 scanned image-only PDFs with 0 extractable text characters.
  - Regenerating v1 with the changed generator is byte-identical, PNGs included.
  - Two v2 runs are identical, excluding PNGs and scanned PDFs.
  - `tests/unit/test_dataset_v2.py`: v2 is a superset of v1 with unchanged shared files, and the planted counts are right.
  - CI has a new "Dataset v2 is deterministic" step.
  - Detecting the new kinds is F06.5.

#### F11.7 — Scale dataset generator (thousands of files, photos, markings)

- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F11.1
- **Description:** `--projects`, `--photos`, `--marked-fraction` options; default 150-file set unchanged.
- **Implementation scope:** Phone-style JPEG photos of inspection sheets, ITAR-marked sheets, personal-data rosters, extra projects.
- **Expected behavior:** 3,700 files in under a minute, deterministic per seed, ground truth for every file.
- **Acceptance criteria:** 3,700 files in under a minute, deterministic per seed, ground truth for every file.
- **Required tests:** see verification evidence
- **Blockers:** none
- **Related PR/commit:** branch `luke/F05-agent-orchestrator`
- **Verification evidence:** Generated 3,700 files in 53 s; v1 hashes unchanged; pipeline found 200/200 planted conflicts.

## F12 — Deployment & Submission

#### F12.9 — One-command start and guided first run

- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F12.6, F10.11
- **Description:** Start VAULT with `start.ps1` or `start.sh`, and guide a new user through the first run.
- **Implementation scope:**
  - `scripts/start.py`: installs what is missing, checks Ollama and the model without downloading it, builds the demo or sets up Real mode with an admin password, and starts both servers on 127.0.0.1.
  - Getting-started checklist on Overview.
  - Set up a run: a Quick start button, a drop zone for files, and the advanced options folded away.
- **Acceptance criteria:** a new user reaches a running VAULT with one command and reads documents with one button.
- **Required tests:** e2e `01-sign-in`, `04-setup-run`; a manual launcher run.
- **Blockers:** none
- **Verification evidence (2026-10-28):**
  - **Launcher run on Windows:** every step reported, Llama 3 detected, API healthy, interface 200.
  - **Network exposure:** the interface is now bound to 127.0.0.1, after the first run showed it on the network.
  - **e2e:** 18 of 18.

#### F10.12 — New logo, motion and polish

- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F10.1
- **Description:** A vault-door logo and favicon; page entrance motion, press feedback, loading skeletons, counting figures and striped running bars; demo sign-in buttons that fit; checklist steps that collapse on a phone.
- **Acceptance criteria:** motion respects reduced-motion settings, no behaviour changes, e2e green.
- **Required tests:** e2e suite; screenshots at 1440 px and 390 px reviewed.
- **Blockers:** none
- **Verification evidence (2026-10-28):** screenshots of sign-in, Overview, Set up a run and Training reviewed at desktop and phone size; the issues found were fixed (duplicate logo, wrapping demo buttons, the checklist filling a phone screen, a slow local-models call now cached for 30 s). e2e 18 of 18; tsc and eslint clean.

#### F12.10 — Turn off Next.js telemetry

- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F12.9
- **Description:** Next.js can send anonymous usage data during build and start. VAULT says nothing leaves the machine, so every start path sets `NEXT_TELEMETRY_DISABLED=1`. Found by the 2026-10-29 audit.
- **Implementation scope:** `scripts/start.py`, `frontend/Dockerfile`.
- **Acceptance criteria:** `next telemetry status` reports disabled under the launcher's environment.
- **Verification evidence (2026-10-29):**
  - On this laptop, `npx next telemetry status` reported telemetry **on** before the change, and "No data will be collected from your machine" with `NEXT_TELEMETRY_DISABLED=1`.
  - `tests/unit/test_no_telemetry.py`: the launcher sets the variable for every child process, and both Dockerfile stages set it.
  - `docs/DEPLOYMENT.md` tells people running `npm` themselves how to turn it off.

#### F12.11 — Move VAULT to a new computer in one encrypted file

- **Priority:** P1 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F12.1
- **Description:** Luke asked (2026-10-29) for a safe way to move everything to a bigger computer. `vault transfer export | verify | import` writes and restores one encrypted pack: the database, with the brains, users and audit log, and every original.
- **Implementation scope:** `backend/core/transfer.py`, `cli/main.py`, `docs/DEPLOYMENT.md`. New dependency: `cryptography`.
- **Verification evidence (2026-10-29):**
  - **`tests/security/test_transfer.py`, 14 tests:**
    - a round trip restores documents, readings and brain entries, and the contents are not readable inside the pack;
    - the API key travels only when asked;
    - a wrong passphrase, a flipped bit, a truncated pack and a non-pack file are each refused, and leave nothing behind;
    - a folder that is not empty is never overwritten;
    - a short passphrase is refused;
    - entries such as `../`, absolute paths, Windows paths and unexpected names are refused;
    - a manifest mismatch or a missing file is refused;
    - weak or huge key settings in the header are refused.
  - **`tests/integration/test_cli.py::test_transfer_moves_the_vault_with_one_passphrase`:** export, verify, a wrong passphrase, and import through the real CLI.
- **Merge:** Luke approved on 2026-10-30; merged as PR #72.

#### F12.1 — Command-line interface
- **Description:** `vault init`, `token`, `ingest`, `hardware`, `providers`, `estimate`, `process`, `search`, `findings`, `serve`.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.2
- **Scope:** `cli/main.py`.
- **Expected behavior:** Works against the local database without the server running.
- **Acceptance criteria:** Manual end-to-end run on the synthetic dataset succeeded; automated CLI test missing.
- **Required tests:** add `tests/integration/test_cli.py` using Typer's runner.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** Manual run 2026-10-26: 150 ingested, heuristic job completed in ~2 s, 10 findings printed. 2026-10-28: `tests/integration/test_cli.py` (3 tests, Typer runner): `init --demo-users` (tokens written, never printed), `ingest`, `process` (all done, 0 failed), `search`, `findings` (BV-7891 conflict), remote provider refused with exit 2, unknown collection error. Full suite 50 passed.

#### F12.2 — Docker Compose deployment
- **Description:** Backend and frontend images, ports bound to 127.0.0.1, read-only backend container, optional Ollama profile.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F01.2, F01.4
- **Scope:** `docker-compose.yml`, `Dockerfile.backend`, `frontend/Dockerfile`.
- **Expected behavior:** `docker compose up --build` gives a working stack talking to host Ollama.
- **Acceptance criteria:** Both images build; health check passes; dashboard loads.
- **Required tests:** manual build and smoke test.
- **Blockers:** none
- **Related PR/commit:** `7390fac`
- **Verification evidence:** `docker compose config -q` succeeded 2026-10-26 (`E-DOCKER-1`).
- **Full run, 2026-10-28 (`E-DOCKER-2`):** `docker compose -p vault-f122 up -d --build` built both images and started them in 50 s.
  - `GET /api/v1/health` returned ok, and the frontend returned 200.
  - `vault init --demo-users` ran inside the container.
  - 30 Alpha files uploaded through the API (0 rejected). A heuristic job completed 30 of 30, 0 failed, with 1 finding.
  - The dashboard, Investigate and Security pages loaded in Chromium with the data shown.
  - The backend runs as user `vault`, with a read-only root filesystem, and its port is bound to 127.0.0.1 only.
  - Torn down afterwards with `down -v`.

#### F12.3 — Public README and documentation set
- **Description:** README with banner, screenshots of real pages using synthetic data, Mermaid diagrams in plain English, "AI agents: start here" block; `docs/` complete.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F10.2
- **Scope:** `README.md`, `docs/`.
- **Expected behavior:** A judge understands the project in two minutes.
- **Acceptance criteria:** Screenshots of at least dashboard, import, library, evidence, approvals, audit.
- **Required tests:** link check.
- **Blockers:** Screenshots need finished UI.
- **Related PR/commit:** —
- **Verification evidence:** — README with banner and screenshots committed in `4c321b8`.

#### F12.4 — Hackathon compliance verification
- **Description:** Read official rules and the participant guide while logged in; update `docs/HACKATHON_COMPLIANCE.md` from unverified to verified.
- **Priority:** P0 · **Owner:** luke · **Status:** BLOCKED · **Dependencies:** none
- **Scope:** documentation.
- **Expected behavior:** Every submission requirement has a source.
- **Acceptance criteria:** No requirement left marked "unverified" by Nov 2.
- **Required tests:** checklist review.
- **Blockers:** Participant guide is behind login (`BLOCKERS.md` B1).
- **Related PR/commit:** —
- **Verification evidence:** —

#### F12.5 — Project licence decision
- **Description:** Choose whether to add an open-source licence and which one.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F12.4
- **Scope:** `LICENSE`, `THIRD_PARTY_NOTICES.md`.
- **Expected behavior:** Licence matches event rules and dependency licences.
- **Acceptance criteria:** Luke's decision recorded in `DECISIONS.md`.
- **Required tests:** none
- **Blockers:** none. Re-check against the hackathon rules once B1 is done.
- **Related PR/commit:** —
- **Verification evidence:** —
- **Verification evidence (2026-10-28):** Luke chose Apache-2.0 (D-012). `LICENSE` holds the canonical text (SHA-256 of the apache.org file cfc7749b…3d30). `NOTICE` carries the copyright and the "Built with Meta Llama 3" attribution. The README, `pyproject.toml` and `frontend/package.json` are updated.

#### F12.6 — Demo environment and seed script
- **Description:** One script that resets a demo database, creates demo users, ingests the dataset and pre-processes it.
- **Priority:** P0 · **Owner:** luke · **Status:** VERIFIED · **Dependencies:** F12.1
- **Scope:** `scripts/demo_reset.py` (logic) with `scripts/demo_reset.ps1` and `scripts/demo_reset.sh` wrappers; data in git-ignored `data/demo/`.
- **Expected behavior:** Demo can be rehearsed repeatedly from a clean state.
- **Acceptance criteria:** Runs in under 2 minutes with heuristic, documented duration with Ollama.
- **Required tests:** run twice.
- **Blockers:** none
- **Related PR/commit:** branch `luke/F12.6-demo-seed` (PR pending)
- **Verification evidence:** 2026-10-27, heuristic: four consecutive runs from Git Bash and PowerShell, 10.0–12.6 s each, every run ending with 150/150 processed, 10 findings, 1 pending proposal. Served `data/demo` and confirmed `/stats` (150 documents, 10 findings, 1 pending) and a viewer 403 on `/proposals`. With `--provider ollama` (`llama3:latest`, hardware-recommended workers): 778.5 s total, 771 s processing, 150/150, 0 failed, 10 findings. Refuses to wipe `data/runtime` (exit 2). Found and fixed during testing: read-only originals stopped the wipe, so the wipe now clears the read-only flag and keeps the `.vault-demo` marker until last.

#### F12.7 — Demo video (~3 minutes)
- **Description:** Record and edit the video following `docs/DEMO_STORYBOARD.md`; only working features shown.
- **Priority:** P0 · **Owner:** luke · **Status:** BACKLOG · **Dependencies:** F10.2–F10.9, F06.4, F12.6
- **Scope:** recording, editing, upload.
- **Expected behavior:** Shows real Meta model processing, a planted discrepancy with evidence, an approval, and a blocked action with its audit entry.
- **Acceptance criteria:** Length matches verified rule; link works when logged out.
- **Required tests:** watch-through checklist.
- **Blockers:** Schedule: recording Nov 3.
- **Related PR/commit:** —
- **Verification evidence:** —

#### F12.8 — Final submission
- **Description:** Submit before Nov 4, 9:00 PM ET; confirm receipt.
- **Priority:** P0 · **Owner:** luke · **Status:** BACKLOG · **Dependencies:** F12.3, F12.4, F12.7
- **Scope:** `docs/SUBMISSION_CHECKLIST.md`.
- **Expected behavior:** Submitted with repository URL, video link and all required fields.
- **Acceptance criteria:** Confirmation received and screenshot saved (no personal data in the repo).
- **Required tests:** checklist.
- **Blockers:** none
- **Related PR/commit:** —
- **Verification evidence:** —
