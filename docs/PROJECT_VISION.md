# VAULT Project Vision

This is the permanent description of what VAULT is meant to become. It covers the whole product, not just what exists today. For what works right now, read [`coordination/PROJECT_STATE.md`](../coordination/PROJECT_STATE.md). For the order things get built in, read [`docs/LONG_TERM_ROADMAP.md`](LONG_TERM_ROADMAP.md) and [`coordination/TASKS.md`](../coordination/TASKS.md).

## One sentence

VAULT is a private document intelligence platform that runs on hardware the organization owns. It reads a large, messy archive with Meta models, proves every fact with a quote from the page, finds the places where documents disagree, and only changes anything after a person approves.

## Why it exists

Engineering firms, manufacturers, contractors and public agencies hold decades of drawings, inspection records, contracts, parts lists and memos. The facts that matter are often scattered across files that disagree with each other. A valve might be drawn at 1500 psi but tested at 600 psi. Nobody notices until an audit or a failure.

Cloud AI tools cannot help with the most sensitive of these archives. The documents are confidential, export-controlled, or simply not the organization's to share. So people cross-reference them by hand, and it takes days.

## Who it is for

| User | What they need from VAULT |
|---|---|
| Engineers and analysts | Find every document about a part, project or supplier. See conflicts with proof. Ask questions in plain language. |
| Document-control and QA teams | Classify an unsorted archive. Propose a clean folder structure. Correct mistakes once, and have the fix apply everywhere. |
| Administrators and security officers | Control where documents may go, approve every action, and read a complete audit log. |
| Leadership | Know how long a job will take and what it will cost before it starts. |

## Problems it solves

1. **Facts are spread across formats and naming schemes,** and keyword search misses layouts it has not seen.
2. **Disagreements between documents surface late.**
3. **Sensitive archives cannot go to a cloud AI.**
4. **AI answers without checked citations cannot be trusted** for engineering decisions.
5. **Bulk reorganization scripts are risky and irreversible.**
6. **Nobody knows how long processing will take** on the hardware they have.

## Principles that never change

- **Local first.** Documents stay on the machine. A remote model is used only when an administrator enables it *and* the person starting the job confirms it. Restricted files never leave, even then.
- **Evidence or nothing.** Every extracted fact and every answer points to a page and a verbatim quote. VAULT checks that the quote is really on the page, and flags it when it is not.
- **Propose, never act alone.** Reorganizations and other actions are proposals. Approval exports copies; originals are read-only and never move.
- **Honest about itself.** Measured numbers only. The rule-based baseline is always labelled "not AI". VAULT never claims to be unhackable or certified.
- **Document text is data, not instructions.** Models that read documents get no tools, no network and no filesystem access. Their output is parsed into a fixed schema.

## Capabilities

### Hackathon MVP (built for November 4, 2026)

| Area | What the MVP does |
|---|---|
| Document types | PDF, plain text, Markdown, CSV, JSON, logs, PNG and JPEG. Each file is checked by its content, hashed, de-duplicated and stored read-only. |
| AI extraction | Meta Llama 3 8B runs locally through Ollama. It extracts document type, project, date, parties, part numbers, pressure ratings and stamps into a fixed schema, with evidence quotes. The Meta Model API (Muse Spark) lane is built but not yet run with a real key. |
| Hardware awareness | Detects CPU, RAM, disk and GPU. Benchmarks a sample of real files on this machine, then predicts a finish time with an uncertainty range and recommends a worker count. |
| Parallel processing | A coordinator hands documents to parallel model lanes from a shared queue. Jobs are durable: they retry with backoff, can be cancelled, and resume after a restart. |
| Security gate | Reads every file before any model does. Pins export-controlled or personal files to local lanes, and flags text that tries to instruct an AI. |
| Search and investigation | Full-text search with page references and filters. Cross-document pressure-rating conflicts with evidence. Questions in plain language, answered with numbered citations that are checked against the sources. |
| Teach by example | A person corrects one document. The correction becomes a versioned rule that applies to similar documents on the next run. Labelled examples guide the model as few-shot guidance. The effect is measured on held-out documents. |
| Actions | Organization proposals, previewed as a folder tree, approved or rejected by an administrator. Approval exports copies. |
| Accountability | Role-based access enforced on the server. Every action, allowed or denied, is in the audit log. |
| Interfaces | REST API, a `vault` command-line tool, and a six-screen web interface. |
| Evaluation | A deterministic fictional dataset with planted problems, and a harness that scores every run against ground truth. |

### Long-term product (after the hackathon)

| Area | Where VAULT is headed |
|---|---|
| Document types | Scanned pages through OCR. Drawings, title blocks, stamps and symbols through vision models. Office formats. Email archives. Audio and video, such as meeting recordings and inspection footage. |
| AI capabilities | Several Meta models chosen per task, such as small fast models for triage and larger ones for reasoning. Domain-tuned evaluation suites per industry. Optional fine-tuning, only with explicit consent. |
| Reasoning | Conflicts in materials, quantities, revisions, dates and supplier obligations. Timelines of a part's history. Investigations that span thousands of documents. |
| Teach by example | Approved examples become retrievable guidance. Rules suggested automatically from repeated corrections, then reviewed by a person. |
| Workflow automation | Approved playbooks: route new documents, notify owners of conflicts, prepare audit packs. Each playbook runs through the same approval and audit path. |
| Scale | PostgreSQL and object storage, a durable distributed queue, pools of GPU servers, batching, and millions of documents. |
| Enterprise integrations | SharePoint, network drives, PLM and ERP connectors with least privilege. SSO (OIDC/SAML), SCIM, and per-document access control. |
| Security | Sandboxed parsing, token expiry and rotation, rate limiting, a tamper-evident audit log, SIEM export, and independent security audits. |

## Architecture in brief

FastAPI backend with SQLite and FTS5, a Next.js frontend, a Typer CLI, and a provider abstraction. The providers are local Ollama, the Meta Model API, and the rule-based baseline. Each layer was chosen so it can be swapped for its enterprise counterpart later without rewriting the rest. Details: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) and [`docs/MASTER_BLUEPRINT.md`](MASTER_BLUEPRINT.md).

## Commercial opportunity

- **First market:** engineering, manufacturing and infrastructure firms with large confidential archives and document-control teams.
- **Deployment:** an on-premises appliance or a self-hosted install, licensed per site or per seat, with enterprise support.
- **Later markets:** construction, energy, defence suppliers and public agencies. Each needs formal accreditation through proper channels before VAULT can make any compliance claim.
- **Differentiation:** structured extraction across every document, checked evidence, measured hardware planning, and approval-gated actions. Typical document chatbots answer one question at a time, with unchecked citations, in the cloud.

The licence and business model are not decided yet (blocker B3 in [`coordination/BLOCKERS.md`](../coordination/BLOCKERS.md)).
