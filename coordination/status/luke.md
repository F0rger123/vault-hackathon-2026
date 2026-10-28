# Luke's agent: status

Last updated: 2026-10-28

## Now

- **Task:** F01.9 permanent project memory and coordination checks
- **Branch:** `luke/F01.9-project-memory`
- **State:** in progress
- **Also open:** F09.6 in [PR #32](https://github.com/F0rger123/vault-hackathon-2026/pull/32). CI is green; it waits for Luke to merge.
- **Next:** F09.7, the ZAP baseline scan against localhost.

## Waiting on

- **Luke:** merge PR #32, plus blockers B1–B5 ([`../BLOCKERS.md`](../BLOCKERS.md)).
- **Franco's agent:** has not joined. The welcome message (#26) has no reply yet.

## Updates

### 2026-10-28 17:30 UTC · F01.9 · review
- **Changes:**
  - New files: `PROJECT_VISION.md`, `PROJECT_STATE.md`, `AI_ONBOARDING.md`, `NEW_AGENT_BOOTSTRAP_PROMPT.md`, `AGENT_UPDATES.md`, per-agent `status/` files.
  - Rewrote `LONG_TERM_ROADMAP.md`. Renamed the protocol file to `AGENT_COMMUNICATION_PROTOCOL.md`.
  - Added `agent_mail.py claim` and `report`, `check_coordination.py`, the CI `coordination` job, a bug template and a PR template.
- **Tests:** 46 passed; coordination check ok. Subagent scenario check: three of three scenarios answered; the gaps it found are fixed.
- **Dependencies:** Franco now claims tasks with `agent_mail.py claim`, writes only `status/franco.md`, and joins by replying on #26.
- **Decisions:** D-011, per-agent status files and issue-based claims.
- **Next:** F09.7, the ZAP baseline.
- **GitHub:** luke/F01.9-project-memory

### 2026-10-28 15:40 UTC · F09.6 · review
- **Changes:** Semgrep and Trivy CI jobs, now blocking. The dependency audit is now blocking too. Added a weekly scheduled run, and fixed 8 fixable image CVEs plus 1 critical in the Dockerfiles.
- **Files:** .github/workflows/ci.yml, Dockerfile.backend, frontend/Dockerfile, docs/SECURITY.md
- **Tests:** Semgrep 0 findings, pip-audit 0, npm audit 0, Trivy 0 fixable. Both images rebuilt and checked. GitHub CI 6 of 6 green.
- **Dependencies:** none for Franco. The frontend image now starts with `node`, not npm.
- **GitHub:** PR #32, issue #8

### 2026-10-28 · F07.3 · completed
- **Changes:** experiment measuring corrections on held-out documents. Rule-based doc_type 0.889 to 0.978; Llama 3 unchanged, because no rule qualified.
- **GitHub:** PR #31 merged (`8094701`)

### 2026-10-26 to 2026-10-27 · history
- **Built:** the repository, backend MVP, dataset, CLI, evaluation and CI.
- **Merged:** PRs #27–#30. These added the orchestrator, the UI restyle, investigations and the demo reset.
- **Details:** git history and the `TASKS.md` evidence.
