# Threat Model

## Scope

This covers a single-organization VAULT deployment on its own hardware. The assets we protect are:

- original documents
- extracted intelligence
- API tokens
- the Meta API key
- the audit log
- the guarantee that data does not leave the machine

## Trust boundaries

1. **Browser and API.** All input crossing this boundary is untrusted. The API authenticates and authorizes every request.
2. **API and filesystem.** Paths are resolved and contained. Originals are read-only.
3. **Document content and model.** Document text is untrusted data. It may contain adversarial instructions.
4. **Model output and VAULT.** Model output is untrusted. It is validated against a schema and never executed.
5. **VAULT and the Meta Model API.** Data crosses the network only if an admin has enabled remote inference and the user has confirmed it for the job.

## Actors

| Actor | Capability |
|---|---|
| Unauthenticated network client | Can reach the API on localhost, or on the LAN if it was deliberately exposed |
| Low-privilege insider (viewer or analyst) | Holds a valid token, tries to go beyond their role |
| Malicious document author | Controls a file's content and name |
| Compromised or erratic model | Returns arbitrary text |
| Curious operator | Has shell access to the host. This is out of scope: host security is the customer's responsibility. |

## Threats and mitigations (STRIDE summary)

| Threat | Example | Mitigation |
|---|---|---|
| Spoofing | Forged or missing token | Tokens are looked up by hash; 401 plus an audit entry |
| Tampering | Changing originals; unapproved reorganization | Read-only content-addressed originals; copy-only exports; approval needs admin |
| Repudiation | Denying an approval | `audit_log` records the actor for every mutation and every denial |
| Information disclosure | Data sent to a remote model; secrets in errors or logs | Remote gating; generic 500s; audit detail filtering; hashed tokens |
| Denial of service | Huge files or PDF bombs | Size and page caps; bounded workers. (Parser sandbox and rate limits are known gaps.) |
| Elevation of privilege | Viewer uploads; analyst approves; path traversal | Server-side RBAC; `safe_join` and `contained` |
| Prompt injection | A memo telling the AI to delete files | Fenced prompt; injection flags; schema-only output; no action surface |

## Security test cases

Every case is automated in `tests/security/test_security.py`. The outcomes below are actual results.

| ID | Case | Test | Expected | Outcome |
|---|---|---|---|---|
| S1 | Unauthorized document access | `test_s1_unauthenticated_and_underprivileged_requests_are_rejected` | No token, forged token or wrong scheme → 401. Viewer upload → 403. Analyst reading the audit log → 403. Denials audited. | PASS, 2026-10-26, pytest |
| S2 | Unapproved file modification | `test_s2_only_approvers_can_execute_and_originals_stay_read_only` | Analyst approval → 403. Proposal stays pending. No export created. Original is not writable. | PASS, 2026-10-26, pytest |
| S3 | Malicious instructions in a document | `test_s3_prompt_injection_is_flagged_and_never_acted_on` | Injected memo processed. `injection_flags` set. Document still present. No proposals created. | PASS, 2026-10-26, pytest |
| S4 | Local-only network restriction | `test_s4_remote_inference_requires_admin_enablement_and_confirmation` | Remote job while disabled → 403. Non-admin toggle → 403. Enabled without confirmation → 409. No key → 503, so nothing is sent. Non-local Ollama URL refused. | PASS, 2026-10-26, pytest |
| S5 | Invalid file types | `test_s5_disguised_and_binary_files_are_rejected` | Executable named `.pdf`, script named `.pdf`, text named `.exe` → all rejected | PASS, 2026-10-26, pytest |
| S6 | Oversized files | `test_s6_oversized_upload_rejected` | File over the 2 MB test limit rejected with a reason | PASS, 2026-10-26, pytest |
| S7 | Path traversal | `test_s7_path_traversal_blocked` | `../../../../evil.txt` stored as `evil.txt`. Import paths outside the roots, including via `..`, → 403. Proposal pattern `../{project}` → 400. | PASS, 2026-10-26, pytest |
| S8 | Malformed input | `test_s8_malformed_input_handled` | Corrupt PDF rejected. Bad JSON → 422. Invalid name → 422. FTS operators and SQL fragments in search → 200 with no error. Unknown ID → 404. | PASS, 2026-10-26, pytest |
| S9 | Secret exposure | `test_s9_secrets_not_stored_or_returned` | Tokens stored only as hashes. API key absent from the providers response. Tokens absent from the audit log. | PASS, 2026-10-26, pytest |
| S10 | Unsafe model output | `test_s10_unsafe_model_output_rejected_or_contained` | Non-JSON → error. Invalid enum → error. Extra `run_command` field dropped. Bad date nulled. Fabricated quote marked unverified. | PASS, 2026-10-26, pytest |

Supporting tests:

- `test_unhandled_errors_do_not_leak_details`: a 500 response does not echo the exception text. PASS.
- `test_ollama_unreachable_is_reported_not_crashing`: PASS.

To re-run:

```bash
pytest tests/security -p no:warnings
```

## Residual risks

- No sandbox around the PDF parser.
- No rate limiting.
- No per-document ACLs.
- Tokens do not expire.
- Injection detection is heuristic.
- The host OS and disk encryption are the deployer's responsibility.
- If remote inference is enabled, the Meta Model API's data handling applies. The non-contributor model is used by default, but its retention terms have not been verified.
