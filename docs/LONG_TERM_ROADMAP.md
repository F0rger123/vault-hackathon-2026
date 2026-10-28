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

## 2. Current MVP (in progress before the November 4 deadline)

| Feature | Task IDs | Purpose | Depends on | Expected outcome |
|---|---|---|---|---|
| Six-screen web interface | F10.1–F10.10 (REVIEW) | Demo and daily use | API | Browser flows verified by e2e tests |
| Browser end-to-end tests | F11.5 | Prove the UI works, not just the API | F10.x | Playwright suite in CI |
| Dependency and static scanning | F09.6 | Catch known vulnerabilities automatically | CI | Blocking Semgrep, Trivy, pip-audit and npm audit |
| Controlled security verification | F09.7 | ZAP baseline against our own localhost | Running app | Triaged report |
| Meta Model API lane | F04.3, F05.9 (BLOCKED on B2) | Remote Meta inference at scale | API key, spend approval | First authenticated run |
| Full local evaluation, final figures | F11.4 | Honest results for the submission | F04.5 | Committed result files |
| CLI and Docker verification | F12.1, F12.2 | One-command install | — | Verified on a clean machine |
| Compliance, licence, video, submission | F12.4, F12.5, F12.7, F12.8 | Submit on time | B1, B3 | Submission accepted |

## 3. Near-term improvements (right after the MVP, or sooner if time allows)

| Feature | Task IDs | Purpose | Depends on | Expected outcome |
|---|---|---|---|---|
| OCR for scanned PDFs and images | F02.6 | Read scanned archives | Local OCR engine | Text from image-only pages |
| Path import for server-side collections | F02.7 | Import large folders without upload | Admin import roots | Thousands of files in one step |
| Estimate calibration against actual runs | F03.5 | Better finish-time predictions | Run history | Smaller prediction error |
| Muse Glimmer 30B local test | F04.6 (needs B5) | Larger local Meta model | 18 GB download | Quality and speed comparison |
| Vision for stamps, photos and drawings | F04.7, F04.10 | Understand images | Vision-capable Meta model | Stamps and title blocks extracted |
| Worker robustness and resource limits | F05.6 | Survive hostile or huge files | — | Bounded memory and time per file |
| More relationship checks (material, quantity, revision, dates) | F06.5 | Catch more kinds of disagreement | Extraction fields | New finding types with evidence |
| Token lifecycle | F09.8 | Expiry, rotation, revocation | — | Short-lived sessions |
| Dataset v2 | F11.6 | Scanned pages and new anomaly kinds | Generator | Harder evaluation |

## 4. Post-hackathon priorities

| Feature | Task IDs | Purpose | Depends on | Expected outcome |
|---|---|---|---|---|
| Semantic (embedding) retrieval | F06.6 | Find documents by meaning, where it measurably helps | Local embedding model | Higher recall on paraphrased questions |
| Example-based teaching for new markings | F07.4 | Teach new layouts from a few examples | F07.5 | New document types without code |
| Natural-language organization requests | F08.4 | "Group by supplier and year" in plain words | F08.1 | Proposals from a sentence |
| Export to a searchable database file | F08.5 | Hand results to other tools | F08.3 | Portable SQLite export |
| Progress streaming (SSE) | — | Replace polling | Jobs API | Live updates without refresh |
| Side-by-side PDF evidence viewer | — | See both pages of a conflict | F10.6 | Highlighted quotes on the page |
| Sandboxed parsing in a separate worker process | — | Contain parser exploits | F05.6 | Parser crashes cannot reach the API |

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

## 6. Research and experimental

| Idea | Purpose | Open question |
|---|---|---|
| Diagram understanding (symbols, dimensions, revision clouds) | Read drawings like an engineer | Which Meta vision model is accurate enough locally |
| Audio and video analysis | Meeting recordings, inspection footage | Speech and vision model quality on technical vocabulary |
| Automatic rule suggestion from repeated corrections | Less manual teaching | How to avoid rules that overfit, like the inspector-name rules seen in F07.3 |
| Consent-based fine-tuning on approved examples | Domain accuracy | When it beats few-shot guidance enough to be worth the cost |
| Local-model optimization (quantization, speculative decoding, caching) | Faster on laptops | Quality loss per speed gain |
| Domain evaluation suites per industry | Trustworthy numbers | Licensing realistic test data |
