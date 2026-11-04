# Status: Luke and his AI coding sessions

Last updated: 2026-11-03

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
- **Luke, decisions:** passkey sign-in with face or fingerprint (an auth change); a 3D brain map (adds three.js); face recognition of employees (biometric data, so a consent and legal question).
- **Luke, Nov 3:** record the video from `docs/DEMO_SCRIPT.md`.

## Updates

### 2026-11-04 · F10.25 · Ask Keeper uses the Brain page's 3D brain (PR open, do not auto-merge)
- **Built:** Ask Keeper now shows `brain-space.tsx` itself in a compact mode (`keeper-space.tsx`), driven by the latest reply's recorded activity rows and streamed events; helper craft have their own colours on both pages; `keeper-brain.tsx` deleted; grouped example prompts, each tested on the demo collection. Leaving Ask Keeper for another page no longer stops a reply (module store); a full reload still does, and says so.
- **Waiting on Luke:** review the PR; watch one live question on a real GPU for the video.
- **Not verified:** motion by eye in a recording; Ollama-written answers.

### 2026-11-04 · F12.16 · Download Demo Dataset (PR open, review)

- **Started and built:** the Overview in Demo mode has a **Download Demo Dataset** panel with **Quick Demo Dataset** (155 files, about 0.36 MB) and **Complete Demo Dataset** (280 files, about 15 MB). Both ZIPs are built by the server (`GET /api/v1/demo/dataset/{quick,complete}.zip`, `documents:read`, audited, cached by content hash under `<data_dir>/demo-datasets/`).
- **Complete** uses `make_test_files.py --size demo` (generated on first request, about 30 s), not `huge` (several minutes, 275 MB). Left out by content check: the MZ program, the JavaScript PDF, the macro and outside-link Word files, and the two nested ZIPs; the README lists them.
- **Waiting on Luke:** review and merge.

