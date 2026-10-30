# Long-Term Roadmap

This is the whole roadmap, from what already works to research ideas. Task-level detail, owners and evidence live in [`coordination/TASKS.md`](../coordination/TASKS.md), which wins if the two disagree. The product these features add up to is described in [`docs/PROJECT_VISION.md`](PROJECT_VISION.md).

**Rule:** a feature moves up a section only when it is implemented, tested and verified, with evidence recorded in `TASKS.md`. Nothing aspirational is listed as implemented.

## 1. Implemented (verified locally, merged to `main`)

| Feature | Task IDs | Outcome |
|---|---|---|
| Ingestion with content validation, hashing, de-duplication and read-only originals | F02.1–F02.5 | 157 files imported, 0 failures |
| Hardware profile, inventory, sample benchmark and runtime estimate | F03.1–F03.4 | Measured finish-time prediction before a run |
| Provider abstraction: local Meta Llama 3 (Ollama), rule-based baseline | F04.1, F04.2, F04.4 | Schema-validated extraction with checked quotes |
| Durable parallel jobs with retries, cancellation and resume | F05.1–F05.5 | Restart-safe processing |
| Coordinator, security gate, extractor lanes and reviewer agents | F05.7, F05.8 | 3,700-file run planned and measured |
| Full-text search, filters, rating conflicts with evidence | F06.1–F06.3 | 10 of 10 planted conflicts, 0 false alarms |
| Natural-language investigation with checked citations | F06.4 | 5 of 5 demo questions answered; unsupported numbers flagged |
| Corrections as versioned rules; teach by example; held-out measurement | F07.1, F07.2, F07.3, F07.5 | Rule-based held-out doc type 0.889 to 0.978 |
| Proposals, approval, copy-only export | F08.1–F08.3 | Originals untouched, every step audited |
| Auth and roles, audit log, injection containment, path containment, remote-inference gate, sensitivity routing | F09.1–F09.5, F09.9 | Security tests S1–S10 pass |
| Synthetic dataset, scale generator, evaluation harness | F11.1–F11.3, F11.7 | Deterministic, scored runs |
| Demo reset script | F12.6 | Clean demo in about 12 s |
| Web interface, browser tests, scanning, ZAP, CLI, Docker, licence | F10.1–F10.13, F11.5, F09.6, F09.7, F12.1, F12.2, F12.5 | Eight screens; CI runs every check |
| Office files, path import, estimate calibration, worker limits | F02.7, F02.8, F03.5, F05.6, F05.10 | Reads only new documents |
| One-click model installs; the brain per collection with gap questions and a 3D map | F03.7, F07.7–F07.10 | Teaching never crosses collections |
| Quantity and material conflicts, dataset v2, narrowing, table export, plain-language layouts | F04.11, F06.5, F06.7, F08.4, F08.5, F11.6 | Llama 3: 5 of 5 quantity conflicts |
| Share packs, encrypted transfer, desktop window | F08.6, F12.11, F12.12 | Redacted copies with a report; one encrypted file |
| Token lifecycle, security gate, passkeys, hardening | F09.8, F09.11, F09.13, F09.14 | Active content held; face, fingerprint or hardware key |

## 2. Left before the November 4 deadline

| Item | Task IDs | Who | Expected outcome |
|---|---|---|---|
| Official rules check | F12.4 (B1) | Luke | Video length, repository, licence and model rules confirmed |
| Final evaluation on frozen code | F11.4 | Agent, Nov 1 | Final figures committed |
| Demo video and submission | F12.7, F12.8 | Luke, Nov 3–4 | Submission accepted |
| Meta Model API lane, first real call | F04.3, F05.9 (B2) | Luke, optional | Authenticated run |

## 3. Next, needing a decision or a model download

| Feature | Task IDs | Needs | Expected outcome |
|---|---|---|---|
| Reading photos, stamps and scanned pages | F02.6, F04.7, F04.10, F07.4 | Llama 3.2 Vision download (B7) | Images become searchable text |
| Muse Glimmer 30B local test | F04.6 | Download (B5) | Quality and speed comparison |
| Semantic search | F06.6 | A local embedding model | Finds by meaning |

## 4. Gaps this review found (2026-10-30), not yet built

| Gap | Task ID | Why it matters |
|---|---|---|
| Data at rest is not encrypted by VAULT | F09.15 | A stolen disk exposes documents unless BitLocker or LUKS is on |
| Parsers run inside the API process | F09.16 | A parser exploit would reach the API; run them in a separate, limited process |
| Installing models needs Ollama's registry | F03.8 | Disconnected sites need install from a checked file |
| Per-collection permissions | F09.12 | Any viewer can read every collection |
| Backup and restore on a schedule | none yet | `vault transfer` is manual |
| Progress streaming; side-by-side evidence viewer | none yet | Polling today; quotes are text only |
| Installers for Windows and Linux | none yet | The desktop window still needs Python and Node |

