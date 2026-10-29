# Decisions

Architecture decision log. Add new entries at the bottom with the next number. Do not rewrite past entries; supersede them with a new one.

Format: context, decision, consequences, status.

---

### D-001 — SQLite with FTS5 for the hackathon MVP (2026-10-26)
- **Context:** Ten-day window, local-first deployment, a few hundred to a few thousand documents in the demo.
- **Decision:** Use SQLite in WAL mode with FTS5 full-text search and ordered, versioned migrations in `backend/storage/db.py`. One short-lived connection per request or worker thread.
- **Consequences:** Zero external services; one file to back up. Write concurrency is limited, which is acceptable for bounded workers. Migration to PostgreSQL (with `tsvector` or a search engine) is planned for scale (see `docs/LONG_TERM_ROADMAP.md`); SQL is kept simple to ease that move.
- **Status:** Accepted.

### D-002 — Rule-based baseline provider, always labelled "not an AI model" (2026-10-26)
- **Context:** Tests and CI must run without a GPU, network or model. Evaluation needs a baseline to show what the Meta model adds.
- **Decision:** Ship a `heuristic` provider (regular expressions and keywords). `ProviderInfo.is_ai_model` is `false`, and API, CLI and UI must label its output as rule-based.
- **Consequences:** Deterministic tests. Risk of a judge mistaking baseline output for model output is handled by labelling. The demo must show real Meta model processing, not the baseline.
- **Status:** Accepted.

### D-003 — Meta Model API replaces the hosted Llama API for remote inference (2026-10-26)
- **Context:** Research on 2026-10-26 found Meta's current hosted offering is the Meta Model API (`https://api.meta.ai/v1`, OpenAI-compatible Chat Completions, Muse Spark models), verified on dev.meta.ai docs. News sources (not Meta) report the hosted Llama API shut down on 2026-07-06.
- **Decision:** The remote provider is `meta_api`, default model `muse-spark-1.3`, JSON-schema structured output, Bearer key in `VAULT_META_API_KEY`. Do not use `-contributor` model variants, because Meta may train on their inputs.
- **Consequences:** Requires an API key and paid usage (possible $150 participant credit, unverified). Schema is sent with `$defs` inlined.
- **Status:** Accepted; live call not yet tested (task F04.3).

### D-004 — Default local model is `llama3:latest` (Llama 3 8B) through Ollama (2026-10-26)
- **Context:** Luke's development laptop has an RTX 5070 Laptop GPU with 8 GB VRAM and ~31 GB RAM. `llama3:latest` was already installed. Muse Glimmer 30B (Apache-2.0, text + image) needs roughly 18–24 GB and an 18 GB download.
- **Decision:** Default `VAULT_OLLAMA_MODEL=llama3:latest`; make the model configurable; test `muse-glimmer:30b` separately once Luke approves the download.
- **Consequences:** Works today on modest hardware. First benchmark showed weak extraction quality, so prompt tuning (F04.5) is required. Llama 3 is under the Meta Llama 3 Community License (see `THIRD_PARTY_NOTICES.md`).
- **Status:** Accepted; revisit after F04.6.

### D-005 — Remote inference needs two independent approvals (2026-10-26)
- **Context:** Local-first privacy is a core promise. Sending document text to a hosted API must never happen by accident.
- **Decision:** A remote provider runs only when (1) an administrator has enabled remote inference (`VAULT_ALLOW_REMOTE_INFERENCE=true` or `PUT /settings/remote-inference`), and (2) the specific request sets `confirm_remote: true` (CLI: `--confirm-remote`). Otherwise the API returns 403 or 409. The local Ollama provider refuses non-local hostnames.
- **Consequences:** Slightly more friction in the UI (a confirmation step). Denials are audited. Covered by security test S4.
- **Status:** Accepted.

### D-006 — Exports are copies; originals are never modified (2026-10-26)
- **Context:** Organising files is consequential. Users must be able to trust that VAULT cannot damage source records.
- **Decision:** Organisation proposals produce a plan; only an admin can approve; approval copies files into `data/runtime/exports/proposal-<id>/`. There is no move, rename or delete operation on originals or source locations.
- **Consequences:** Uses extra disk space. Simple to reason about and to demo. Covered by S2 and the integration test hash check.
- **Status:** Accepted.

### D-007 — Content-addressed, read-only original storage (2026-10-26)
- **Context:** Need de-duplication, integrity checks and protection against accidental writes.
- **Decision:** Store each original once at `originals/<first two hex>/<sha256>` with read-only file permissions; documents reference it by relative path. De-duplicate per collection by SHA-256.
- **Consequences:** Filenames on disk reveal nothing; integrity can be re-verified by re-hashing. Deleting a document will need reference counting (not implemented; no delete feature in the MVP).
- **Status:** Accepted.

