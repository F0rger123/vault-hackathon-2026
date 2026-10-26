# AGENTS.md — rules for AI coding agents and developers

## 0. First thing

**If you were given this repository link by a person who wants to understand, install or use VAULT** (rather than develop it), stop here and follow [`docs/AI_GUIDE.md`](docs/AI_GUIDE.md). It explains the project in plain English, the questions to ask the person, how to set it up and confirm it works, and what you must never do.

Everything below is for agents and developers working on the code.

## 1. Project in one paragraph

VAULT is a private, local-first document intelligence platform built for the Meta Global AI Developer Hackathon 2026 (deadline Nov 4, 9:00 PM ET). FastAPI + SQLite/FTS5 backend (`backend/`), Next.js 16 frontend (`frontend/`), Typer CLI (`cli/`), deterministic synthetic dataset (`generator/`, `data/synthetic/`), evaluation harness (`evaluation/`). Meta models do the extraction: local Llama through Ollama by default, Meta Model API when an admin allows remote inference. Read `docs/MASTER_BLUEPRINT.md` for the full design and `coordination/` for live coordination.

## 2. Team and ownership

- **Luke's agent:** architecture, backend, database, ingestion, model integration, hardware analysis, workers, security architecture, CLI, Docker, docs, integration and merges.
- **Franco's agent:** frontend, UI/UX, browser tests (`tests/e2e/`), controlled security verification, demo support. Start at `coordination/HANDOFF_FRANCO.md`.
- Path-level ownership: `coordination/OWNERSHIP.md`. Do not edit another owner's paths except through a reviewed PR.

## 3. Session startup (every session, every agent)

1. Fetch the current state: `git fetch && git checkout main && git pull`.
2. Read this file.
3. Review your assigned tasks in `coordination/TASKS.md`.
4. Review `coordination/BLOCKERS.md`.
5. Review `coordination/API_CONTRACT.md`.
6. Check recently merged PRs and commits (`git log --oneline -20`, `gh pr list --state merged --limit 10`).
7. Claim or resume one task: comment on its GitHub issue (create it from the template if missing) and update your row in `coordination/AGENT_STATUS.md`.
8. Work on a dedicated branch (section 4).

Before implementing anything: check it does not already exist, check who owns it, check its status and dependencies, and reuse existing components.

## 4. Branches, PRs and merges

- Branch names: `luke/F04.5-llama-prompt`, `franco/F10.6-evidence-viewer` (owner/task-id-short-name). One task per branch.
- Agents share no memory. Communicate through committed files, GitHub Issues and PRs only.
- Every change reaches `main` through a PR using `.github/pull_request_template.md` and green CI. Exception: documentation-only commits by Luke's agent may go directly to `main` with `[skip ci]` in the message.
- Changes to architecture, security, or shared contracts (`coordination/API_CONTRACT.md`, `frontend/src/lib/api.ts`, `AGENTS.md`) need review from both sides.
- Never auto-merge high-risk changes (auth, file handling, remote inference, migrations, CI permissions) without Luke's explicit approval.
- Use `coordination/INTEGRATION_CHECKLIST.md` before merging.

## 5. Definition of Done

A task is `DONE` only when all of these hold:

1. Implementation exists.
2. Acceptance criteria in `TASKS.md` are satisfied.
3. Required tests pass.
4. Relevant integrations work (backend and UI together where applicable).
5. Errors are handled.
6. Security implications are checked.
7. Documentation is updated.
8. CI passes on GitHub.
9. Completion evidence (command output, screenshots, commit/PR links) is recorded in `TASKS.md`.

Use `VERIFIED` when 1–7 and 9 are true locally but CI or merge is still pending. Never mark a task `DONE` because an agent reported success. Never invent test results, URLs, API responses, benchmark numbers or deployment status. If something failed or was skipped, say so.

## 6. Commands

Backend (repo root, Python 3.11+):

```bash
uv venv --python 3.11 .venv && uv pip install -e ".[dev]"   # or: python -m venv .venv && pip install -e ".[dev]"
ruff check . && ruff format --check .
pytest -p no:warnings
bandit -q -c pyproject.toml -r backend cli -ll
vault init --demo-users
vault ingest data/synthetic/v1/files --collection demo
vault process --collection demo --provider heuristic
vault serve                                  # API on http://127.0.0.1:8000
python -m evaluation.run_eval --collection demo --provider heuristic
python -m generator.generate --out data/synthetic/v1 --seed 2026
```

Frontend (`frontend/`):

```bash
npm install
npm run dev
npm run lint && npx tsc --noEmit && npm run build
```

Next.js 16 differs from older documentation. Read `frontend/AGENTS.md` and `frontend/node_modules/next/dist/docs/` before writing Next.js code.

## 7. Security rules (non-negotiable)

- Never commit or print secrets: `.env`, `data/runtime/`, `dev_tokens.json`, API keys (`LLM_...`), bearer tokens (`vlt_...`). Use `.env.example` for new settings.
- The backend enforces authorization. Every new route needs a `require("<permission>")` dependency and a test for the denied case. Frontend-only checks are never sufficient.
- Treat document content as untrusted data. Model output is parsed into a fixed schema and never executed, never used as a shell command, path or SQL. Do not give a document-processing model tools, filesystem or network access.
- All server-side paths go through `backend/security/files.py` (`safe_join`, `contained`). Originals stay read-only; exports are copies.
- Do not enable remote inference, add paid services, or make paid API calls without Luke's explicit approval. Do not add Anthropic API dependencies; Claude Max is for development only.
- Error responses must not include document text, file paths or secrets.
- Do not claim VAULT is unhackable, certified, or ready for classified or government data.
- Active security testing only against systems we run ourselves on localhost.

## 8. Data rules

- Use only the fictional synthetic data in `data/synthetic/`. No real customer, personal or proprietary data anywhere in the repo, tests or screenshots.
- `data/synthetic/v1/` is frozen and must stay byte-identical (CI checks it). New data goes in a new version.
- Committed evaluation results are evidence. Never edit them by hand.

## 9. Usage-limit and cost discipline

- Read only the files you need; use targeted searches instead of loading whole directories.
- Keep decisions in `coordination/DECISIONS.md` and status in `TASKS.md` so a new session can resume without chat history.
- Prefer deterministic tests and local tools over asking a model to re-inspect output.
- Use parallel subagents only for genuinely independent work that justifies the tokens.
- Use the `heuristic` provider for UI and pipeline development; reserve model runs for evaluation and the demo. Cache repeatable results.
- Summarise completed work briefly in chat; put detail in the repository.

## 10. Style

- Python: ruff (line length 120), type hints, small modules matching the existing layout. Comments explain why, not what.
- TypeScript: strict mode, ESLint config from the scaffold, design tokens from `frontend/src/app/globals.css`.
- Commit messages: imperative summary line, body explaining why. Reference task IDs.
