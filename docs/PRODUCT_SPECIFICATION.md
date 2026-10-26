# VAULT Product Specification

## Product statement

VAULT helps organizations understand large, sensitive document collections on their own hardware. It extracts facts with a Meta model, finds conflicts across documents with checkable evidence, and proposes reorganizations that a human must approve.

## Personas

| Persona | Role in VAULT | Needs |
|---|---|---|
| Analyst / engineer | `analyst` | Import, process, search, investigate, propose, correct |
| Reviewer / viewer | `viewer` | Read documents, search, see findings |
| Administrator | `admin` | Approve proposals, enable remote inference, read the audit log, manage users |

## Scope for the hackathon (MVP)

**In scope**

- Collections of PDF, PNG, JPEG and text files (txt, md, csv, json, log), up to the configured size limit.
- Extraction fields:
  - document type (engineering_drawing, inspection_report, contract, parts_list, revision_history, project_memo, other)
  - title, project, date, summary, parties
  - components (part number, description, pressure rating in psi, material, quantity)
  - stamps
  - evidence quotes
- Cross-document pressure-rating conflict detection.
- Full-text search with structured filters.
- Organization proposals with approval and copy-only export.
- Corrections that become versioned rules.
- Hardware profile, inventory, and measured runtime estimate.
- Provider selection, with a privacy disclosure for each provider.
- REST API, CLI, and browser UI.

**Out of scope for the MVP**

- OCR and vision analysis of images. A stamp image currently records only its dimensions.
- Audio and video.
- SSO or LDAP.
- Multi-tenant deployments.
- Document-level ACLs.
- Editing or deleting originals.
- Free-form chat.

## Functional behavior

### Import

- Accepted files return `document_id`, `sha256`, `page_count`, `media_type` and a `duplicate` flag.
- Rejected files return a reason the user can read: unsupported type, mismatched extension, too large, corrupt PDF, encrypted PDF, or too many pages.
- Path import is admin-only and restricted to `VAULT_IMPORT_ROOTS`.

### Inventory and estimate

- Inventory shows counts by media type, total bytes and pages, the hardware profile, and a recommended worker count with the reason.
- The estimate processes a random sample of 1–20 documents with the chosen provider. It returns median and p90 milliseconds per document and a projected low/high total.
- Results from the sample are stored, so the sample work is not wasted.

### Processing

- A job processes every document in a collection with the chosen provider and number of workers.
- Progress shows done and failed counts, per-item status and errors.
- Cancel stops items that have not started yet.

### Search and findings

- Search returns the document, page, snippet, type, project, date, part numbers and `extracted_by` (provider:model).
- A finding gives a summary, a status (`verified` or `needs_review`), and evidence: one entry per document, with page and quote.

### Corrections

- A user corrects `doc_type` or `project` on a document.
- An optional `when_contains` phrase creates a rule that applies to similar documents on the next processing run.

### Proposals

- The default pattern is `{project}/{doc_type}/{year}`.
- The preview lists the target path for each document.
- Approval copies the files into a new export folder. Originals never change.

### Privacy controls

- The UI shows the active provider, whether processing is local or remote, and the model.
- A remote provider needs two things: an admin toggle (`PUT /settings/remote-inference`) and `confirm_remote: true` on each job or estimate.

## Acceptance criteria for the MVP demo

1. The 150-file synthetic collection imports with zero rejections.
2. The estimate shows measured numbers for this machine.
3. Processing with a Meta model completes, and the UI shows each document's provider and model.
4. A planted rating conflict appears with evidence from both documents.
5. A proposal is approved by an admin. The export holds copies, and the hashes of the originals are unchanged.
6. A viewer's attempt to upload is rejected and appears in the audit log.

Items 1, 2, 4, 5 and 6 are verified at the API level by automated tests, using the heuristic provider. Item 3 still has to be verified end to end in the UI with a Meta model.

## Non-goals and honest limits

- VAULT is not certified for classified, ITAR, HIPAA or any other regulated data.
- Policy rules are not model training.
- Conflict detection currently covers pressure ratings only.
