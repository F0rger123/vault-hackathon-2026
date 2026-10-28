# Luke's agent: status

Last updated: 2026-10-28

## Now

- **Merged 2026-10-28:**
  - #32 (F09.6), #33 (F01.9), #34 (F09.7), #35 (F11.5);
  - #37 (F12.1), #38 (F12.2), #39 (F04.8), #40 (F03.5);
  - #41 (F04.9), #43 (F05.6).
- **Merged since:** #51 (F11.6 dataset v2), #53 (F06.5 quantity and material conflicts).
- **Open:** #45 (F08.4), #47 (F02.7), #49 (F09.8). All three have green CI or have CI running. Each needs Luke; see "Waiting on".
- **Next:** F11.6 dataset v2 and F06.5, the new conflict kinds. F11.4 is scheduled for Nov 1.

## Waiting on

- **Luke, PRs to review and merge:**
  - [#45](https://github.com/F0rger123/vault-hackathon-2026/pull/45), F08.4 plain-language layout requests. CI is green. My merge was blocked by the session's permission check, which flagged it as "merge without review". It adds a new endpoint, a UI button and a contract change.
  - [#47](https://github.com/F0rger123/vault-hackathon-2026/pull/47), F02.7 background path imports. High-risk (file handling); I will not merge it myself.
  - [#49](https://github.com/F0rger123/vault-hackathon-2026/pull/49), F09.8 token revocation and expiry. High-risk (auth and a migration); I will not merge it myself.
- **Luke, decision: OCR for scanned pages (F02.6).** Choose one of three:
  - Tesseract: a separate Windows install, Apache-2.0.
  - A Python OCR package: about 100 MB of dependencies.
  - Skip OCR for the hackathon. This is my suggestion: the 5 scanned v2 pages are documented as unreadable without it.
- **Luke, blockers:** B1 rules, B2 Meta API key, B3 licence, B4 partner credits, B5 Muse Glimmer ([`../BLOCKERS.md`](../BLOCKERS.md)).
- **Luke, optional:** allow force-pushes to my own `luke/*` branches. One was refused when I tried to clean up a bad commit; I closed PR #36 instead, and it contained no secrets.
- **Franco's agent:** has not joined. The welcome message (#26) has no reply yet.

## Updates

### 2026-10-28 17:10 UTC · F11.6, F06.5 · completed; F11.4 · dry run
- **Merged:** dataset v2 (#51) and quantity and material conflict checks (#53).
- **Rules baseline:** 5 of 5 and 5 of 5. Llama 3 finds materials 5 of 5 but quantities 0 of 5; a prompt fix broke ratings, so it was reverted.
- **F11.4 dry run on fresh seed 2027:** Llama 3 held-out doc_type 0.918 and rating conflicts 10 of 10. The final run is Nov 1.
- **Unblocked Luke work left:** only the F11.4 final run, which is scheduled. Everything else waits on Luke (PRs, B1–B5, OCR choice).

### 2026-10-28 23:30 UTC · loop checkpoint · handoff
- **Verified and merged:**
  - F11.5 browser tests: 14 tests in CI, and they found a sign-in race.
  - F12.1 CLI tests and F12.2 Docker Compose end to end.
  - F04.8 privacy disclosure in the UI.
  - F03.5 estimate compared with the actual run: Llama estimates run about 2x high, because of model load.
  - F04.9 response cache: a second Llama run took 5 s instead of 79 s.
  - F05.6 worker fault tests and a memory guard.
- **Built, waiting for Luke:** F08.4 (Llama 3 scored 8 of 8 on held-out requests), F02.7 and F09.8.
- **Mistake:** PR #36 accidentally included build output and demo-file copies, because `git add -A` ran on a branch without the new ignore rules. It held no secrets; it was closed unmerged and replaced by #37. I now stage named files only.
- **Tests on main:** pytest 62, e2e 13 (14 with #45).

### 2026-10-28 20:00 UTC · F11.5 · review
- **Changes:** Playwright suite in `tests/e2e/` with 13 tests over every screen, all three roles and phone width. `npm test` seeds, serves and runs everything. Added a CI job, `e2e`.
- **Also:** F10.1–F10.10 moved to VERIFIED, with the suite as their evidence.
- **Bug the suite found:** a sign-in message race in `session.tsx`, now fixed.
- **Tests:** 5 fresh runs of 13 of 13; pytest 47 passed.
- **Dependencies:** Franco can extend `tests/e2e/specs/`. Run `npm test` before UI PRs.
- **GitHub:** luke/F11.5-e2e, issue #20

### 2026-10-28 18:30 UTC · F09.7 · review
- **Changes:** ran ZAP scans of our own stack in an isolated Docker network: a frontend baseline scan, and an authenticated active API scan. Both had 0 failures. Added CSP and other security headers to the frontend, and CORP to the API.
- **Files:** frontend/next.config.ts, backend/main.py, docs/SECURITY.md, tests/security/test_security.py
- **Tests:** 42 passed on that branch. All six screens and the Ask panel work under the CSP, with no console errors.
- **Dependencies:** Franco must add any new external origin to the CSP in `next.config.ts`.
- **GitHub:** PR #34, issue #9 (claimed with `agent_mail.py claim`, reported with `report`)

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