## 5. Enterprise features

| Feature | Purpose | Depends on | Expected outcome |
|---|---|---|---|
| PostgreSQL (JSONB extractions) and S3-compatible storage | Millions of documents | Storage abstraction | Horizontal scale |
| Durable distributed queue (Redis Streams, NATS or Postgres) and stateless workers | Many machines | Job/item schema (already compatible) | Workers added without downtime |
| GPU server pools, vLLM serving, provider routing by load | Throughput | Queue | Predictable cost per document |
| Dedicated search index (OpenSearch or Tantivy) | Fast search at scale | PostgreSQL | Sub-second search over millions of pages |
| SSO (OIDC/SAML), SCIM, session cookies | Enterprise identity | Token lifecycle | Central account management |
| Per-collection and per-document access control, classification labels | Need-to-know | SSO | Search shows only what a user may see |
| Connectors: SharePoint, network drives, PLM, ERP | Bring documents in where they live | Access control | Least-privilege sync |
| Workflow playbooks (route, notify, prepare audit packs) | Automation with approval | Proposals, audit | Repeatable approved workflows |
| Rate limiting, tamper-evident audit (hash chaining), SIEM export | Security operations | Audit log | Evidence that holds up in review |
| Independent security audit and penetration test | Assurance | Feature-complete release | Published findings and fixes |
| Compliance pathways (SOC 2, ISO 27001; government frameworks only through proper accreditation) | Regulated buyers | Audit | Formal certification, never self-claimed |
| Packaging, licensing, support and SLAs | Commercial deployment | Licence decision (B3) | Sellable product |

## 5a. Luke's requests of 2026-10-29, and where each stands

| Request | Status | Next step |
|---|---|---|
| Setup scans the machine and installs the Meta models that fit | **Built** (F03.7, merged) | None |
| One brain per project or division, taught in plain words, that asks about its gaps | **Built** (PR #70, needs Luke's OK for its additive migration) | A scheduled self-check that re-reads only the documents a new answer affects |
| A map of the brain you can click through | **Built in 2D** (PR #70) | 3D needs a library such as three.js, a new dependency, so Luke decides. The 2D map stays as the accessible default |
| Photos: read them, find "the photo of X", show 50 candidates and learn from "not these" | Not built | Needs the Llama 3.2 Vision download (B7). Then describe each image locally, search the descriptions, and add "more like this / not these" feedback that becomes labelled examples. Recognising specific employees' faces is biometric data: it needs consent and a legal check, so only do it on Luke's explicit decision |
| Video | Not built | Sample frames every few seconds and read them with the vision model; index the transcript (below) with timestamps. A terabyte of video needs the multi-machine queue (section 5) |
| Audio | Not built | No Meta speech model runs in Ollama today. Options: Meta's open Seamless models (heavy, outside Ollama), or an open non-Meta transcriber, run locally. Either way the transcript then flows through the normal reading path |
| Sort and label by markings, with named folders and subfolders | **Built**: plain-language layout requests (F08.4), approval, copy-only export | Choose an export folder inside an allowed root (file handling, needs Luke's OK). Originals are never moved, by design (D-006, D-007) |
| Share only some data with a buyer (M&A data room) | Partly: filters and copy-only export exist | A "share pack": pick by project, type or marking, leave out CONFIDENTIAL and restricted documents, redact named fields, and add a manifest of what was left out and why |
| Biometric or face unlock | Not built | Recommended: passkeys (WebAuthn). They use Windows Hello face or fingerprint, Touch ID or a YubiKey. The face or fingerprint never leaves the device, and VAULT stores no biometric data. This is an auth change, so Luke approves it. For servers, also offer smart cards or hardware keys |
| A terabyte, millions of files, on a $50,000 server | The architecture allows it; not built for this scale | Postgres, a job queue with workers on several GPUs, incremental indexing, object storage. Estimates already scale with measured throughput |
| Pen-test it | **Guide written**: `docs/PENTEST_GUIDE.md` | Luke runs the tools; findings go into `docs/SECURITY.md` |

## 6. Research and experimental

| Idea | Purpose | Open question |
|---|---|---|
| Diagram understanding (symbols, dimensions, revision clouds) | Read drawings like an engineer | Which Meta vision model is accurate enough locally |
| Audio and video analysis | Meeting recordings, inspection footage | Speech and vision model quality on technical vocabulary |
| Automatic rule suggestion from repeated corrections | Less manual teaching | How to avoid rules that overfit, like the inspector-name rules seen in F07.3 |
| Consent-based fine-tuning on approved examples | Domain accuracy | When it beats few-shot guidance enough to be worth the cost |
| Local-model optimization (quantization, speculative decoding, caching) | Faster on laptops | Quality loss per speed gain |
| Domain evaluation suites per industry | Trustworthy numbers | Licensing realistic test data |
