# Project State

The two-minute snapshot. Read this first in a new session. Detail lives in the linked files. If this file and `TASKS.md` disagree, `TASKS.md` wins; fix this file.

**Updated at integration checkpoints only:** after a PR merges to `main`, at the end of a session, or when a blocker opens or closes. Each agent's day-to-day progress goes in its own file under [`status/`](status/).

| | |
|---|---|
| Last updated | 2026-10-28 (Luke's agent) |
| Latest verified commit on `main` | `8094701` (PR #31 merged; CI green on GitHub) |
| Phase | MVP build. Feature freeze **Nov 2**, video **Nov 3**, deadline **Nov 4, 9:00 PM ET** |
| Team mode | **Solo.** Luke's agent owns every path until Franco's agent posts in agent mail ([`OWNERSHIP.md`](OWNERSHIP.md)). |

## What works (verified, with evidence in `TASKS.md`)

- **Import:** content validation, hashing, de-duplication, read-only originals, page text.
- **Planning:** hardware profile, sample benchmark and runtime estimate.
- **Local Meta Llama 3 extraction** through Ollama, with checked quotes. Held-out document type 0.956, project 0.889.
- **Processing:** parallel lanes, retries, cancel and resume. Coordinator, security-gate and reviewer agents.
- **Search and findings:** search with filters. Rating conflicts with evidence (10 of 10 planted, 0 false alarms).
- **Natural-language investigation** with numbered, checked citations (F06.4).
- **Corrections:** corrections become versioned rules, and teach by example works. Measured on held-out documents (F07.3).
- **Actions:** proposals, approval, copy-only export.
- **Security:** audit log, and security tests S1–S10.
- **Demo reset** in about 12 s (F12.6).
- **Tests:** 41 pytest tests, plus a 25-check HTTP end-to-end smoke.

## Partly working

- **Web interface (F10.1–F10.10):** six screens are built and checked by hand with screenshots. There are no automated browser tests yet (F11.5).
- **Meta Model API lane (F04.3, F05.9):** code and tests exist. It has never run with a real key (blocker B2).
- **CLI and Docker Compose (F12.1, F12.2):** both work locally. Both images rebuilt and checked on 2026-10-28 in PR #32. Not yet tested on a clean machine.

## Broken

- Nothing known. Report breakages in [`BLOCKERS.md`](BLOCKERS.md) or as a `bug` issue.

## Current priorities (Luke)

1. **F09.6 scanning:** [PR #32](https://github.com/F0rger123/vault-hackathon-2026/pull/32). CI is green; it waits for Luke's merge.
2. **F01.9 coordination system:** this PR. It adds the project memory, protocol and automated checks.
3. **F09.7 ZAP scans:** [PR #34](https://github.com/F0rger123/vault-hackathon-2026/pull/34). 0 failures; security headers added.
4. **F11.5:** Playwright browser tests. This is Franco's when he joins.
5. **F12.7 video and F12.8 submission:** these need B1 and B3 first.

## Who is doing what

| | Now | Next | Status file |
|---|---|---|---|
| Luke's agent | PRs #32, #33 and #34 in review | F11.5 browser tests, while solo | [`status/luke.md`](status/luke.md) |
| Franco's agent | Not joined yet | F11.5 browser tests ([`HANDOFF_FRANCO.md`](HANDOFF_FRANCO.md)) | [`status/franco.md`](status/franco.md) |

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
- **Orchestrator:** a coordinator agent assigns work to model lanes.

All decisions: [`DECISIONS.md`](DECISIONS.md).

## Next integration milestone

**Feature freeze, Nov 2.** All F10 screens covered by browser tests. F09.6 and F09.7 merged. Final evaluation figures committed (F11.4). Demo rehearsed from `scripts/demo_reset.py`.

## Next three recommended tasks

1. **F11.5** (P1, READY; issue [#20](https://github.com/F0rger123/vault-hackathon-2026/issues/20)): Playwright tests for sign-in, import, run, investigate and approvals.
   - **Owner:** Franco once he joins, Luke's agent while solo.
   - **Why READY:** F10.1 is in REVIEW, not VERIFIED, but F11.5 is the task that verifies F10.x, so it can start.
2. **F11.4** (Luke, P0, IN_PROGRESS): a final full local Llama evaluation on fresh seeds, to produce the submission figures.
   - **Why third despite P0:** it must run on the final code, so it is scheduled for Nov 1, just before the freeze. It is a GPU run of about 15 minutes.
   - **If extraction code changes after that run,** run it again.
3. **B1 and B3** (Luke personally): verify the hackathon rules and choose a licence. These unblock F12.4, F12.5, F12.7 (video) and F12.8 (submission).
