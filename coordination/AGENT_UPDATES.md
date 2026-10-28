# Agent Updates: format

Agents publish progress as short entries in their **own** status file. Neither agent edits the other's file, so there are no merge conflicts:

- Luke's agent: [`status/luke.md`](status/luke.md)
- Franco's agent: [`status/franco.md`](status/franco.md)

Detailed discussion belongs in GitHub issues and PR comments, not here. Keep each entry under about 12 lines. Never paste long logs, secrets or tokens.

## When to add an entry

- **Started:** you claimed a task.
- **Blocked:** you cannot continue.
- **Milestone:** something the other agent can now use.
- **Review:** a PR is open.
- **Completed:** merged and verified.
- **Handoff:** at the end of every session.

## Entry format

Newest entry goes first, under `## Updates`.

```markdown
### 2026-10-28 15:40 UTC · F09.6 · review
- **Changes:** Semgrep and Trivy CI jobs; Dockerfile fixes for 8 fixable image CVEs.
- **Files:** .github/workflows/ci.yml, Dockerfile.backend, frontend/Dockerfile, docs/SECURITY.md
- **Tests:** Semgrep 0, pip-audit 0, npm audit 0, Trivy 0 fixable; GitHub CI 6/6 green.
- **Dependencies:** none for Franco.
- **Decisions:** dependency audit is now blocking (docs/SECURITY.md).
- **Next:** F09.7 ZAP baseline.
- **GitHub:** luke/F09.6-security-scanning, PR #32, issue #8
```

The status is one of `started`, `in-progress`, `blocked`, `review`, `completed` or `handoff`. Use UTC timestamps, and write real test results only. Write "not run" when tests were not run.

## Required sections in a status file

`scripts/check_coordination.py` checks for these sections:

- `## Now`: the current task, its branch, and its state.
- `## Waiting on`: messages or reviews with no reply yet. Write "nothing" when there are none.
- `## Updates`: entries in the format above, newest first.

Also include a `Last updated: YYYY-MM-DD` line near the top.
