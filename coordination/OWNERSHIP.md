# Ownership

Ownership decides who edits a path by default and who must review changes to it. Changes outside your area go through a PR reviewed by the owner.

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
| `coordination/AGENT_STATUS.md` | Shared | Each agent edits only its own row and appends to the log |
| `coordination/DECISIONS.md`, `BLOCKERS.md`, `INTEGRATION_CHECKLIST.md` | Luke | Franco may append entries |
| `AGENTS.md`, `CLAUDE.md`, `docs/AI_GUIDE.md` | Luke | Changes reviewed by both |
| `docs/**` | Luke | Franco owns UI sections of `docs/DEMO_STORYBOARD.md` |
| `README.md`, `llms.txt`, `THIRD_PARTY_NOTICES.md` | Luke | |
| `.github/**`, `docker-compose.yml`, `Dockerfile.backend`, `frontend/Dockerfile` | Luke | |

## Review requirements

- **Architecture, security, shared contracts:** review by both humans (or their agents with the human's OK) before merge.
- **Within your own area:** PR plus green CI; the other side may review but need not block.
- **High-risk merges** (auth, file handling, remote inference, data deletion paths, CI permissions): Luke approves personally, not only his agent.