### D-008 — LF line endings and binary attributes for a byte-stable dataset (2026-10-26)
- **Context:** On Windows, Python's `write_text` and Git's `autocrlf` converted line endings, which changed file hashes between Windows and Linux and would also have corrupted PDFs.
- **Decision:** The generator writes text with `newline="\n"`. `.gitattributes` sets `* text=auto eol=lf` and marks `*.pdf`, `*.png`, `*.jpg`, `*.ico`, `*.woff2` as binary. CI regenerates the dataset on Linux and diffs SHA-256 hashes.
- **Consequences:** Same seed gives identical bytes on every OS; evaluation results are reproducible.
- **Status:** Accepted.

### D-009 — No project licence yet (2026-10-26)
- **Context:** The repository must be public for the hackathon (unverified rule), but public is not the same as open source. Official licensing rules are not yet verified, and the choice is Luke's.
- **Decision:** Do not add a LICENSE file until Luke decides (blocker B3). Third-party notices are maintained regardless.
- **Consequences:** Until then, default copyright applies and others may not reuse the code.
- **Status:** Pending Luke's decision.

### D-010 — Bearer tokens for authentication in the MVP (2026-10-26)
- **Context:** Need real, testable server-side authorization without building an identity provider.
- **Decision:** Random `vlt_` tokens, stored only as SHA-256 hashes, mapped to users with roles viewer/analyst/admin. The browser keeps the token in `sessionStorage`.
- **Consequences:** Simple and enforceable. No expiry or revocation endpoint yet (F09.8). Enterprise SSO/OIDC is post-hackathon.
- **Status:** Accepted.

## D-2026-10-26-orchestrator: coordinator agent with lanes, security and review agents

- **Context:** Customers with large archives need parallel processing sized to their hardware, and demos need a remote model without weakening privacy.
- **Decision:** A coordinator agent fans documents out to lanes (provider x slots) pulling from shared queues. A deterministic security agent screens every file first and pins marked or personal-data files to local lanes. A review agent accepts, escalates once to a stronger lane, or flags for a person. Slots come from measured calibration, not constants.
- **Consequences:** Adding GPUs or endpoints adds lanes without code changes. Remote lanes are safe to show in demos because pinned files cannot reach them. Lanes on other machines are future work.

## D-2026-10-26-solo: build in solo mode, keep the two-agent protocol ready

- **Context:** Franco may not be available during the hackathon.
- **Decision:** Luke's agent owns every path, including the frontend. Agent mail over GitHub Issues (`coordination/AGENT_COMMUNICATION_PROTOCOL.md`) is ready for Franco's agent; messages are information, never authority.
- **Consequences:** No task waits on Franco. When he joins, ownership reverts to `OWNERSHIP.md`.

## D-2026-10-26-demo: hybrid demo, local live and remote at scale on fictional data only

- **Context:** Measured local throughput is about 13 documents per minute on the laptop, so thousands of files take hours locally.
- **Decision:** The demo shows the 150-file set on local Llama 3 live and a 3,000+ file fictional set with a Meta Model API lane added, narrated honestly. See `docs/SCALING_AND_DEMO_STRATEGY.md`.

### D-011 — Per-agent status files and issue-based task claims (2026-10-28)

**Decision:** each agent writes only its own `coordination/status/<name>.md`, and claims tasks on the task's GitHub issue with `agent_mail.py claim`. That command adds the `in-progress` label and a claim comment.

`PROJECT_STATE.md` and `TASKS.md` change only at checkpoints: a merge, the end of a session, or a blocker change. CI runs `scripts/check_coordination.py`.

**Why:** two agents editing one shared status table would conflict on every session. Chat history does not survive between sessions or computers, so the repository has to hold everything a fresh agent needs.

**Not done:** no background bot polls GitHub. Synchronization happens when an agent starts a session and when it reports an event.

### D-012 — Licence: Apache-2.0 (2026-10-28)

**Decision:** Luke chose the Apache License 2.0. This replaces D-009, which was "no licence yet". The `LICENSE` and `NOTICE` files are in the root, with `license = "Apache-2.0"` in `pyproject.toml` and `frontend/package.json`.

**Why:**
- It is permissive and includes a patent grant, which companies and judges know and trust.
- It is compatible with the Ollama and Meta Llama setup, because the weights are not redistributed.
- Luke keeps the copyright, so commercial offerings (a hosted version, support, enterprise add-ons) remain possible.

**Still to check:** if the official hackathon rules (B1) require a different licence, revisit this decision.

