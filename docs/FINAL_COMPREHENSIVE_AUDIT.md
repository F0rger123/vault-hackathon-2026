# VAULT final comprehensive audit

- **Date:** 2026-10-29. Branch `main` at `bd8cc84`; CI green on the last three runs.
- **Auditor:** Luke's AI coding session, working solo.
- **Method:** the code was read and the real API was run. Claims in the documentation were checked against both. Where something was only read and not run, this report says so.

Every finding has a severity, the component, evidence, an action and a tracking task. Severity runs from **Critical** (a submission blocker) through **High**, **Medium** and **Low**.

## 0. Fixed since this audit (2026-10-29 to 2026-10-30)

| Gap found by the audit | Fix | PR |
|---|---|---|
| Next.js sent usage data off the machine | Turned off in every start path (F12.10) | #62 |
| No table export | CSV and JSON, one row per part, with file, page and quote (F08.5) | #64 |
| Word, Excel and PowerPoint rejected | Read with the standard library; zip bombs, macros and DTDs refused (F02.8) | #66 |
| Setup needed command-line model downloads | One-click Meta model installs sized to the machine (F03.7) | #68 |
| **Rules and examples applied to every collection** (found while building the brain) | Each collection keeps its own brain, and taught knowledge never crosses collections (F07.7, F07.8) | #70 |
| No way to move to a bigger machine | `vault transfer`: one encrypted file, every file's fingerprint checked (F12.11) | #72 |
| No safe way to share part of an archive | Share packs: redacted PDFs plus a report of what was left out and why (F08.6) | #74 |

Still open:
- reading images and scanned pages (waits for the B7 vision download);
- per-collection permissions (F09.12, after the hackathon);
- semantic search;
- audio and video;
- the official rules check (B1).

The sections below are the audit as written on 2026-10-29.

## 1. Summary

VAULT's core loop works end to end on this laptop with a real Meta model. The steps are:

1. import a mixed collection;
2. plan the run from the measured hardware;
3. read the documents with local Llama 3 8B;
4. prove each fact with a checked quote;
5. find conflicts across documents;
6. answer questions with citations;
7. propose an organization;
8. approve it and export copies.

Every step is in the audit log. The biggest gaps against the original vision are below:

| Gap | What is missing |
|---|---|
| Formats | Office files (DOCX, XLSX, PPTX), scanned pages, images (no OCR or vision yet), audio and video |
| Access control | Roles only. There is no per-collection or per-document permission |
| Structured export | No export of the extracted records as a table |
| Search | No semantic (meaning-based) search |
| Rules | The official hackathon rules have not been verified (blocker B1) |

None of these breaks the demo. Office files and structured export can be built before the Nov 2 feature freeze. Access control and vision need Luke's decisions.

## 2. Automated checks (run 2026-10-29)

| Command | Result |
|---|---|
| `ruff check .` and `ruff format --check .` | Pass, 150 files |
| `pytest -p no:warnings` | **115 passed**, 0 failed |
| `bandit -q -c pyproject.toml -r backend cli -ll` | No findings |
| `pip-audit` | No known vulnerabilities (the editable `vault` package is skipped) |
| `npm run lint`, `npx tsc --noEmit`, `npm run build` (frontend) | Pass; all routes build as static pages |
| `npm audit --omit=dev` | 0 vulnerabilities |
| GitHub CI (backend, frontend, dependency audit, Semgrep, Trivy, coordination, 18 Playwright browser tests) | Green on `main`, runs at 04:24 and 04:52 UTC |

Passing tests prove only what they test. The workflow runs in section 3 cover what the tests do not.

## 3. Workflow tests against a fresh VAULT

All runs used a temporary data folder and the real FastAPI app, through `TestClient`, with three users: admin, analyst and viewer. The script is not committed. It used only fictional files written for the test.

