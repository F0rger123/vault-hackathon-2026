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

- Tokens can be revoked (`POST /tokens/{id}/revoke`, `vault revoke`), which takes effect on the next request. They can also be issued with an expiry (`vault token --ttl-days`). Demo tokens and the CLI default still never expire, and there is no login UI beyond pasting a token. SSO is on the roadmap.
- There are no per-document ACLs. Every authenticated role can read every collection.
- Rate limiting is not implemented.
- Workers share the API process. There is no OS-level sandbox around PDF parsing yet. A separate worker process with resource limits is planned.
- The frontend keeps the token in `sessionStorage`. This is acceptable for a localhost MVP, but an httpOnly cookie session is planned.
- Injection detection is pattern-based and incomplete. The real defence is structural: VAULT has no action surface for model output.

## OWASP ZAP scans (F09.7, 2026-10-28)

**Target.** Our own stack only. The backend and frontend Docker images ran in an isolated Docker network on the development laptop, with nothing published to the internet. ZAP `ghcr.io/zaproxy/zaproxy:stable` ran two scans:

- `zap-baseline.py` (spider and passive) against the frontend.
- `zap-api-scan.py` against the backend's OpenAPI description. This scan includes active attacks and ran authenticated as the demo admin. The token went in through an environment variable; it never appears in the reports, which were checked for `vlt_`.

**Result.** 0 failures in both scans. The warnings and what was done about each:

| Warning (ZAP rule) | Where | Decision |
|---|---|---|
| Missing anti-clickjacking header (10020), missing `X-Content-Type-Options` (10021), CSP not set (10038), Permissions-Policy not set (10063), `X-Powered-By` leaks the framework (10037) | frontend | **Fixed.** `frontend/next.config.ts` now sends CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a Permissions-Policy and `Cross-Origin-Opener-Policy`, and turns off `X-Powered-By`. The rescan no longer reports these. |
| CSP allows `script-src 'unsafe-inline'` (10055) | frontend | **Accepted.** Next.js puts inline bootstrap scripts on statically rendered pages. Removing `'unsafe-inline'` needs per-request nonces, which would make every page render dynamically. The pages show no user-controlled HTML, and React escapes rendered text. Revisit with nonces after the hackathon. |
| Cross-Origin-Embedder-Policy missing (90004) | frontend | **Accepted.** VAULT does not need cross-origin isolation (no `SharedArrayBuffer`). |
| Cross-Origin-Resource-Policy missing or invalid (90004) | API | **Partly fixed.** The API now sends `Cross-Origin-Resource-Policy: same-site`. ZAP accepts only `same-origin`, but the UI and API are on different ports, so `same-site` is the deliberate setting. The UI's CORS `fetch()` calls are not affected. |
| Non-storable content (10049) | frontend | Informational. Pages are dynamic. |
| Server error response (100000) | API | **Expected.** `POST /system/capacity/calibrate` returned 503 because no Ollama ran inside the scan network. That route reports a missing provider as 503 by design. No 500 responses occurred. |
| Unix timestamp disclosure (10096) | API | **False positive.** These are the audit log's own timestamps and job IDs, returned to an authenticated admin. |

The UI was rechecked after the header change. All six screens load in Chromium with the new CSP, and the Ask panel answers a question, with no console errors or CSP violations. `tests/security/test_security.py::test_security_headers_on_every_response` keeps the API headers in place.

## Tooling

| Tool | Status |
|---|---|
| Ruff with the `S` (bandit) ruleset | CI, blocking |
| Bandit (`-ll`) | CI, blocking |
| pytest security suite (S1–S10) | CI, blocking |
| pip-audit, npm audit (high and above) | CI, blocking, and weekly |
| Semgrep (`p/python`, `p/typescript`, `p/react`, `p/nextjs`, `p/dockerfile`, `p/secrets`) | CI, blocking |
| Trivy: lockfiles, Dockerfiles and secrets in the repository | CI, blocking (high and critical) |
| Trivy: both Docker images | CI, blocking for high and critical issues that have a released fix |
| OWASP ZAP (baseline against localhost) | Planned (F09.7). Run it only against our own local instance. |

CI runs the scanners from Docker images pinned by digest, and with read-only repository permissions. Results are not uploaded anywhere.

### Scan triage (F09.6, 2026-10-28)

| Finding | Where | Decision |
|---|---|---|
| Semgrep: 0 results across 164 files | whole repository | Nothing to triage. |
| pip-audit: 0, npm audit: 0 | Python and frontend dependencies | Nothing to triage. |
| Trivy fs: 0 | `package-lock.json`, both Dockerfiles, secrets | Nothing to triage. |
| Trivy image: `wheel` and `jaraco.context` (high, fix released) | copies vendored inside `setuptools` in the backend image | Fixed: the image removes `setuptools` after installing VAULT, since nothing uses it at run time. |
| Trivy image: `undici` and `brace-expansion` (high, fix released) | npm's own bundled packages in the frontend image | Fixed: the runtime image removes npm and starts Next.js with `node` directly. |
| Trivy image: `zlib1g` CVE-2023-45853 (critical, "will not fix") | frontend image on Debian 12 | Fixed by moving the frontend image to Debian 13 (`node:24-trixie-slim`). The flaw is in zlib's minizip code, which VAULT does not use. |
| Trivy image: 8 high CVEs in base OS packages (util-linux, ncurses, systemd libraries, perl-base, acl, login), no fix released | both images, Debian 13.7 | Accepted for now. They are in the operating system, not in VAULT. The images run as a non-root user, the backend has a read-only root filesystem, and ports bind to 127.0.0.1. The weekly CI run fails as soon as Debian releases a fix, so the images get rebuilt then. |

To accept a new finding instead of fixing it, add it to this table with a reason first. Then list its ID in `.trivyignore` or pass `--ignore-vuln` to pip-audit.

## Secret handling rules for contributors

- Never commit `.env`, `data/runtime/`, `dev_tokens.json`, or API keys.
- Never paste tokens into issues, PRs, chat or screenshots.
- Use the demo tokens from `vault init --demo-users` only on localhost.
