# Ownership

Ownership decides who edits a path by default and who must review changes to it. Changes outside your area go through a PR reviewed by the owner.

**Current mode: solo (2026-10-26).** Luke's agent owns every path below, including the ones marked Franco, until Franco's agent replies on the welcome issue [#26](https://github.com/F0rger123/vault-hackathon-2026/issues/26). That reply is the single signal that ends solo mode (`coordination/AGENT_COMMUNICATION_PROTOCOL.md`). The table describes the two-agent split that applies from then on.

| Path | Owner | Notes |
|---|---|---|
| `backend/**` | Luke | API, storage, ingestion, providers, workers, security |
| `cli/**` | Luke | |
| `generator/**`, `data/synthetic/**` | Luke | Dataset v1 is frozen; new data goes into v2 |
| `evaluation/**` | Luke | Committed results are evidence; never edit numbers by hand |
| `tests/unit/**`, `tests/integration/**`, `tests/security/**` | Luke | |
| `tests/e2e/**` | Franco | Playwright browser tests |
| `frontend/**` | Franco | Scaffold created by Luke's agent; Franco owns it from handoff |
| `frontend/src/lib/api.ts` | Shared | Must match `coordination/API_CONTRACT.md`; changes reviewed by both |
| `coordination/API_CONTRACT.md` | Shared | Changes need a PR reviewed by Luke and Franco |
| `coordination/TASKS.md` | Shared | Each person updates their own tasks; Luke maintains the dashboard |
| `coordination/status/luke.md` | Luke | Only Luke's agent edits it |
| `coordination/status/franco.md` | Franco | Only Franco's agent edits it (Luke's agent seeded it) |
| `coordination/PROJECT_STATE.md` | Shared | Updated at checkpoints (merge, session end, blocker change) by whoever merges |
| `coordination/DECISIONS.md`, `BLOCKERS.md`, `INTEGRATION_CHECKLIST.md` | Luke | Franco may append entries |
| `AGENTS.md`, `CLAUDE.md`, `docs/AI_GUIDE.md`, `docs/AI_ONBOARDING.md`, `coordination/NEW_AGENT_BOOTSTRAP_PROMPT.md`, `coordination/AGENT_COMMUNICATION_PROTOCOL.md` | Luke | Changes reviewed by both |
| `docs/**` | Luke | Franco owns UI sections of `docs/DEMO_STORYBOARD.md` |
| `README.md`, `llms.txt`, `THIRD_PARTY_NOTICES.md` | Luke | |
| `.github/**`, `docker-compose.yml`, `Dockerfile.backend`, `frontend/Dockerfile` | Luke | |

## Review requirements

- **Architecture, security, shared contracts:** review by both humans (or their agents with the human's OK) before merge.
- **Within your own area:** PR plus green CI; the other side may review but need not block.
- **High-risk merges** (auth, file handling, remote inference, data deletion paths, CI permissions): Luke approves personally, not only his agent.
