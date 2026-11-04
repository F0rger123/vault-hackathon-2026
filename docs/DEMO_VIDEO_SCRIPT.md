# VAULT demo video script (about 2:50)

The narration Luke reads, with what is on screen. Every claim below was checked against the running app on
2026-11-04; the evidence is in the last section. The click-by-click instructions for each segment are in
[`RECORDING_WALKTHROUGH.md`](RECORDING_WALKTHROUGH.md). The older 3:00 version is [`VIDEO_SCRIPT.md`](VIDEO_SCRIPT.md).

Changes from the draft, and why:

- "test report" became "inspection report": the 600 psi value is in `ALP-INS-0001.pdf`, an inspection report.
- "sixteen adversarial cases" stays: `scripts/attack_demo.py` refused 16 of 16 on 2026-11-04. If your run shows a
  different number, say that number.
- "multiple agents work together" is accurate: Keeper runs Finder and Conflict checker at the same time, then the
  answer writer (Llama) and the fact checker.

---

### 0:00–0:20 · The problem

**Show:** the drawing `ALP-DWG-0005.pdf` (BV-7891 at 1,500 psi) and the inspection report `ALP-INS-0001.pdf` (600
psi) side by side in the document drawer, or a fast scroll through the demo dataset folder.

> "What if a critical mismatch was buried inside hundreds of engineering drawings and reports?
> One drawing lists a valve at 1,500 PSI. An inspection report records it at just 600.
> There might be an explanation, but finding that difference could take hours. And these documents may be too
> sensitive to upload to cloud AI."

### 0:20–0:40 · Introducing VAULT

**Show:** the sign-in screen, then the Overview dashboard of *Halvern Engineering Archive* (150 documents).

> "So I built VAULT: a private AI workspace that runs locally on your own computer.
> Using Meta's Llama model, VAULT lets you investigate your documents without sending their contents to an
> external AI service.
> And instead of just giving you an answer, it shows the evidence."

### 0:40–1:02 · How it works

**Show:** Add files with the Quick Demo Dataset (each file gets its own line), Progress with the run, then the 3D
Brain.

> "First, I import my files.
> VAULT screens incoming files before processing them. Accepted documents are indexed and analyzed using Llama
> running locally.
> Behind the scenes, VAULT builds a searchable knowledge base, connecting extracted information back to the
> original sources."

### 1:02–1:45 · The main demonstration

**Show:** Ask Keeper with the 3D brain beside the chat. Click the prompt *Which parts have conflicting pressure
ratings? Show the exact values and cite the original documents.* The brain lights up as Finder and Conflict
checker work; the answer arrives with numbered sources and green ticks. Click the sources for `ALP-DWG-0005.pdf`
and `ALP-INS-0001.pdf`.

> "Now, here's where it gets interesting.
> I ask Keeper to find conflicting pressure ratings.
> Instead of searching manually, Keeper coordinates specialized agents to find relevant information and compare
> results.
> And here it is: BV-7891.
> The drawing shows 1,500 PSI. The inspection report shows 600.
> That doesn't automatically mean the component is defective, but it identifies something worth investigating.
> And watch this: I can click the citations and inspect both original documents.
> I'm not just trusting an AI-generated answer. I can verify where the information came from."

### 1:45–2:08 · Human control

**Show:** Approvals (full width), the View only tab, then *Approve and export copies* on a waiting request: each
copy is listed with a tick.

> "VAULT goes beyond answering questions.
> It can propose changes to how your files are organized, but it never silently overwrites your originals.
> The user reviews and approves proposed copies before changes happen.
> The AI does the tedious work. The human stays in control."

### 2:08–2:31 · Engineering and security

**Show:** the terminal running `.venv\Scripts\python scripts\attack_demo.py` ending in "16 of 16 attacks refused",
then the GitHub Actions page with the checks green.

> "And because this handles sensitive information, security is part of the architecture.
> I've tested malicious file imports, forged authentication, and other attack scenarios.
> In this test run, all sixteen adversarial cases were rejected.
> That doesn't mean VAULT is unhackable. It means the system is designed to be tested, challenged, and improved."

### 2:31–2:50 · Closing

**Show:** the 3D Brain, a verified citation, then the VAULT logo.

> "I built VAULT solo during this hackathon to explore a different future for AI.
> One where your data stays under your control, multiple agents work together, and every important answer can be
> traced to evidence.
> VAULT. Your files. Your machine. Answers you can check."

---

## Evidence behind each claim (checked 2026-11-04)

| Claim | Evidence |
|---|---|
| Runs locally with Meta's Llama | Ollama on `127.0.0.1:11434` serves `llama3:latest` and `llama3:8b`; the answer writer reported "5 sentences by llama3:latest". Remote inference is off by default. |
| BV-7891 is 1,500 psi on the drawing and 600 on the inspection report | `data/synthetic/v1/manifest.json`: `ALP-DWG-0005.pdf` 1500, `ALP-INS-0001.pdf` 600, anomaly `rating_conflict:BV-7891`. |
| Keeper coordinates agents and cites sources | The pressure question on the demo collection: Finder and Conflict checker ran, Llama wrote the answer in 16.4 s, the fact checker verified 4 of 4 cited sentences; BV-7891 600 vs 1500 named with sources. Nothing is hard-coded: the answer comes from the stored findings and Llama. |
| Screening before processing | `attack_demo.py`: a program disguised as a PDF, a zip bomb and an empty file were refused at upload. |
| Originals are never overwritten | Approvals writes copies into VAULT's export folder; `tests/integration/test_proposal_delete.py` checks originals byte for byte. |
| 16 adversarial cases rejected | `attack_demo.py` on 2026-11-04: "16 of 16 attacks refused". `tests/security`: 86 passed. |
| Ten of ten conflicts (optional line) | `evaluation/results/v2/ollama-20261029-004818.json`: planted 10, found 10, precision 1.0, with llama3. |

## Words to avoid

"Unhackable", "military grade", "certified", "ready for classified data", "the AI looks at the photos" (photos,
video and sound are sorted by name, date and details, not by what is in them).
