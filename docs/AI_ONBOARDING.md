# AI Onboarding: for a new Claude or ChatGPT conversation

This page is for an AI assistant that a VAULT **team member** (Luke or Franco) has just given this repository, in a brand-new conversation with no memory of earlier ones. It gives the assistant enough context to answer:

- What is this project?
- What am I responsible for?
- What should my coding agent do next?

If the person wants to *install or try* VAULT rather than develop it, use [`docs/AI_GUIDE.md`](AI_GUIDE.md) instead.

## 1. Get access to the repository

- **Repository:** https://github.com/F0rger123/vault-hackathon-2026 (public).
- **If you can browse:** read the raw files, for example `https://raw.githubusercontent.com/F0rger123/vault-hackathon-2026/main/coordination/PROJECT_STATE.md`.
- **If you cannot open links:** ask the person to paste the files in section 2. Never invent project details. If a fact is not in a file you have read, say so.
- **Branches:** `main` is the source of truth. Work in progress is on `luke/...` and `franco/...` branches and in open pull requests.

## 2. Read these, in this order

| # | File | What you learn | Time |
|---|---|---|---|
| 1 | [`coordination/PROJECT_STATE.md`](../coordination/PROJECT_STATE.md) | What works now, priorities, blockers, next tasks | 2 min |
| 2 | [`AGENTS.md`](../AGENTS.md) | Rules, architecture, commands, Definition of Done | 3 min |
| 3 | [`docs/PROJECT_VISION.md`](PROJECT_VISION.md) | The full product, MVP versus long term | 4 min |
| 4 | `coordination/status/luke.md` and `coordination/status/franco.md` | What each person's agent is doing, and what it waits on | 1 min |
| 5 | [`coordination/TASKS.md`](../coordination/TASKS.md) | Every task: ID, owner, status, acceptance criteria, evidence | Search it; do not read it all |
| 6 | [`coordination/BLOCKERS.md`](../coordination/BLOCKERS.md) | What needs a human decision | 1 min |
| 7 | For Franco: [`coordination/HANDOFF_FRANCO.md`](../coordination/HANDOFF_FRANCO.md) | Setup, his files, first tasks, starter prompt | 5 min |

Deeper reference, only when needed:

- [`docs/LONG_TERM_ROADMAP.md`](LONG_TERM_ROADMAP.md)
- [`docs/MASTER_BLUEPRINT.md`](MASTER_BLUEPRINT.md)
- [`coordination/API_CONTRACT.md`](../coordination/API_CONTRACT.md)
- [`coordination/AGENT_COMMUNICATION_PROTOCOL.md`](../coordination/AGENT_COMMUNICATION_PROTOCOL.md)
- [`docs/SECURITY.md`](SECURITY.md)

## 3. VAULT in one paragraph

VAULT is a private, local-first document intelligence platform. It is being built for the Meta Global AI Developer Hackathon 2026 (deadline **Nov 4, 2026, 9:00 PM ET**; feature freeze Nov 2).

It imports a large archive of engineering drawings, inspection reports, contracts and parts lists, and reads every page with a Meta Llama model running on the same computer. It proves each fact with a checked quote, and finds conflicts between documents, such as a valve rated 1500 psi on a drawing but tested at 600 psi. It answers plain-language questions with citations, and only reorganizes files after an administrator approves.

The full intended product, including the enterprise version, is in `docs/PROJECT_VISION.md`.

## 4. Who does what

| Person | Owns | Coding agent |
|---|---|---|
| **Luke** (lead) | Architecture, backend, AI providers, database, ingestion, workers, security, CLI, Docker, docs, integration and merges | Luke's agent (Claude Code, Windows) |
| **Franco** | Frontend (`frontend/**`), UI/UX, screens, browser tests (`tests/e2e/**`), security verification support, demo support | Franco's agent |