| Test | What was done | Result |
|---|---|---|
| **A. Basic processing** | Imported a PDF and text files, processed them with the rules baseline, searched for part `ZV-1001`, then opened the cited page | **Pass.** The job completed 6 of 6 with 0 failures. Search returned 5 hits, each with a page number, and the cited page contains the part number. |
| **B. Mixed formats** | Uploaded PDF, TXT, MD, CSV, JSON, PNG, DOCX, XLSX, MP3, a corrupt PDF and a duplicate | **Partial.** PDF, TXT, MD, CSV, JSON and PNG were accepted. The duplicate was detected by SHA-256. The corrupt PDF was rejected with "PDF could not be parsed". DOCX, XLSX and MP3 were rejected with "unsupported or binary file type". The PNG was stored, but its page text is a placeholder: no text is read from images. |
| **C. Planted discrepancy** | A spec says ZV-1001 is rated 150 psi; an inspection report says 300 psi | **Pass.** One `rating_conflict` finding, status `verified`, quoting both documents with page numbers. |
| **D. Organization** | Already covered by the proposal, approval and export test in `tests/integration/test_flow.py` (runs in CI); this run checked the originals only | **Pass.** Every stored original is read-only. The CI test checks that the original hashes are unchanged after export. |
| **E. Security** | Viewer upload, no token, a bad token, a `../../evil.txt` filename, and a viewer reading the audit log | **Pass.** Responses: 403, 401, 401, the name stored as `evil.txt` (inside the store), and 403. Each denial is in the audit log with the reason. |
| **F. Performance** | Not re-run today. The evidence is in `evaluation/results/` (see section 5, F09 and F10) | Measured earlier: the rules baseline reads 150 documents in seconds, and Llama 3 takes 528 s for 165 documents. |
| **G. Failure recovery** | Covered by tests: corrupt file (above), flaky provider, always-failing provider, restart mid-job, and import resume without duplicates | **Pass** (`tests/integration/test_workers.py`, `test_import_job.py`) |
| **H. Real Meta inference** | Local Llama 3 8B (`llama3:latest`, Meta open weights) through Ollama 0.32.1 on this laptop, 2026-10-29 00:48 | **Pass.** It scored 165 documents of dataset v2: 10 of 10 rating conflicts and 5 of 5 quantity conflicts at precision 1.0, with held-out document type at 0.939. File: `evaluation/results/v2/ollama-20261029-004818.json`. The **Meta Model API** (hosted) has never run: no key exists yet, so that test is **BLOCKED** (B2). |

**Hardware measured on this machine:**
- AMD CPU, 16 cores and 32 threads;
- 31,961 MB RAM;
- NVIDIA RTX 5070 Laptop GPU with 8,151 MB;
- Windows.

## 4. Feature-by-feature audit

**Status key:** VERIFIED WORKING · IMPLEMENTED BUT UNVERIFIED · PARTIALLY WORKING · BROKEN · NOT IMPLEMENTED · INTENTIONALLY DEFERRED.

### F01 Ingestion

| Capability | Status | Evidence |
|---|---|---|
| PDF with a text layer | VERIFIED WORKING | `backend/ingest/service.py` uses `pypdf`; tests A and B |
| TXT, MD, CSV, JSON, LOG | VERIFIED WORKING | Test B; CSV rows are read by the baseline and by Llama |
| Duplicate detection, hashes, page numbers, size and page limits | VERIFIED WORKING | Test B; `tests/security` (S1–S10) |
| Corrupt and encrypted PDFs, and mismatched extensions | VERIFIED WORKING | Test B; `validate_upload` checks the content type against the extension |
| Folder and large path imports in the background, with resume | VERIFIED WORKING | F02.7, `test_import_job.py` |
| PNG and JPEG | PARTIALLY WORKING | Stored and decoded, but no text is read. The page says "visual content not yet analysed" |
| Scanned PDFs (OCR) | NOT IMPLEMENTED | F02.6 waits on Luke's OCR decision |
| DOCX, XLSX, PPTX | VERIFIED WORKING (added after this audit, F02.8) | Word paragraphs and tables, Excel sheets and PowerPoint slides become pages. Zip bombs, macros and DTDs are rejected (`tests/unit/test_office.py`) |
| Technical drawings and blueprints | PARTIALLY WORKING | Readable as PDF text. Drawing geometry and symbols are not understood |
| Audio, video, CAD | INTENTIONALLY DEFERRED | Post-hackathon (roadmap) |

### F02 Automatic organization

