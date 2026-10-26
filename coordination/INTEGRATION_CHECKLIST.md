# Integration Checklist

Run this before merging any PR into `main`, and in full before the November 2 feature freeze.

## Every PR

- [ ] PR references a task ID from `coordination/TASKS.md` and links its issue.
- [ ] Branch is up to date with `main`.
- [ ] Backend changes: `ruff check .`, `ruff format --check .`, `pytest -p no:warnings`, `bandit -q -c pyproject.toml -r backend cli -ll` all pass.
- [ ] Frontend changes: `npm run lint`, `npx tsc --noEmit`, `npm run build` pass in `frontend/`.
- [ ] GitHub Actions CI is green.
- [ ] The relevant user flow was exercised by hand (describe it in the PR) with synthetic data.
- [ ] API contract unchanged, or `coordination/API_CONTRACT.md` and `frontend/src/lib/api.ts` updated together and reviewed by both.
- [ ] Security impact considered: authorization on new routes, file and path handling, data leaving the machine, error messages without document content or secrets.
- [ ] No secrets, tokens, `.env`, `data/runtime/` or real customer data in the diff or screenshots.
- [ ] `TASKS.md` updated with status, PR link and verification evidence.
- [ ] Documentation updated where behaviour changed.

## High-risk changes (need Luke's personal approval)

- [ ] Authentication, roles or permission mapping.
- [ ] File ingestion, storage paths, export execution.
- [ ] Provider network calls or remote-inference gating.
- [ ] CI workflow permissions or secrets.
- [ ] Database migrations (must be additive and tested on a copy of an existing database).

## Full system check (before feature freeze and before recording the demo)

- [ ] Fresh clone on a clean machine follows `HANDOFF_FRANCO.md` section 4 without errors.
- [ ] `vault init --demo-users`, ingest, heuristic process, findings: 150 documents, 10 findings.
- [ ] Ollama run on the demo collection completes; evaluation report committed.
- [ ] Meta Model API call succeeds (if B2 resolved) with remote gating demonstrated: 403 when disabled, 409 without confirmation.
- [ ] UI: sign-in, import with estimate, library, document viewer, evidence viewer, processing with cancel, proposal approval, audit view showing a denied action.
- [ ] Viewer token cannot upload; analyst cannot approve; both denials visible in audit.
- [ ] Originals' SHA-256 hashes unchanged after an approved export.
- [ ] `docker compose up --build` works on Luke's machine.
- [ ] Security tests S1–S10 pass; outcomes recorded in `docs/SECURITY.md`.
- [ ] README screenshots match the current UI.
- [ ] `docs/HACKATHON_COMPLIANCE.md` has no unverified requirement left.
