# Project State

The two-minute snapshot. Read this first in a new session. Detail lives in the linked files. If this file and `TASKS.md` disagree, `TASKS.md` wins; fix this file.

**Updated at integration checkpoints only:** after a PR merges to `main`, at the end of a session, or when a blocker opens or closes. Each agent's day-to-day progress goes in its own file under [`status/`](status/).

| | |
|---|---|
| Last updated | 2026-10-28 (Luke's agent, loop checkpoint) |
| Latest verified commit on `main` | `9fafa5f` (PR #43 merged; CI green on GitHub) |
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
- **Tests on `main`:** 62 pytest, 13 e2e, and a 25-check HTTP smoke.

## Built, waiting for Luke's review

- [#45](https://github.com/F0rger123/vault-hackathon-2026/pull/45), **F08.4:** plain-language layout requests. Llama 3 scored 8 of 8 on held-out requests. My merge was refused by the session's permission check.
- [#47](https://github.com/F0rger123/vault-hackathon-2026/pull/47), **F02.7:** large path imports as background jobs. High-risk: file handling.
- [#49](https://github.com/F0rger123/vault-hackathon-2026/pull/49), **F09.8:** token revocation and expiry. High-risk: auth and a migration.

## Partly working

- **Meta Model API lane (F04.3, F05.9):** the code and tests exist, but it has never run with a real key (blocker B2).

## Broken

- Nothing known. Report breakages in [`BLOCKERS.md`](BLOCKERS.md) or as a `bug` issue.

## Who is doing what

| | Now | Next | Status file |
|---|---|---|---|
| Luke's agent | 3 PRs waiting for Luke | F11.6 dataset v2, then F06.5 new conflict kinds | [`status/luke.md`](status/luke.md) |
| Franco's agent | Not joined yet | Extend `tests/e2e/`, then fix F10.x screens ([`HANDOFF_FRANCO.md`](HANDOFF_FRANCO.md)) | [`status/franco.md`](status/franco.md) |

## Open blockers

- **Luke:** B1 rules verification, B2 Meta API key and spend approval, B3 licence, B4 partner credits, B5 Muse Glimmer download.
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

**Feature freeze, Nov 2.** PRs #45, #47 and #49 reviewed. Final evaluation figures committed (F11.4). Demo rehearsed from `scripts/demo_reset.py`.

## Next three recommended tasks

1. **Review PRs #45, #47 and #49** (Luke personally).
2. **F11.6 and F06.5** (Luke's agent, P1): dataset v2 with new kinds of planted disagreement (part descriptions, contract quantities), and the checks that find them.
3. **F11.4** (Luke's agent, P0, scheduled for Nov 1): the final full local Llama evaluation on fresh seeds, run on the final code. Then **B1 and B3** (Luke), which unblock the video and the submission.