| Capability | Status | Evidence |
|---|---|---|
| Document type, project, date, parties and stamps | VERIFIED WORKING | Llama 3 held-out document type 0.939 and project 0.857 (v2) |
| Folder proposals, preview, approval and copy-only export | VERIFIED WORKING | F08.1–F08.3, `test_flow.py` |
| Plain-language layout requests ("group by project then year") | VERIFIED WORKING | F08.4: 8 of 8 held-out |
| Undo | PARTIALLY WORKING | Nothing to undo, because originals never change. Exports are new folders; deleting one is a manual step |
| Department identification | NOT IMPLEMENTED | Possible through teach-by-example rules; not measured |

### F03 Search and organizational intelligence

| Capability | Status | Evidence |
|---|---|---|
| Full-text search with page numbers and filters | VERIFIED WORKING | Test A; F06.1, F06.2 |
| Natural-language questions with numbered, checked citations | VERIFIED WORKING | F06.4; quotes are checked against the page text before display |
| Unsupported claims | VERIFIED WORKING | Quotes that do not match the page are dropped and counted (`verified_ratio`) |
| Semantic (embedding) search | NOT IMPLEMENTED | F06.6 is a P2 in the backlog |
| Retrieval limited by access rights | PARTIALLY WORKING | Roles limit what a user can do. They do not limit which collections a user can see (see F13) |

### F04 Cross-document reasoning

| Capability | Status | Evidence |
|---|---|---|
| Conflicting pressure ratings | VERIFIED WORKING | 10 of 10 planted, 0 false alarms (v1 and v2); test C |
| Conflicting quantities and materials | VERIFIED WORKING | Llama 3: 5 of 5 each, precision 1.0 (F06.5, F04.11) |
| Contract revisions, inconsistent dates, missing fields | NOT IMPLEMENTED | Roadmap |

### F05 Teach by example

| Capability | Status | Evidence |
|---|---|---|
| Corrections become versioned rules, then reprocessing | VERIFIED WORKING | F07.1–F07.3: 0.889 to 0.978 on held-out documents |
| Labelled examples as guidance for the model | VERIFIED WORKING | F07.5 |
| Training screen (grade, suggest rules, re-test, readiness) | VERIFIED WORKING | F07.6 |
| New visual markings (stamp images) | NOT IMPLEMENTED | Needs a vision model (F04.7, F04.10) |

**How it learns:** no model is fine-tuned. VAULT stores versioned rules and labelled examples, then applies them on the next run. The docs and the UI describe it this way. Keep it that way.

### F06 Natural-language workflows

| Capability | Status | Evidence |
|---|---|---|
| Organization requests in plain language become a proposal | VERIFIED WORKING | F08.4. The model output is parsed into a fixed schema, then shown for approval |
| Questions in plain language | VERIFIED WORKING | F06.4 |
| General task planning ("make a table from these contracts") | NOT IMPLEMENTED | Partly covered once structured export exists (F08.5) |

### F07 Structured database generation

| Capability | Status | Evidence |
|---|---|---|
| Fixed extraction schema with validation | VERIFIED WORKING | F04.4 |
| Export of the records as CSV or JSON, with provenance | VERIFIED WORKING (added after this audit) | F08.5: `GET /collections/{id}/records`, Export panel on Investigate |
| Schema proposals and record de-duplication | INTENTIONALLY DEFERRED | Roadmap |

### F08 Hardware profiling

VERIFIED WORKING. Values come from `psutil` and the GPU query on this machine (section 3). VAULT runs without a GPU: the rules baseline needs none, and Ollama falls back to the CPU. The local-models card shows how many copies fit in GPU memory or RAM (F03.6).

### F09 Processing estimates

VERIFIED WORKING. VAULT measures a sample, gives a range, and compares the finished run with its estimate (F03.5). Measured fact: Llama 3 estimates run about 2x high on this laptop, as recorded in `evaluation/results/SUMMARY.md`.

### F10 Parallel workers

VERIFIED WORKING on one machine:
- lanes, retries, cancel, resume after restart, and a free-memory guard;
- coordinator, security-gate and reviewer agents.

