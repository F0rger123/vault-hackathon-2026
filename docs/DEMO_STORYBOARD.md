# Demo Storyboard (target ≤ 3:00)

Rule: show only features that really work, on fictional data. If something is not ready by Nov 2, cut its segment or narrate it as future work; never fake it. Status on 2026-10-26 is given for each segment.

| Time | Segment | On screen | Narration (draft) | Status |
|---|---|---|---|---|
| 0:00–0:20 | Problem | Folder of 150 mixed files (drawings, inspections, contracts, stamps) | "Engineering organizations sit on archives no one can read end to end, and they can't upload them to a public AI." | Ready (dataset exists) |
| 0:20–0:45 | Local install, import, estimate | `docker compose up` or `vault serve`; Import screen; inventory; hardware profile (RTX 5070, 31 GB); measured estimate | "VAULT runs on our own laptop. It measured this machine and benchmarked three real documents before committing." | Backend ready; Import UI pending (F10) |
| 0:45–1:15 | Meta-model processing | Provider badge "Local processing · Meta Llama 3" (or Muse Spark with remote disclosure); job progress with 2 workers | "Each document is read by a Meta model that returns structured facts with exact quotes as evidence." | Backend ready; quality tuning pending (F04); progress UI scaffold exists |
| 1:15–1:55 | Investigation | Search "PV-5595"; finding "conflicting pressure ratings: 300 psi vs 1500 psi"; evidence lines from the drawing and the field inspection; open original PDF | "VAULT found that the field inspection tested this valve at a different pressure than the drawing specifies, and shows both sources." | Backend ready; evidence viewer pending (F10) |
| 1:55–2:20 | Proposal and approval | Proposal "organize by project / type / year"; preview tree; admin approves; export folder of copies | "Nothing moves without approval, and the originals are never touched." | Backend ready; Actions UI pending |
| 2:20–2:45 | Security | Viewer tries to upload → blocked; audit log shows the denial; injected memo flagged and ignored | "Permissions are enforced on the server and every denial is recorded. A planted malicious instruction was flagged as data, not obeyed." | Backend ready (tests S1, S3); audit UI pending |
| 2:45–3:00 | Results and future | Evaluation table (real numbers), privacy architecture diagram | "Measured on held-out data, all local by default. Next: vision for scanned stamps, enterprise identity, scale-out workers." | Numbers pending full model run |

## Production notes

- Record at 1080p with a clean browser profile and no real names, emails or tokens on screen.
- Pre-process the collection before recording; show a short live job on a small subset for the progress segment.
- Luke edits on Nov 3; Franco supports presentation and UI capture.
- Verify the final video length and the upload link before Nov 4.
