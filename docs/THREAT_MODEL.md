> **Security audit, 2026-10-30 (F09.18):** a full read of the code found one proven bypass and several smaller holes. All are fixed, each with a test in `tests/security/test_audit_fixes.py`. Sign-ins now go to a log that the database refuses to change and that reveals edits made directly to the file. That makes tampering visible, and it does not stop someone who fully controls the file from rewriting it. No audit can show that nothing can be hacked, and VAULT has had no outside review.

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
7. **Photos, videos and screens held up to the face check (F09.22).** The server issues a random challenge with the sign-in ticket: two of turn left, turn right, look up and blink, in a random order, answerable once within 25 seconds (at most 5 challenges per ticket, and still 3 wrong answers). The browser sends, per frame, the head turn and tilt worked out from the face mesh, eye openness, and Human's liveness and anti-spoof scores, plus face fingerprints from before the first move, between moves and after the last. The server (`backend/security/liveness.py`) requires the moves in the order asked, no head move that was not asked for before the last one, a plausible timing (at least 1.2 s, frames no more than 400 ms apart, and no longer than the challenge was open), the head really moving, at least 40 % of frames (and 5 or more) passing both passive scores, and every fingerprint matching the saved face and each other. A still photo fails (no movement, no blink). A phone or screen replaying a recording of someone making every move passes only when the random order happens to match it: 1 in 12 per challenge in the test (`test_a_recorded_video_rarely_matches_a_random_challenge`), and the attempt ends after 3 wrong answers. Setting up the face check needs the same challenge, so a photo cannot be enrolled. **Honest limits:** every one of these numbers is measured in the browser, so an attacker who modifies VAULT's browser code (or writes their own client) can send made-up numbers that pass. It also does not stop a real-time deepfake fed into a virtual camera, a good 3D mask, or someone recording the person's face and making the moves live. It raises the bar against holding up a photo, a phone video or a screen; it is not unbeatable, which is why the face check stays a later step after a password or a passkey. Hardware liveness (Windows Hello with an infrared camera, or a phone's Face ID) comes as a passkey.
8. **Camera and the face check (F09.19).** The camera runs only on VAULT's own pages (`Permissions-Policy: camera=(self)`), only while the person sets up or uses the face check, and the picture never leaves the page. The Human library computes 1,024-number face fingerprints, plus liveness and anti-spoof scores, in the browser. The server stores only those fingerprints (`face_templates`), compares them with its own copy of Human's similarity measure (match ≥ 0.6, live ≥ 0.5, real ≥ 0.5), and issues a session only after the face step. Each face step allows 3 tries in 2 minutes. Because the browser computes the scores, a person who controls that computer could replay a recording. The face check is therefore only ever a second factor after a password or passkey, never a sign-in on its own. Hardware liveness comes from Windows Hello with an IR camera, as a passkey. Face fingerprints are biometric data: they are deleted with "Delete my face data", and admins can see only whether a person has set it up, never the data.
9. **Chosen sign-in steps, the microphone and the key phrase (F09.20).** A person can require any mix of password, passkey, face check and spoken key phrase; the server keeps the chain in a short-lived ticket (3 minutes, 3 wrong answers) and issues a session only after the last step. A face or key phrase can never start a sign-in. The microphone runs only on VAULT's own pages (`microphone=(self)`) and only while recording. The browser turns each take into MFCC speech features (13 numbers every 20 ms); no recording is sent or stored. The server compares them by dynamic time warping against three saved takes, with a per-person bar between 0.32 and 0.48 (measured with `scripts/calibrate_voice.py`: same phrase and voice 0.17 to 0.27, other phrase or voice 0.56 or more). It checks the phrase and roughly the voice, not a bank-grade voiceprint; a recording of the person saying the phrase would pass, so it is only an extra step. Camera and microphone quality (resolution, frame rate, light, focus, face size; signal above noise) are measured in the browser and re-checked on the server from the reported numbers, so they stop poor equipment, not a person who controls the computer.
6. **VAULT and GitHub (update check, F12.14).** The server asks GitHub's public release list for the newest version. It sends no document data, user names or settings, keeps only links to this project's own releases, and never downloads or runs anything; the person's browser fetches an installer only when they click Download. `VAULT_UPDATE_CHECK=false` turns it off.

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

## Added since the first version (reviewed 2026-10-30)

| Surface | Threat | Control | Remaining risk |
|---|---|---|---|
| Transfer packs | Stolen or altered pack | AES-256-GCM, scrypt, per-chunk binding, SHA-256 per file | A weak or leaked passphrase |
| Share packs | Hidden data or a sensitive value reaches an outsider | New PDFs from checked text; markings refuse; admin approval; report | Redaction misses a name it was not told about, so a person must review |
| Passkeys | Stolen password or database | WebAuthn with user verification; public keys only | Losing every passkey while required needs an admin to reset |
| Uploads with active content | A person opens a malicious original | Held until an admin releases it | The admin's check; parsers still run in the API process (F09.16) |
| Photos, video and sound (F11.8) | A disguised file (a program named `.mov`), a crafted header that makes a parser loop or crash, or a media file that exploits the player of whoever downloads it | The first bytes must match the extension or the upload is refused; same size limit; header fields are read with small bounded parsers (standard library and Pillow only, at most 4,096 boxes or elements, never decoding a frame or sample) that return fewer details instead of raising; nothing is sent to a model, run, transcribed or played by VAULT; originals are read-only and downloaded with `nosniff` as an attachment | VAULT does not check video or sound for exploit payloads aimed at media players, so a downloaded original is as safe as the player that opens it; no active-content hold applies to media; parsers still run in the API process (F09.16) |
| In-app preview (F11.9) | A previewed original runs script with the interface's origin (an object URL shares it), or a held file is opened by previewing it | The server previews only PDF, PNG, JPEG and browser-playable video and sound (`inline=1`, otherwise 415), never SVG, HTML or text; the client sets the object URL's type from the same allowlist; held files return 423; the CSP adds only `media-src` and `frame-src` `'self' blob:` (object URLs this page made), `object-src` stays `'none'`; every preview is audited as `document.view` | PDFs render in the browser's own PDF viewer and media in its own decoders, so a file that exploits those runs with the browser's protections, not VAULT's; PDFs with JavaScript are held, but other crafted PDFs are not checked |
| First-run setup | Someone else claims the owner account | One use only, while no account has a password; local origin only | Anyone at this computer before setup |
| Data at rest | Stolen disk | None in VAULT yet (F09.15); use BitLocker or LUKS | Full exposure without disk encryption |

