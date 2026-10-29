# Demo Video Script (3:00)

This is the word-for-word script and click path for the hackathon video. The timing table and segment statuses are in [`DEMO_STORYBOARD.md`](DEMO_STORYBOARD.md).

- **Target:** 2:50 of footage plus 10 seconds of slack. At a normal speaking pace, about 140 words a minute, the narration below runs about 2:45.
- **Rule:** show only things that really work, on fictional data. If a feature is not merged by Nov 2, cut its lines.

## Before you record

1. Reset the demo: `.\scripts\demo_reset.ps1 --provider ollama`. It takes about 13 minutes, so do it once before the session. Use `--provider heuristic` for a 12-second rehearsal reset.
2. Start the API on the demo data. In PowerShell:

   ```powershell
   $env:VAULT_DATA_DIR = "data/demo"
   .venv\Scripts\vault serve
   ```

3. Start the interface in another terminal: `cd frontend; npm run build; npx next start -p 3000`.
4. Open `http://localhost:3000` in a clean browser profile at 1920×1080, zoomed to 110%. Close other tabs.
5. Check that Ollama is running (`ollama ps`), so Llama 3 answers live.
6. Never show a token, `.env`, or a real file on screen. Use **Demo mode** and the demo sign-in buttons.

## Script

### 0:00–0:20 · The problem (title card, then the file folder)

**Show:** the title card "VAULT: private document intelligence". Then a File Explorer window scrolling through `data\synthetic\v2\files`: drawings, inspection reports, contracts, stamps.

**Say:**
> "Engineering firms sit on thousands of drawings, inspection reports and contracts. The facts that matter are scattered across them, and they often disagree. These archives are confidential, so they can't go to a cloud AI. People check them by hand, and it takes days."

### 0:20–0:45 · It runs here (Set up a run)

**Show:** the sign-in screen. Click **Demo: analyst**, then the Overview. Point at the green "Private. Runs on this machine." line, then go to **Set up a run**: the hardware panel and the measured capacity.

**Say:**
> "VAULT runs entirely on this laptop. Meta's Llama 3 runs locally through Ollama, so no document leaves the machine. Before it promises a finish time, it measures this computer and benchmarks real documents."

### 0:45–1:10 · Reading with Llama (live run board)

**Show:** start a run on a small collection with the **Meta Llama 3** lane. Watch the live board: the coordinator, the security gate pinning an export-controlled file to local lanes, the Llama lane, and the reviewer.

**Say:**
> "A coordinator hands documents to Llama 3 lanes. A security gate reads every file first: export-controlled files never leave local lanes, and text that tries to give the AI instructions is flagged. Llama returns structured facts, and every fact must quote the page it came from."

### 1:10–1:45 · Finding what disagrees (Investigate)

**Show:** **Investigate**. Open the BV-7891 conflict card: 600 psi in the inspection, 1500 psi on the drawings, both quotes marked "Verified in source". Then type in **Ask the archive**: *"Which parts in Project Alpha have conflicting pressure ratings?"* Llama answers with numbered citations; click one and it scrolls to the quote.

**Say:**
> "Here's what matters: this valve is rated 1500 psi on six drawings but was tested at 600. VAULT found it across documents and shows both lines. You can just ask, too: every sentence of Llama's answer is tied to a source, and VAULT checks each number against that source."

### 1:45–2:10 · Teaching it (Training)

**Show:** **Training**. Press **Run graded test**: the scores per field. Correct one wrong document, then press **Re-test**: the score before and after, measured on documents nobody corrected.

**Say:**
> "When it gets something wrong, you correct it once. VAULT turns that into a versioned rule and re-tests on documents you never touched, so you can see whether it really improved before you trust it with real data."

### 2:10–2:30 · Nothing moves without approval (Approvals)

**Show:** **Approvals**. Type *"Group by year, then project"* and press **Suggest a pattern from this request**; Llama fills in `{year}/{project}`. Then switch to the admin account, preview the folder tree, and approve. The page shows "The originals were not touched."

**Say:**
> "Reorganizing is only ever a proposal. Llama turns a plain request into a folder plan, an administrator previews it, and approving exports copies. Originals never change."

### 2:30–2:45 · Security (Security screen, then a CI checks slide)

**Show:** **Security**: remote inference Off, and the audit log filtered to **Denied**. Cut for 3 seconds to a slide listing the automated checks: Semgrep, Trivy, OWASP ZAP baseline and API scan, 0 failures, plus 80+ automated tests.

**Say:**
> "Permissions are enforced on the server and every denial is logged. Every change is scanned automatically, and we ran OWASP ZAP against our own stack. We don't claim it's unhackable; we test it."

### 2:45–3:00 · Results (results slide)

**Show:** a slide with the held-out table from `evaluation/results/SUMMARY.md`. Use the final F11.4 numbers once they exist.

**Say:**
> "On held-out data, Llama 3 finds every planted pressure conflict with no false alarms, all on one laptop. VAULT: your documents, your hardware, answers you can check."

## Should the video show penetration testing?

Briefly, yes, as above. Show the results in about 5 seconds (a slide or the Actions tab with the scan jobs green), not a live attack.

- **Why short:** judges score impact, Meta AI use, the demo and technical depth. A long security segment takes time from the Llama features that carry the most weight.
- **Why not live:** a live tool run is slow on video and hard to read.
- **Wording:** say "tested with" and never "proven secure".

## Recording tips

- Record each section as a separate take and join them afterwards. If a take goes wrong, redo just that section.
- Pre-process the main collection. Show the live run on a small subset of about 20 files, so the board moves on camera.
- If Llama is slow on a take, trim the wait in editing and say so on screen ("sped up 4×"). Never fake a result.
- Check the final length is at most 3:00 and the upload link works before Nov 4, 9:00 PM ET.
