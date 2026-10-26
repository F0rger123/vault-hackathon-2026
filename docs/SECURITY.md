# Security

This document describes the safeguards that exist in the code today, and their limits. VAULT is a hackathon MVP. It has not been independently audited and is not certified for classified, export-controlled or other regulated data. We make no claim that it cannot be breached.

## Reporting

During the hackathon, open a GitHub issue labelled `security`. Do not include secrets or real documents in it.

## Controls in place

| Area | Control | Where |
|---|---|---|
| Authentication | Bearer tokens (`vlt_` + 32 random bytes). Only their SHA-256 hash is stored. Revocation flag. | `backend/security/auth.py` |
| Authorization | Roles `viewer`, `analyst`, `admin` map to permission sets. Every route except `/health` declares a permission, and the **server** enforces it. | `backend/api/deps.py`, `routes.py` |
| Denial audit | Every 401 and 403 is written to `audit_log` with actor and reason | `deps.py` |
| Upload validation | File type comes from magic bytes, and the extension must match it. Size cap (`VAULT_MAX_UPLOAD_MB`). Page cap. Rejected: empty, binary, encrypted PDFs, corrupt PDFs, corrupt images. | `backend/security/files.py`, `ingest/service.py` |
| Filenames | Reduced to a safe basename, with directory parts dropped. Never used as a storage path. | `sanitize_filename` |
| Path containment | `contained()` resolves symlinks and requires the path to sit under an allowed root. `safe_join()` rejects `..`, absolute paths and drive letters. Path import is admin-only and limited to `VAULT_IMPORT_ROOTS`. | `files.py`, `routes.py` |
| Original integrity | Content-addressed storage, files chmod read-only. Exports are copies. Nothing writes to source locations. | `ingest/service.py`, `workers/proposals.py` |
| Approval | Executing a proposal needs `proposals:approve` (admin only), and a proposal can be decided once | `routes.py` |
| Outbound data | Remote inference is off by default. Enabling it needs an admin toggle and `confirm_remote` on each job or estimate, and both are audited. The local Ollama provider refuses any non-local host. | `routes.py::_provider`, `providers/llm.py` |
| Prompt injection | Document text is fenced and labelled as untrusted data. Injection phrases are detected and stored as `injection_flags`. Model output is parsed into a fixed Pydantic schema, and unknown fields are dropped. **No code path executes model output.** | `providers/prompting.py`, `schema.py` |
| Hallucinated evidence | Quotes are checked verbatim against the page text. Unverified quotes are flagged. | `schema.verify_evidence` |
| Search injection | User queries are reduced to quoted FTS terms. All SQL values are bound parameters. | `indexing/search.py` |
| Secrets | Read from env or `.env`, which is git-ignored. `.env.example` has no values. Audit details drop keys such as `token`, `api_key`, `password`, `text`, `content`. Provider info never includes the key. | `config.py`, `audit.py` |
| Error leakage | The global handler returns a generic `internal error`, and details go only to the server log. Provider errors report the exception type, never document text. | `main.py`, `providers/llm.py` |
| HTTP headers | `nosniff`, `X-Frame-Options: DENY`, `no-referrer`, `no-store`. CORS limited to the configured origins. | `main.py` |
| Network exposure | The CLI `serve` command binds to `127.0.0.1`. Docker Compose publishes ports on `127.0.0.1` only. The backend container runs read-only, as a non-root user, with `no-new-privileges`. | `cli/main.py`, `docker-compose.yml` |

## Reviewed exceptions

- **Ruff S608 and Bandit B608 (SQL string construction)** are suppressed in four modules: `routes.py`, `search.py`, `db.py`, `proposals.py`. In each case the interpolated text is a module constant (`LATEST_EXTRACTION`, migration numbers), a fixed SQL fragment, or a column name taken from a Pydantic `Literal["doc_type", "project"]`. Every user-supplied value is a bound parameter. The configuration is in `pyproject.toml`.
- **SQLite `check_same_thread=False`.** FastAPI may resolve a dependency and run an async route on different threads. Each connection still serves only one request at a time.

## Known gaps

- Tokens are long-lived, there is no expiry yet, and there is no login UI beyond pasting a token. SSO is on the roadmap.
- There are no per-document ACLs. Every authenticated role can read every collection.
- Rate limiting is not implemented.
- Workers share the API process. There is no OS-level sandbox around PDF parsing yet. A separate worker process with resource limits is planned.
- The frontend keeps the token in `sessionStorage`. This is acceptable for a localhost MVP, but an httpOnly cookie session is planned.
- Injection detection is pattern-based and incomplete. The real defence is structural: VAULT has no action surface for model output.

## Tooling

| Tool | Status |
|---|---|
| Ruff with the `S` (bandit) ruleset | CI, blocking |
| Bandit (`-ll`) | CI, blocking |
| pytest security suite (S1–S10) | CI, blocking |
| pip-audit, npm audit | CI, report-only for now |
| Semgrep, Trivy (images), OWASP ZAP (baseline against localhost) | Planned for F09 verification. Run them only against our own local instance. |

## Secret handling rules for contributors

- Never commit `.env`, `data/runtime/`, `dev_tokens.json`, or API keys.
- Never paste tokens into issues, PRs, chat or screenshots.
- Use the demo tokens from `vault init --demo-users` only on localhost.
