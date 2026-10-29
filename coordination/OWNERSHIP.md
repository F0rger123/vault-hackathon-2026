# Ownership

VAULT is a solo indie project. **Luke Knight owns every path in the repository.** AI coding sessions work on Luke's behalf, one task branch at a time.

| Path | Notes |
|---|---|
| `backend/**`, `cli/**` | API, storage, ingestion, providers, workers, security |
| `frontend/**` | Next.js interface. Its design rules are in `frontend/DESIGN.md` |
| `tests/**` | Unit, integration, security and browser (`tests/e2e/`) tests |
| `generator/**`, `data/synthetic/**` | Dataset v1 is frozen. New data goes into a new version (v2 exists) |
| `evaluation/**` | Committed results are evidence; never edit their numbers by hand |
| `coordination/**`, `docs/**`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `llms.txt` | Project memory and documentation |
| `.github/**`, `docker-compose.yml`, `Dockerfile.backend`, `frontend/Dockerfile` | CI and deployment |

## Review requirements

- **Every change:** a PR with green CI. Documentation-only commits may go straight to `main` with `[skip ci]`.
- **High-risk changes** (auth, file handling, remote inference, database migrations, CI permissions, secrets): Luke approves the merge personally.
- **API changes:** update `coordination/API_CONTRACT.md` and `frontend/src/lib/api.ts` in the same PR.
