# Demo Video Script (3:00)

This is the word-for-word script and click path for the hackathon video. The timing table and segment statuses are in [`DEMO_STORYBOARD.md`](DEMO_STORYBOARD.md).

- **Target:** 2:50 of footage plus 10 seconds of slack. At a normal speaking pace, about 140 words a minute, the narration below (about 300 words) runs about 2:10, leaving room for pauses and clicks.
- **Rule:** show only things that really work, on fictional data. If a feature is not merged by Nov 2, cut its lines.

## Before you record

1. Reset the demo: `.\scripts\demo_reset.ps1 --provider ollama`. It takes about 13 minutes, so do it once before the session. Use `--provider heuristic` for a 12-second rehearsal reset.
2. Start VAULT in its own window: `.\start.ps1 -App`. It uses the demo data in `data/demo`. To record in a browser instead, run `.\start.ps1` and open `http://localhost:3000` in a clean profile at 1920×1080, zoomed to 110%.
3. Check that Ollama is running (`ollama ps`), so Llama 3 answers live.
4. **Passkey shot:** register a passkey on Security beforehand (Windows Hello face or fingerprint, or a YubiKey), then sign out. Never show the PIN.
5. Never show a token, `.env`, or a real file on screen. Use **Demo mode**.

## Script

### 0:00–0:20 · The problem (title card, then the file folder)

**Show:** the title card "VAULT: private document intelligence". Then a File Explorer window scrolling through `data\synthetic\v2\files`: drawings, inspection reports, contracts, stamps.

**Say:**
> "Engineering firms sit on thousands of drawings, inspection reports and contracts. The facts that matter are scattered across them, and they often disagree. These archives are confidential, so they can't go to a cloud AI. People check them by hand, and it takes days."

### 0:20–0:40 · It runs here (sign in, Overview)

**Show:**
- The VAULT window. Sign in with **Sign in with face, fingerprint or security key**; Windows Hello appears.
- On the Overview, scroll to **Meta models for this computer**: the graphics card, the recommended Llama models and the Install buttons.

**Say:**
> "VAULT is an app on this laptop. I sign in with my face, and the face never leaves the device. It checks the hardware and installs the Meta Llama models that fit, so no document ever leaves the machine."

### 0:40–1:05 · Reading with Llama (live run board)

**Show:**
- Start a run on a small collection with **Read new documents with Llama 3**.
- On the live board: the coordinator, the security gate, the Llama lane and the reviewer.
- Then the **Run summary**. Ask the coordinator *"How fast is it?"*; Llama answers from the run's records.

**Say:**
> "A coordinator hands documents to parallel Llama lanes, and a security gate checks every file first. Every fact Llama extracts must quote its page. Files already read are skipped, and I can ask the coordinator how the run is going."

### 1:05–1:35 · Finding what disagrees (Investigate)

**Show:**
- **Investigate**: open the BV-7891 conflict card. It shows 600 psi in the inspection and 1500 psi on the drawings, with both quotes "Verified in source".
- Ask: *"Which parts in Project Alpha have conflicting pressure ratings?"* Click a numbered citation.

**Say:**
> "This valve is rated 1500 psi on six drawings but was tested at 600. VAULT found it across documents and shows both lines. Ask in plain words, and every sentence of the answer cites a source VAULT has checked."

### 1:35–2:05 · It learns your organization (Brain and Training)

**Show:**
- **Brain**: fly through the 3D map for two seconds; the red parts are conflicts.
- Answer one of VAULT's questions: *"What does PV stand for?"* → *"Pressure valve"*.
- Cut to **Training**: the held-out score and its trend, and one **Quiz VAULT** card.

**Say:**
> "Each project gets its own brain. VAULT finds gaps in what it knows and asks, like what PV means, and every answer is kept for that project only. Training shows the score on documents nobody corrected, so you see real improvement, not memorisation."

### 2:05–2:25 · Sharing safely (Approvals)

**Show:**
- **Approvals → Share with someone outside**. Type *"Everything on Alpha for the buyer, hide names and prices"*, then press **Fill in the settings from my words** and **Plan the share pack**.
- The plan: what is shared, what is left out and why.

**Say:**
> "Say a buyer needs some of this archive. VAULT plans redacted copies, never the originals, and lists everything it left out and why. Nothing is written until an administrator approves."

### 2:25–2:45 · Security (Security screen, then a CI checks slide)

**Show:**
- **Security**: the protection checklist and **Held by the security gate**.
- Cut for 3 seconds to a slide of the automated checks: Semgrep, Trivy, OWASP ZAP, and over 200 automated tests (189 backend, 24 browser).

**Say:**
> "A live checklist shows which protections are on. Files that could run code when opened are held until an admin releases them. Every change is scanned automatically. We don't claim it's unhackable; we test it."

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
