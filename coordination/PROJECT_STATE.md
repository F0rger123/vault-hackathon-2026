# Project State

The two-minute snapshot. Read this first in a new session. Detail lives in the linked files. If this file and `TASKS.md` disagree, `TASKS.md` wins; fix this file.

**Updated at integration checkpoints only:** after a PR merges to `main`, at the end of a session, or when a blocker opens or closes. Each agent's day-to-day progress goes in its own file under [`status/`](status/).

| | |
|---|---|
| Last updated | 2026-10-28 (Luke's agent, loop checkpoint) |
| Latest verified commit on `main` | see `git log` (PR #55 merged; CI green) |
| Phase | MVP build. Feature freeze **Nov 2**, video **Nov 3**, deadline **Nov 4, 9:00 PM ET** |
| Team mode | **Solo.** Luke's agent owns every path until Franco's agent replies on [#26](https://github.com/F0rger123/vault-hackathon-2026/issues/26) ([`OWNERSHIP.md`](OWNERSHIP.md)). |

## What works (verified, with evidence in `TASKS.md`)

- **Import:** content validation, hashing, de-duplication, read-only originals, page text.
- **Planning:** hardware profile, sample benchmark and runtime estimate. Each run is compared with its estimate (F03.5).
- **Local Meta Llama 3 extraction** through Ollama, with checked quotes. Held-out document type 0.956, project 0.889.
- **Response cache** for repeated development runs (F04.9). It is off by default.
- **Processing:** parallel lanes, retries, cancel and resume, plus a free-memory guard (F05.6). Coordinator, security-gate and reviewer agents.
- **Search and findings:** search with filters. Rating conflicts with evidence (10 of 10 planted, 0 false alarms).
- **Natural-language investigation** with numbered, checked citations (F06.4).
- **Corrections:** corrections become versioned rules, and teach by example works. Measured on held-out documents (F07.3).
- **Actions:** proposals, approval, copy-only export.
- **Security:**
  - audit log and security tests S1–S10;
  - Semgrep, Trivy, pip-audit and npm audit in CI (F09.6);
  - ZAP scans with 0 failures, and security headers (F09.7).
- **Web interface (F10.1–F10.10):** six screens, covered by 13 Playwright browser tests in CI (F11.5). Each document shows which model read it and where (F04.8).
- **CLI** (F12.1) and **Docker Compose** (F12.2): both verified end to end.
- **Demo reset** in about 12 s (F12.6).
- **Tests on `main`:** 100 pytest, 18 e2e, and a 25-check HTTP smoke.

## Newly merged (2026-10-28 evening)

- **Plain-language layout requests (F08.4):** Llama 3 scored 8 of 8 on held-out requests.
- **Background path imports (F02.7).**
- **Token revocation and expiry (F09.8).**
- **Easy start (F10.11):** demo buttons, password sign-in, a Demo/Real switch, and an API key screen with links.
- **Training screen (F07.6):** graded test, suggested rules, re-test, and a readiness check.
- **Quantity and material conflicts (F06.5), on dataset v2 (F11.6).**
- **Licence:** Apache-2.0.

## Partly working

- **Meta Model API lane (F04.3, F05.9):** the code and tests exist, but it has never run with a real key (blocker B2).

## Broken

- Nothing known. Report breakages in [`BLOCKERS.md`](BLOCKERS.md) or as a `bug` issue.

## Who is doing what

| | Now | Next | Status file |
|---|---|---|---|
| Luke's agent | All PRs merged | F11.4 final evaluation (Nov 1) | [`status/luke.md`](status/luke.md) |
| Franco's agent | Not joined yet | Extend `tests/e2e/`, then fix F10.x screens ([`HANDOFF_FRANCO.md`](HANDOFF_FRANCO.md)) | [`status/franco.md`](status/franco.md) |

## Open blockers

- **Luke:** B1 rules verification, B2 Meta API key and spend approval, B4 partner credits, B5 Muse Glimmer download. (B3 licence resolved: Apache-2.0.)
- **Franco:** B6 onboarding. He replies on [#26](https://github.com/F0rger123/vault-hackathon-2026/issues/26), which is the one signal that ends solo mode.

Detail: [`BLOCKERS.md`](BLOCKERS.md).

## Decisions that shape everything

- **D-001:** SQLite and FTS5 for the MVP.
- **D-002:** the rule-based baseline is always labelled "not AI".
- **D-004:** Llama 3 8B is the default local model.
- **D-005:** remote inference needs both admin approval and confirmation on each job.
- **D-006 and D-007:** originals are read-only, and exports are copies.
- **D-011:** each agent has its own status file, and task claims go on GitHub issues.

All decisions: [`DECISIONS.md`](DECISIONS.md).

## Next integration milestone

**Feature freeze, Nov 2.** Final evaluation figures committed (F11.4). Demo rehearsed from `scripts/demo_reset.py`.

## Next three recommended tasks

1. **B1** (Luke): verify the official hackathon rules, including any licence requirement.
2. **Record the video** (Luke, Nov 3) from `docs/DEMO_SCRIPT.md`.
3. **F11.4** (Luke's agent, P0, scheduled for Nov 1): the final full local Llama evaluation on fresh seeds, run on the final code. Then **B1 and B3** (Luke), which unblock the video and the submission.
