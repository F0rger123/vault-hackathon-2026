# Status: Luke and his AI coding sessions

Last updated: 2026-10-29

## Now

- **Merged 2026-10-28 and 29:** every open PR, through #58, including easy start (F10.11), Training (F07.6), the security hardening (F09.11), the one-command start with the new logo (F12.9, F10.12), and the Apache-2.0 licence.
- **In progress:** F01.10, which removes the second-developer plan; VAULT is a solo indie project.
- **Next:** the highest READY task in `TASKS.md`. F11.4 is the final evaluation, on Nov 1.

## Waiting on

- **Luke, decision: OCR for scanned pages (F02.6).** Suggestion: skip it for the hackathon.
- **Luke, blockers:**
  - B1: verify the hackathon rules.
  - B2: Meta API key (optional).
  - B4: partner credits.
  - B5: Muse Glimmer download (optional).
  - B7: approve the Llama 3.2 Vision download (about 8 GB), so VAULT can read images and scanned pages offline.
- **Luke, registration:** check that the Cerebral Valley registration lists you as a solo Indie entrant. Repository files do not change the registration.
- **Luke, approval:** merge PR #66 (F02.8 Office documents). CI is green, but it is file handling, so it needs your OK.
- **Luke, approval:** merge PR #70 (the collection brain and its map). CI is green. It adds one table (migration 6, additive only), so it needs your OK.
- **Luke, decisions:** passkey sign-in with face or fingerprint (an auth change); a 3D brain map (adds three.js); face recognition of employees (biometric data, so a consent and legal question).
- **Luke, Nov 3:** record the video from `docs/DEMO_SCRIPT.md`.

## Updates

### 2026-10-29 evening · F03.7 · completed; collection brain (PR #70) · review
- **Merged:** #68. Overview now lists the Meta models this computer can run and installs them with one click. Admin only, catalog only, audited.
- **PR #70, green, waiting for Luke:** a separate brain per collection, with meanings, instructions and gap questions, plus an interactive map. It also fixes rules and examples leaking between collections.
- **On main:** `docs/PENTEST_GUIDE.md`, and the roadmap section 5a covering photos, video, audio, the data room, passkeys and scale.

### 2026-10-29 · F12.10, F08.5 · completed; F02.8 · review
- **Merged:** #62 turns off Next.js telemetry in every start path. #64 exports records as CSV or JSON, one row per part with file, page and quote, from a new panel on Investigate.
- **PR #66 (F02.8), green and waiting for Luke:** Word, Excel and PowerPoint import, with zip-bomb, macro and DTD checks.
- **Next:** nothing unblocked at P0/P1 until the F11.4 final run on Nov 1. F06.6 (semantic search, P2) needs an embedding model, which is a download, so it waits for Luke.

### 2026-10-29 · audit · completed
- **Audit:** `docs/FINAL_COMPREHENSIVE_AUDIT.md`. Workflows A–E and G pass on a fresh VAULT, and real Llama 3 inference is verified. 115 pytest pass, every scan is clean, and CI is green.
- **Gaps found:** Office files, reading images and scanned pages, table export, per-collection permissions, Next.js telemetry, and the unverified official rules (B1).
- **New tasks:** F02.8, F08.5 (raised to P1), F09.12 (FUTURE), F12.10. New blocker: B7 (vision model download).
- **Next:** F12.10, then F08.5, then F02.8.

### 2026-10-29 01:20 UTC · F04.11 · completed
- **Merged:** #60. After Llama answers, VAULT fills empty quantity and material fields from the part's own line, with an evidence quote for each value.
- **Llama 3 on v2:** quantity conflicts 0 to 5 of 5, rating conflicts still 10 of 10, held-out rating accuracy unchanged at 0.823.
- **Next:** no unblocked P0/P1 task is left before the F11.4 final run on Nov 1. F04.6 needs the Muse Glimmer download (B5). F04.3, F05.9 and F12.4 wait on B1 and B2.

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
- **Dependencies:** run `npm test` in `tests/e2e/` before UI PRs.
- **GitHub:** luke/F11.5-e2e, issue #20

### 2026-10-28 18:30 UTC · F09.7 · review
- **Changes:** ran ZAP scans of our own stack in an isolated Docker network: a frontend baseline scan, and an authenticated active API scan. Both had 0 failures. Added CSP and other security headers to the frontend, and CORP to the API.
- **Files:** frontend/next.config.ts, backend/main.py, docs/SECURITY.md, tests/security/test_security.py
- **Tests:** 42 passed on that branch. All six screens and the Ask panel work under the CSP, with no console errors.
- **Dependencies:** any new external origin must be added to the CSP in `next.config.ts`.
- **GitHub:** PR #34, issue #9 (claimed with `agent_mail.py claim`, reported with `report`)

### 2026-10-28 17:30 UTC · F01.9 · review
- **Changes:**
  - New files: `PROJECT_VISION.md`, `PROJECT_STATE.md`, `AI_ONBOARDING.md`, `NEW_AGENT_BOOTSTRAP_PROMPT.md`, `AGENT_UPDATES.md`, per-agent `status/` files.
  - Rewrote `LONG_TERM_ROADMAP.md`. Renamed the protocol file to `AGENT_COMMUNICATION_PROTOCOL.md`.
  - Added `agent_mail.py claim` and `report`, `check_coordination.py`, the CI `coordination` job, a bug template and a PR template.
- **Tests:** 46 passed; coordination check ok. Subagent scenario check: three of three scenarios answered; the gaps it found are fixed.
- **Dependencies:** sessions claim tasks with `agent_mail.py claim`.
- **Decisions:** D-011, per-agent status files and issue-based claims.
- **Next:** F09.7, the ZAP baseline.
- **GitHub:** luke/F01.9-project-memory

### 2026-10-28 15:40 UTC · F09.6 · review
- **Changes:** Semgrep and Trivy CI jobs, now blocking. The dependency audit is now blocking too. Added a weekly scheduled run, and fixed 8 fixable image CVEs plus 1 critical in the Dockerfiles.
- **Files:** .github/workflows/ci.yml, Dockerfile.backend, frontend/Dockerfile, docs/SECURITY.md
- **Tests:** Semgrep 0 findings, pip-audit 0, npm audit 0, Trivy 0 fixable. Both images rebuilt and checked. GitHub CI 6 of 6 green.
- **Dependencies:** none. The frontend image now starts with `node`, not npm.
- **GitHub:** PR #32, issue #8

### 2026-10-28 · F07.3 · completed
- **Changes:** experiment measuring corrections on held-out documents. Rule-based doc_type 0.889 to 0.978; Llama 3 unchanged, because no rule qualified.
- **GitHub:** PR #31 merged (`8094701`)

### 2026-10-26 to 2026-10-27 · history
- **Built:** the repository, backend MVP, dataset, CLI, evaluation and CI.
- **Merged:** PRs #27–#30. These added the orchestrator, the UI restyle, investigations and the demo reset.
- **Details:** git history and the `TASKS.md` evidence.