**Solo mode:** until Franco's agent replies on the welcome issue (#26), Luke's agent owns every path. Exact path ownership is in [`coordination/OWNERSHIP.md`](../coordination/OWNERSHIP.md).

## 5. Answering "what should I build next?"

1. Find the person's role: Luke or Franco. Ask if it is unclear.
2. In `PROJECT_STATE.md`, read "Next three recommended tasks". Its order already accounts for scheduling, such as F11.4 running last before the freeze. In `TASKS.md`, list that person's tasks with status `READY` and met dependencies. P0 comes before P1, and P1 before P2.
3. Skip anything listed as claimed in the other person's status file, or labelled `in-progress` on GitHub.
4. Skip anything blocked in `BLOCKERS.md`. Tell the person which blocker they could clear instead.
5. After Nov 2, recommend only fixes, tests, the demo video and the submission.
6. Recommend **one** task. Then generate a coding-agent prompt using [`coordination/NEW_AGENT_BOOTSTRAP_PROMPT.md`](../coordination/NEW_AGENT_BOOTSTRAP_PROMPT.md), part B.

## 6. Generating the coding-agent prompt

Fill in the template in `coordination/NEW_AGENT_BOOTSTRAP_PROMPT.md`, part B, with these items:

- The task ID and title, copied from `TASKS.md`.
- The scope, acceptance criteria and required tests, copied from `TASKS.md`. Do not invent new criteria. If you add any, mark them "suggested".
- The files the person owns, and the files to leave alone (`OWNERSHIP.md`).
- The API endpoints involved (`API_CONTRACT.md`), if it is frontend work.
- The coordination steps: claim, branch, tests, PR, report and status entry.

## 7. Avoiding conflicts with the other agent

- One task per branch: `luke/Fxx.y-name` or `franco/Fxx.y-name`.
- Claim a task before starting: `python scripts/agent_mail.py claim Fxx.y --me <luke-agent|franco-agent> --branch <owner>/Fxx.y-name`. The command refuses a task that is already claimed.
- Each agent edits only its own status file. Shared contracts (`API_CONTRACT.md`, `frontend/src/lib/api.ts`, `AGENTS.md`) change only by a PR that both review.
- Ask through agent mail. Do not edit the other person's files.

## 8. Verifying the work

- **Backend:** run these from the repo root.

  ```bash
  ruff check . && ruff format --check .
  pytest -p no:warnings
  bandit -q -c pyproject.toml -r backend cli -ll
  ```

- **Frontend:** in `frontend/`, run `npm run lint && npx tsc --noEmit && npm run build`, plus the browser tests in `tests/e2e/` once they exist.
- **Coordination files:** `python scripts/check_coordination.py`.
- A task is `VERIFIED` when its acceptance criteria are checked, with the evidence recorded in `TASKS.md`. It is `DONE` only after it is merged and CI on GitHub is green. Never report a result you did not see.

## 9. Updating the shared roadmap

- **Task status and evidence:** in `TASKS.md`, in the same PR as the work.
- **Progress entries and the end-of-session handoff:** in the person's own `coordination/status/<name>.md`.
- **New feature ideas:** add a task with an ID and priority in a PR. Put long-term ideas in `docs/LONG_TERM_ROADMAP.md`. Never mark a feature implemented without evidence.
- **The snapshot:** update `coordination/PROJECT_STATE.md` after a merge.

## 10. What never to do

- Print or commit secrets: `.env`, `data/runtime/`, `dev_tokens.json`, or tokens starting with `vlt_` or `LLM_`.
- Enable remote inference, add paid services, or spend money without Luke's explicit yes.
- Merge high-risk changes (auth, file handling, remote inference, migrations, CI permissions) without Luke's approval.
- Use real customer or personal data. Use only the fictional data in `data/synthetic/`.
- Claim that VAULT is unhackable, certified, or ready for classified data.
- Claim that the other agent received or agreed to something without a reply on GitHub.