### 2026-11-03 · merges · F10.24, F09.22, F11.9 done
- **Done:** Luke approved; PRs #110 (approvals and guide), #113 (face liveness and vault door) and #114 (in-app viewer and realistic files) merged after main was merged into each and CI went 8/8 green. VAULT restarted on main.
- **Started:** F11.10 huge test set (PR #116, about 2,300 files already generated in `data/testset-huge`), classify and redact (its own task ID and session, PR to follow; auth and file handling, so Luke reviews before merge).
- **Docs:** `docs/TEST_WALKTHROUGH.md` rewritten for the merged features; `docs/VIDEO_SCRIPT.md` updated (huge set in the hook, classify-and-redact alternative marked [if merged]).
- **Waiting on Luke:** the real-webcam face test (Test my face now, report the numbers, try a photo of your face); a preview in the desktop window.

### 2026-11-03 · F10.24 · review (PR open, do not auto-merge)

- Full-width Approvals with a list and detail, a View only mode (viewers now have `proposals:read`), admin deleting of requests and of copies inside VAULT's export folder (never originals, audited), and a `/guide` page with a Guide link in the rail.
- Waiting on Luke: review the two DELETE routes (file handling) before merging.
### 2026-11-03 · F11.9 · review
- **Built:** in-app preview in the document drawer (photos with zoom, PDFs, video, sound, extracted text; full-screen drawer; previews audited as `document.view`; held files never preview) and realistic fictional test files (blueprints, photographs, stamped reports, a fictional newspaper). Branch `luke/F11.9-viewer-real-files`.
- **Why photos "did not display":** the old button opened a blob URL in a new tab; that tab inherits the app's CSP, which blocked video and sound, and the desktop window sends new tabs to the system browser, where the blob does not exist.
- **Waiting on Luke:** review and merge the PR (file serving is high-risk, so it was not merged); try a preview in the desktop window, which was not tested.
### 2026-11-03 · F09.22 · review (auth change: not merged)
- **Built:** a random head-move liveness challenge for the face step and face setup, a smoother capture, the outline, scan and vault-door sign-in sequence, Test my face now, and demo roles that select before signing in.
- **Waiting on Luke:** review and merge the PR (auth code). Then on the real webcam: Security, Face check, Set it up again, then Test my face now, and note the numbers; sign in with face as a step and watch the door.
- **Not verified:** the challenge with a real face (fake camera only); thresholds not yet calibrated on real people.
### 2026-11-03 · F10.23 · Ask Keeper, PR open
- **Done:** Investigate merged into the chat, now "Ask Keeper" (one name constant per side). Redline conflict cards and media result rows inline, Refine chips, export in the header, `/investigate` redirects with its query. Stream-driven animation sequence, a live SVG brain beside the chat, and learning from thumbs up/down (migration 14, two new routes).
- **Waiting on Luke:** review and merge the PR; watch one live question for the demo video (the animations were checked by screenshots, not by eye).
- **Not verified:** answers written by Ollama; the full e2e suite (four specs run).

### 2026-11-03 · F09.19, F10.19, F11.7 · merged
- **Merged:** #98. Real sign-in levels (passkey kind choice, confirm-it's-you, webcam face check with the Human library, admin controls), Progress live status, mock-up audit fixes, the fictional test set generator, and `docs/TEST_GUIDE.md`.
- **Release:** v0.2.0 published on GitHub.
- **Waiting on Luke:** try the face check on the real webcam (Chrome or the app); the preview pane blocks cameras, so it is untested on a camera.
- **Open audit items:** agent-floor slot routing, two always-pass posture checks, the assumed "8 per copy", the pre-run estimate, and the Meta key test call.

### 2026-11-03 · F06.8, F03.9, F10.18, F12.14 · merged
- **Merged:** #96 (chat box that finds, sorts and asks; Models page; new logo; loading animation; plainer page names, "Add files" and "Progress") and #97 (update check, version 0.2.0).
- **Release:** tag `v0.2.0` pushed. The Release workflow attaches the installer and zip to a draft release. Luke publishes it on GitHub; installed copies then see it.
- **Not verified:** the installer on a clean machine; the update banner against a real newer release (none published yet).

### 2026-10-30 · F12.12 · portable app merged
- **Merged:** #85. Standalone Windows build, tested through the setup wizard on the built exe.
- **Not done:** the installer needs Inno Setup. Publishing a GitHub release, and code signing (paid), are Luke's calls.

### 2026-10-30 · merge rule; F10.14, F10.15 · merged
- **Standing approval from Luke:** "always push the main... You don't need to ask." Finished work merges to `main` once CI is green, including auth, file-handling and migration PRs. Spending money, large downloads, remote inference and destructive actions still need asking.
- **Merged:** #84 (setup wizard, agent tree, new look).

### 2026-10-30 · Luke's UI and security feedback · mostly merged
- **Merged:**
  - #75: read only new documents.
  - #76: collection switcher with New collection.
  - #77: desktop window (F12.12).
  - #78: run summary and a chat with the coordinator.
  - #79: brain in 3D (F07.10).
  - #81: narrowing search step by step.
  - #83: Training steps, Quiz VAULT, grouped rail and Ctrl+K.
- **Waiting for Luke:** #80 (security gate) and #82 (passkeys).
- **Not built (models needed):** searching inside photos, video and audio needs a vision model (B7) and a speech model. Explained in the roadmap, section 5a.

### 2026-10-29 night · F02.8, F07.7, F07.8 · merged; transfer and share packs · review
- **Merged with Luke's approval:** #66 (Office files) and #70 (the collection brain and its map).
- **Opened:** #72 (`vault transfer export | verify | import`, AES-256-GCM, 15 tests) and #74 (share packs: redacted PDFs plus a report of what was left out and why, 4 tests). Both wait for Luke.
- **README:** setup steps, a hardware sizing table built from the measured laptop rate and labelled as estimates, new screenshots, a brain diagram, and how to keep VAULT private for a team.

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

### 2026-11-03: F09.20 and F10.20 merged
- F09.20 (PR #101): pick any mix of password, passkey, face check and spoken key phrase; camera and mic quality checks; a virtual USB security key in e2e as the second step. Not verified: a physical YubiKey, a real webcam, a real mic.
- F10.20 (PR #102): `/chat` Ask VAULT page. The coordinator streams its plan and hands work to real helpers, two of them in parallel. Not verified: llama3 writing the answer live.
- Waiting on Luke: try a real key, the webcam and the mic; record the video; submit by Nov 4, 9 PM ET.

### 2026-11-03 (evening): F10.21, F11.8, F10.22, F09.21 merged
- PR #103 new logo and look, animated face setup, phone passkey offered when the camera is poor.
- PR #104 photos, videos and audio stored with real details, findable and sortable; `make_test_files.py --size demo` (126 files, 12 MB, in `data\testset-demo`).
- PR #105 the Brain shows real file work live (chat helpers, approved copies, new files) with a ticker.
- PR #106 invite wizard with roles, requested sign-in steps and a one-time link, code and QR.
- `docs/TEST_WALKTHROUGH.md`: a 30-minute checklist. `docs/DEMO_SCRIPT.md` updated. Video rules are behind the Cerebral Valley login: Luke to check.
- Not verified: real webcam, microphone, YubiKey, phone QR flows.