Tests are in `test_workers.py` and `test_agents.py`. Distributed processing across machines is **not implemented**, and nothing claims it is.

### F11 Meta model integration

| Item | Status |
|---|---|
| Local Llama 3 8B (Meta open weights) through Ollama | VERIFIED WORKING (test H) |
| Meta Model API (hosted Muse Spark) | IMPLEMENTED BUT UNVERIFIED. Code and mocked tests exist. No real call has been made (B2) |
| Vision (Muse Spark images, or Llama 3.2 Vision locally) | NOT IMPLEMENTED. Llama 3.2 Vision would make images and scanned pages readable offline. It needs Luke's approval for an approximately 8 GB download (new decision B7) |

The event page lists the models participants may use: "Muse Spark series, Muse Image and SAM 3.1 through Meta Model API" and "Meta open weights models". Llama 3 is a Meta open-weights model. Whether a hosted model is *required* is unverified until B1.

### F12 Offline and local-first

| Item | Status |
|---|---|
| Storage, database, index and Llama inference | All local. Checked by reading the code: the only outbound address in `backend/` is the Meta Model API, used only when an admin turns remote inference on and confirms each job |
| Running with the network unplugged | NOT TESTED with the network off. Recorded as a gap |
| **Next.js telemetry** | **Finding (Medium):** `scripts/start.py` and the frontend Dockerfile do not set `NEXT_TELEMETRY_DISABLED`. Next.js can send anonymous usage data during build and start. This contradicts "nothing leaves the machine". **Action:** F12.10 |
| Fonts and assets | Bundled at build time; no CDN calls at run time |

### F13 Security

**VERIFIED WORKING:**
- tokens and password sign-in with lockout;
- role permissions on every route, with denied-case tests;
- path containment and read-only originals;
- prompt-injection flags;
- the audit log;
- Semgrep, Trivy and dependency scans;
- ZAP scans with 0 failures;
- the F09.11 hardening review.

| Gap | Severity | Action |
|---|---|---|
| No per-collection or per-document permissions; any viewer can read every collection | **High** for the enterprise vision, Low for the single-user demo | F09.12, a FUTURE task. This is an auth change, so it needs Luke's decision |
| Data at rest is not encrypted by VAULT | Medium | Document it: use operating-system disk encryption. FUTURE task |
| No backup and restore command | Low | FUTURE task |

Do not claim certification, classified-data readiness or absolute protection. The docs comply today.

### F14 Auditability

VERIFIED WORKING. Every document records:
- its provider, model, locality and policy version;
- its quotes, each with a verified flag;
- its timings.

Approvals, denials and sign-ins are in the audit log. Test E checked the log entries against what actually happened.

### F15 User interface

The six screens are:
- Overview, with hardware and local models;
- Setup, for import;
- Run board;
- Investigate, for search, questions and evidence;
- Approvals;
- Security, with the audit log.

There is also a Training screen. 18 Playwright specs click through them in CI. The demo/real switch and the empty states are covered too. Mobile layout was checked earlier at 390 px; it was not re-checked today.

### F16 Deployment

| Item | Status |
|---|---|
| Windows one-command start (`start.ps1`) | VERIFIED WORKING on this laptop |
| Linux (`start.sh`) | IMPLEMENTED BUT UNVERIFIED, because there is no Linux machine here. CI runs on Linux, but not the launcher |
| Docker Compose | VERIFIED WORKING (F12.2) |
| CLI | VERIFIED WORKING (`test_cli.py`) |

### F17 Scalability

VAULT runs on one machine:
- SQLite with FTS5;
- an in-process job runner;
- job state stored in the database, so jobs resume after a restart.

| Today | Migration path (`docs/LONG_TERM_ROADMAP.md`) |
|---|---|
| SQLite | Postgres |
| In-process job runner | A queue with workers on several machines and several GPUs |
| Local file store | Object storage for originals |
| Full-text index only | A search service and vector search |

Nothing in the code blocks that move: storage access is behind `backend/storage` and the providers are behind one interface.

## 5. Original vision against today

