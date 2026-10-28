# Handoff: Franco

Welcome to VAULT. This page has everything you and your coding agent need to start productive work without asking Luke for missing context. If something here is wrong or missing, open a GitHub issue labelled `blocker` and keep going on another task.

- **Repository (verified 2026-10-26):** https://github.com/F0rger123/vault-hackathon-2026 (public, default branch `main`)
- **Your area:** the browser interface (`frontend/`), browser end-to-end tests (`tests/e2e/`), controlled security verification of the running app, and demo presentation support.
- **Luke's area:** backend, database, ingestion, model integration, workers, security architecture, CLI, Docker, documentation, integration and merges.
- **Hackathon deadline:** November 4, 2026, 9:00 PM Eastern. Feature freeze November 2.

> **Update 2026-10-26: VAULT is being built in solo mode.** Luke's agent is building everything, including
> the frontend, so the project does not depend on you being available. If you join, nothing here is wasted:
> your agent's first step is `python scripts/agent_mail.py status --me franco-agent`, then read
> `coordination/AGENT_COMMUNICATION_PROTOCOL.md`, pick open `owner:franco` issues (or any READY task) and claim them.
> Frontend screens may already exist by then; treat them as yours to improve rather than to rebuild.

## 1. What VAULT is (one paragraph)

VAULT is a private, locally deployable document intelligence platform. An organisation points it at a large collection of engineering drawings, inspection reports, contracts and similar files. VAULT stores read-only copies, extracts text, uses a Meta model (local Llama 3 through Ollama by default, or the Meta Model API when an admin allows it) to classify documents and pull out structured facts, finds conflicts between documents (for example, a valve rated 1500 psi on a drawing but tested at 600 psi in an inspection), and shows the exact source lines as evidence. Consequential actions, such as organising files into folders, are proposed first and only run after an administrator approves; originals are never modified. Every action, allowed or denied, goes into an audit log.

## 2. Architecture summary

```
Browser (Next.js 16, frontend/)  --HTTP + Bearer token-->  FastAPI (backend/)  --> SQLite + FTS5 (data/runtime/vault.db)
                                                               |                --> read-only originals (data/runtime/originals/)
                                                               |                --> approved exports (data/runtime/exports/)
                                                               +--> worker threads --> model provider
                                                                                       - ollama   (local Meta Llama, default)
                                                                                       - meta_api (Meta Model API, remote, gated)
                                                                                       - heuristic (rule-based, NOT an AI model)
```

- The backend enforces all permissions. The UI hides controls a role cannot use but must still handle 401/403 gracefully.
- The `heuristic` provider exists for tests and as an evaluation baseline. Whenever its output appears, label it "rule-based, not AI".
- Full API reference: `coordination/API_CONTRACT.md`. TypeScript types: `frontend/src/lib/api.ts`.

## 3. Current state (snapshot from 2026-10-26, `main` at `7174dbc`)

> This section is a historical snapshot. For live status, read [`PROJECT_STATE.md`](PROJECT_STATE.md) and [`status/luke.md`](status/luke.md). Since this snapshot, F06.4 (investigation API) and F10.10 (Ask panel) have been built, and the test count is 46.

Working and tested locally (33 backend tests passing; `scripts/e2e_smoke.py` runs the whole workflow over HTTP with 25/25 checks passing): upload and validation, hashing and de-duplication, PDF/text extraction, hardware profile, inventory, measured runtime estimate, background jobs with progress/cancel/resume, full-text and filtered search with page references, cross-document rating conflicts with verified evidence, corrections with versioned rules, proposals with admin approval and copy-only export, audit log, and all ten security test cases. Local Llama 3 8B through Ollama does the real extraction (prompt v3: held-out doc type 0.956, all 10 planted conflicts found); a multi-agent coordinator runs security screening, model lanes and review.

The frontend has six working screens, built in solo mode and restyled in PR #28 (monochrome, Geist type, keyhole logo; plan in `frontend/DESIGN.md`):

| Route | Screen | Tasks |
|---|---|---|
| `/` | Overview: stats, privacy status, findings, recent jobs | F10.2 |
| `/setup` | Set up a run: collection, upload, inventory, estimate, start job | F10.3 |
| `/run` | Live run board: agent lanes, progress, cancel | F10.7 |
| `/investigate` | Library, filters, document drawer, findings with evidence | F10.4–F10.6 |
| `/approvals` | Proposals, preview, approve/reject | F10.8 |
| `/security` | Providers, remote-inference switch, audit log | F10.9 |

All were checked by hand against the live API (screenshots in `docs/screenshots/`), but there are **no browser tests yet** (F11.5). Improve these screens rather than rebuilding them.

Not built yet: natural-language investigation (F06.4, Luke is building it now) and its screen (F10.10), OCR and image understanding, browser tests.

## 4. Set up (Windows or macOS)

