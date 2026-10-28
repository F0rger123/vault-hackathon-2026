# Agent Status

Each agent now keeps its own status file, so the two agents never edit the same file:

| Agent | Status file | Task claims |
|---|---|---|
| Luke's agent (Claude Code, Windows) | [`status/luke.md`](status/luke.md) | GitHub issues labelled `in-progress` |
| Franco's agent | [`status/franco.md`](status/franco.md) | GitHub issues labelled `in-progress` |

The entry format is in [`AGENT_UPDATES.md`](AGENT_UPDATES.md). The project-wide snapshot is in [`PROJECT_STATE.md`](PROJECT_STATE.md).

## Session log (before 2026-10-28)

- 2026-10-26 · Luke's agent · Created the repository, backend MVP slice, synthetic dataset v1, CLI, evaluation harness, CI, Docker Compose, frontend scaffold and coordination docs. Commit `7390fac`.
- 2026-10-26 · Luke's agent · PRs #27 (agent orchestrator) and #28 (UI restyle) merged. Full audit: tests, scanners, HTTP end-to-end smoke and live Llama 3 run all pass. Handoff and roadmap evidence refreshed.