| Original requirement | Current implementation | Gap | Priority | Action |
|---|---|---|---|---|
| Many file types | PDF, text, CSV, JSON; images stored only | Office files, OCR, vision, audio and video | P1 (Office files), P1 (vision, needs approval), FUTURE (audio and video) | F02.8, F04.10 and B7, roadmap |
| Organize messy collections | Classification, proposals, approval, copy-only export | Departments, undo of exports | P3 | Roadmap |
| Searchable organizational memory | Full-text search, filters, checked citations | Semantic search, per-collection access | P2, FUTURE | F06.6, F09.12 |
| Cross-document reasoning | Rating, quantity and material conflicts | Dates, revisions, missing fields | P3 | Roadmap |
| Teach by example | Rules, examples, training screen, measured gains | Visual markings | P1 (with vision) | F04.7 |
| Plain-language workflows | Layout requests, questions | General task planning | FUTURE | Roadmap |
| Structured database | Validated schema per document | Table export | **P1** | **F08.5** |
| Hardware profile and estimates | Measured, with ranges, checked against actual runs | None | none | none |
| Parallel workers | Lanes, retries, resume, memory guard | Multi-machine | FUTURE | Roadmap |
| Meta models | Llama 3 local, verified | Hosted API unverified, no vision | P0 (B1 and B2 with Luke) | F04.3, F12.4 |
| Local-first, offline | All local | Next.js telemetry; no unplugged test | **P1** | **F12.10** |
| Security | Strong for one organization | Per-collection permissions, encryption at rest | FUTURE | F09.12 |
| Audit trail | Complete | none | none | none |

**Critical omissions:** none that block the submission, apart from B1 (the rules check).

**Architectural deviations:** Next.js telemetry (F12.10). Nothing else.

**Misleading claims found:** none in the README or the UI. Two pieces of task evidence were out of date: F05.5 said "dedicated test pending", but `test_restart_resumes_unfinished_job` covers it. That is corrected in `TASKS.md`.

**Separate parts that do not work together:** none found. Training, corrections, investigation and proposals all read the same extractions.

## 6. Hackathon readiness

| Item | Status | Source |
|---|---|---|
| Deadline: Nov 4, 9:00 PM ET | Confirmed | https://dev.meta.ai/events/global-hackathon |
| Indie track: "individual builders and students"; judged on "creativity, technical ambition, and whether it works" | Confirmed | Same page |
| Allowed models: Muse Spark, Muse Image and SAM 3.1 through the Meta Model API, plus Meta open-weights models | Confirmed; Llama 3 is a Meta open-weights model | Same page |
| Video length, repository visibility, licence, AI coding assistant policy, banned project types | **UNVERIFIED.** The event page says "Official Rules will be published before the Hackathon begins". The participant portal loads with JavaScript and could not be read here | B1, for Luke |
| Solo entrant | The repository says solo (D-013). **Luke:** if the registration or team page on Cerebral Valley lists anyone else, correct it there. Changing these files does not change the registration | B1 |
| Repository | Public, Apache-2.0 | GitHub |
| Demo | A 3-minute script that uses only working features | `docs/DEMO_SCRIPT.md` |

## 7. Remediation roadmap

| Priority | Task | What | Who |
|---|---|---|---|
| P0 | B1 / F12.4 | Read the official rules in the portal and confirm solo registration | Luke |
| P0 | F11.4 | Final Llama evaluation on the frozen code (Nov 1) | Agent |
| P0 | F12.7, F12.8 | Record the video, then submit | Luke |
| P1 | F12.10 | Turn off Next.js telemetry in every start path | Agent, now |
| P1 | F08.5 | Export the extracted records as CSV and JSON, each row with its source document and page | Agent |
| P1 | F02.8 | Read DOCX, XLSX and PPTX text. File handling is high risk, so the merge needs Luke | Agent builds, Luke approves |
| P1 | F04.10 / B7 | Llama 3.2 Vision for images and scanned pages | Luke approves the download first |
| P2 | F06.6 | Semantic search | Agent, if time remains |
| FUTURE | F09.12 | Per-collection permissions | After the hackathon, with Luke's design approval |
| FUTURE | none yet | Audio and video, CAD, multi-machine workers, Postgres, encryption at rest, backup and restore | Roadmap |