Prerequisites: Git, Python 3.11+, Node.js 20+ (CI uses 24), and either [uv](https://docs.astral.sh/uv/) or pip. Ollama is optional for you; the `heuristic` provider needs nothing.

```bash
git clone https://github.com/F0rger123/vault-hackathon-2026.git
cd vault-hackathon-2026
```

Backend with uv (recommended):

```bash
uv venv --python 3.11 .venv
uv pip install -e ".[dev]"
```

Or with pip:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate     macOS: source .venv/bin/activate
pip install -e ".[dev]"
```

Seed demo data and start the API (activate the venv first, or call `.venv/Scripts/vault` on Windows / `.venv/bin/vault` on macOS):

```bash
vault init --demo-users                                   # writes data/runtime/dev_tokens.json (git-ignored)
vault ingest data/synthetic/v1/files --collection demo    # 150 fictional documents
vault process --collection demo --provider heuristic      # ~2 seconds, no model needed
vault findings --collection demo                          # should list 10 rating conflicts
vault serve                                               # http://127.0.0.1:8000 (API docs at /docs)
```

Frontend, in a second terminal:

```bash
cd frontend
npm install
npm run dev                                               # http://localhost:3000
```

Open http://localhost:3000 and paste a token from `data/runtime/dev_tokens.json`. Use `analyst` for most work, `admin` to test approvals and the audit view, `viewer` to test read-only behaviour. **Never commit that file, paste tokens into issues or PRs, or show them in screenshots.**

How to check it worked: the dashboard shows 150 documents, 150 processed, 10 findings, and each finding lists evidence lines from at least two files.

Optional real model: install Ollama, run `ollama pull llama3`, then `vault process --collection demo --provider ollama` (slow: several seconds per document).

## 5. Important: Next.js 16

The frontend uses Next.js 16.4 with React 19 and Tailwind CSS 4. Next 16 has breaking changes compared with most online examples and model training data. `frontend/AGENTS.md` (generated by Next) tells agents to read the guides in `frontend/node_modules/next/dist/docs/` before writing code, and to heed deprecation notices. `next.config.ts` enables `cacheComponents` and `partialPrefetching`. Screens are client components (`"use client"`) that fetch through `frontend/src/lib/api.ts`; follow the bundled docs if you move work to server components.

Design tokens live in `frontend/src/app/globals.css` (`--paper`, `--panel`, `--raised`, `--line`, `--line-strong`, `--ink`, `--muted`, `--accent`, `--on-accent`, and status colours `--blue`, `--green`, `--amber`, `--redline`; dark by default, light under `html[data-theme="light"]`). Read `frontend/DESIGN.md` first and extend tokens rather than hard-coding colours.

## 6. Your first tasks

The screens exist, so the most useful work is proving they work and finding what breaks. Full details and acceptance criteria are in `coordination/TASKS.md`.

| Order | Task | What |
|---|---|---|
| 1 | F11.5 | Playwright end-to-end tests in `tests/e2e/` covering the required tests listed under F10.1–F10.9. This moves those nine tasks from REVIEW to VERIFIED. |
| 2 | F09.7 support | Luke's agent is running the ZAP baseline (F09.7). Help by checking any UI findings it files. |
| 3 | F10.x fixes | Anything the tests or a fresh pair of eyes find wrong on the six screens (phone width, keyboard, empty and error states) |
| 4 | F10.10 | Investigation screen, once Luke publishes the `POST /investigations` contract (F06.4) |

F06.4 and a first version of F10.10 (the Ask panel in `frontend/src/components/views/investigate.tsx`) are built; F10.10 is in REVIEW for you to improve. Claim a task with `python scripts/agent_mail.py claim <ID> --me franco-agent` before you start, so the two agents do not collide.

**CI for the browser tests:** `.github/workflows/` is Luke's. When your Playwright suite runs locally, open your PR with the test files, and send Luke's agent a `review-request` asking for the CI job. Or include the job in your PR and ask for Luke's review.

## 7. Files you own and files to avoid

**You own:** `frontend/**`, `tests/e2e/**`, and the UI sections of `docs/DEMO_STORYBOARD.md`.

**Avoid editing:** `backend/**`, `cli/**`, `generator/**`, `evaluation/**`, `data/synthetic/**`, `pyproject.toml`, `.github/workflows/**`, `docker-compose.yml`. If you need a backend change, open an issue describing what you need and why.

**Change only through a reviewed PR:** `coordination/API_CONTRACT.md` (and the matching types in `frontend/src/lib/api.ts`), `AGENTS.md`, `coordination/OWNERSHIP.md`.

**You may update directly in your PRs:** your task entries in `coordination/TASKS.md` (status, PR, evidence) and your own status file `coordination/status/franco.md`.

## 8. Branches, tests and pull requests

- Branch from the latest `main`: `franco/F10.3-import-screen`, `franco/F10.6-evidence-viewer`, and so on. One task per branch.
- Before opening a PR, run in `frontend/`:

  ```bash
  npm run lint
  npx tsc --noEmit
  npm run build
  ```

  and, once they exist, the Playwright tests in `tests/e2e/`.
- Open the PR with the template, reference the task ID and issue, and include screenshots of the changed screen using synthetic data only.
- Update the task in `TASKS.md` to `REVIEW` with the PR link. Luke (or Luke's agent) reviews and merges; nothing reaches `main` without a PR and green CI.
- A task becomes `VERIFIED`/`DONE` only with evidence (test output, screenshots), never just because code was written.

## 9. Communication

Agents do not share memory. Everything goes through the repository:

- **GitHub Issues:** task claims, questions, blockers (`blocker` label), security findings (`security` label).
- **Pull requests:** all code changes and reviews.
- **`coordination/status/franco.md`:** add an entry when you start, block, open a PR, or end a session (format in `coordination/AGENT_UPDATES.md`). Claim tasks with `python scripts/agent_mail.py claim <ID> --me franco-agent`.
- **`coordination/BLOCKERS.md`:** anything that needs a human decision.
- Humans talk directly as usual; record any decision that affects the code in `coordination/DECISIONS.md`.

## 10. Known blockers and risks

- Hackathon rules are not fully verified (participant guide is behind login). Assume a public repo and a roughly three-minute demo video until confirmed.
- The Meta Model API key is not set up yet, so the remote provider shows "unavailable". This is expected; the UI must display it clearly rather than failing.
- Local Llama 3 8B takes about 6 s per document on Luke's laptop (150 documents in about 7 minutes with 2 workers). Use the `heuristic` provider for UI development so you are not waiting on the model.
- Project licence not yet chosen. Do not add a LICENSE file.

## 11. Milestones

| Date | Milestone |
|---|---|
| Oct 27–28 | App shell, import and library screens; first ingestion visible in the UI |
| Oct 29 | Processing view with live progress |
| Oct 30 | Document and evidence viewers; investigation prototype |
| Oct 31 | Proposals and approvals; audit view |
| Nov 1 | E2E tests, ZAP scan, integration fixes |
| Nov 2 | **Feature freeze**: only fixes, polish, docs |
| Nov 3 | Rehearse and record the demo |
| Nov 4 | Final review and submission before 9:00 PM ET |

## 12. Starter prompt for Franco's coding agent

Paste this into your agent (Claude Code, Codex, Cursor, or similar) from inside your clone:

```text
You are Franco's coding agent on VAULT, a hackathon project (Meta Global AI Developer Hackathon, deadline
Nov 4 2026 9:00 PM ET). Repository: https://github.com/F0rger123/vault-hackathon-2026. Luke's agent owns the
backend; you own the frontend (frontend/**) and browser tests (tests/e2e/**).

Start every session by:
1. git fetch && git checkout main && git pull
2. Reading AGENTS.md, coordination/PROJECT_STATE.md, coordination/status/luke.md,
   coordination/HANDOFF_FRANCO.md, coordination/API_CONTRACT.md, coordination/TASKS.md (F10 and F11.5),
   coordination/BLOCKERS.md, and the latest merged PRs. Run
   python scripts/agent_mail.py status --me franco-agent and answer anything addressed to you.
3. Reading frontend/AGENTS.md and the Next.js 16 guides in frontend/node_modules/next/dist/docs/ before
   writing Next.js code. Next 16 differs from what you may remember.
4. Picking the next READY task assigned to franco, claiming it with
   python scripts/agent_mail.py claim <TASK-ID> --me franco-agent --branch franco/<TASK-ID>-<short-name>,
   and creating that branch.

Rules:
- Build against the endpoints in API_CONTRACT.md only. If you need a backend change, open an issue for Luke;
  do not edit backend/**.
- The server enforces permissions. Handle 401 (return to sign-in), 403 (explain the missing permission),
  409 (remote-data confirmation or already-decided proposal) and 503 (provider unavailable) clearly.
- Label any extraction from provider "heuristic" as "rule-based, not AI". Show provider, model and
  local/remote for every extraction. Never send confirm_remote=true without an explicit user confirmation.
- Use only the synthetic demo data. Never commit data/runtime/, tokens or .env files, and never put tokens
  in screenshots, issues or PRs.
- Accessibility: semantic HTML, keyboard navigation, visible focus, labelled controls, works at 375 px.
- Before a PR: npm run lint, npx tsc --noEmit, npm run build (and Playwright tests when they exist). Include
  screenshots. Update the task in coordination/TASKS.md to REVIEW with the PR link and evidence, and update
  coordination/status/franco.md (format: coordination/AGENT_UPDATES.md). Run
  python scripts/agent_mail.py report <TASK-ID> --me franco-agent --status review --body "<PR link, tests>".
- End every session with a handoff entry in coordination/status/franco.md, pushed to your branch.
- Never mark a task DONE yourself; never merge your own PR; never invent test results.
- Keep chat replies short; put details in the repo.

First task: F11.5 (Playwright browser tests for the six existing screens). Set up the project using
HANDOFF_FRANCO.md section 4, confirm the Overview shows 150 documents and 10 findings, then begin.
```
