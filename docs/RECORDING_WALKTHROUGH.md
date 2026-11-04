# Recording walkthrough: the VAULT demo video, step by step

Follow this top to bottom. It matches the app on `main` as of 2026-11-04. The narration is in
[`DEMO_VIDEO_SCRIPT.md`](DEMO_VIDEO_SCRIPT.md); the prompts are in [`DEMO_PROMPTS.md`](DEMO_PROMPTS.md).

Names used below, exactly as the app shows them:

- Web address: **http://localhost:3000** (the API is on http://127.0.0.1:8000).
- Side rail: **Overview**, **Add files**, **Progress**, **Ask Keeper**, **Training**, **Brain**, **Approvals**,
  **Security**, **Models**, **Guide**. The **Demo** / **Real** switch is at the bottom of the side rail.
- Demo collection: **Halvern Engineering Archive** (150 fictional documents, already read).

---

## Part 1 · Before recording (15 minutes)

### 1. Start everything

In PowerShell, in the VAULT folder:

```powershell
git checkout main
git pull
ollama ps
.\start.ps1
```

- `ollama ps` must answer without an error. If it doesn't, run `ollama serve` in another window first.
- `start.ps1` says "llama3:latest is ready" under *Local AI*, then starts the web interface. The first start after
  an update builds the interface (about a minute).

### 2. Confirm the Llama model

```powershell
ollama list
```

`llama3:latest` (or `llama3:8b`) must be in the list. Do not download anything else for the video.

### 3. Sign in and pick the collection

1. Open http://localhost:3000 in Chrome or Edge.
2. Under **Try the demo**, press **Admin**, then **Continue as Admin**.
3. Check the **Demo** switch is on (side rail, bottom) and the collection is **Halvern Engineering Archive**.
   Overview shows 150 documents.

### 4. Get the Quick Demo Dataset

On **Overview** (Demo mode), press **Download Demo Dataset**, then **Quick Demo Dataset**. Unzip it to
`C:\VAULT-demo\quick`. This is the folder you drop in during the "How it works" segment.

(If that button is not on your Overview yet, the download feature is not merged: use
`data\synthetic\v1\files` instead. It is the same fictional archive.)

### 5. Check the BV-7891 example works

1. Side rail > **Ask Keeper**.
2. Press the prompt *Which parts have conflicting pressure ratings? Show the exact values and cite the original
   documents.*
3. Within about 20 seconds the answer names **BV-7891** with **600 psi and 1500 psi**, with numbered sources and
   green ticks on the cited sentences. The first answer after a restart can take longer while Llama loads.
4. Click the source **ALP-DWG-0005.pdf** (the drawing, 1,500 psi) and **ALP-INS-0001.pdf** (the inspection
   report, 600 psi). Each opens in the document drawer.

If the answer does not name BV-7891, stop and tell Claude before recording.

### 6. Prepare the Brain

Side rail > **Brain**. Wait until the 3D brain has loaded and settles. Drag once to check it turns. Then go back to
**Ask Keeper** and press **Clear chat** so the chat is empty for the take.

### 7. Check the security output

In a second PowerShell window:

```powershell
.venv\Scripts\python scripts\attack_demo.py
```

It must end with **"16 of 16 attacks refused."** Note the number you get; it is the number you say. After this,
sign-ins from this computer are refused for about a minute (the rate limit working): wait before signing in again.

### 8. Hide private things

- Close everything except the browser and that PowerShell window.
- Turn on Windows **Do not disturb** (Settings > System > Notifications).
- Never show `.env`, `data\runtime`, `dev_tokens.json`, a terminal that printed a token, or your email.
- Use a browser window with no bookmarks bar and no other tabs. Zoom the page to 110 % so citations are readable.

---

## Part 2 · Recording on Windows

**Option A: Snipping Tool (quick).** Press **Windows + Shift + R**, drag over the browser window, press **Start**.
Press the stop button in the toolbar when done. The MP4 is saved to `Videos\Screen Recordings`. Turn the
microphone on in the toolbar before starting.

**Option B: OBS Studio (recommended for several takes).**

1. Settings > Video: base and output **1920×1080**, **30 FPS**.
2. Settings > Output: recording format **MP4**, quality "High".
3. Sources: **Window Capture** (the browser) and **Audio Input Capture** (your microphone). Check the mic meter
   moves and does not hit red.
4. Record each segment below as its own take, then join them in Clipchamp (built into Windows) or any editor.

Use a headset or a quiet room. Speak a little slower than normal.

---

## Part 3 · The segments

Times are for the final edit. "Live" means record it in one take; "Separate" means record it alone and edit it in.

### Segment 1 · 0:00–0:20 · The problem (Separate)

- **Where:** Ask Keeper, or File Explorer at `C:\VAULT-demo\quick`.
- **Do:** open `ALP-DWG-0005.pdf` and `ALP-INS-0001.pdf` from a search result (the drawer opens; press
  **Full screen**). Show the 1,500 and 600 values for BV-7891.
- **On screen:** the drawing, then the inspection report.
- **Hold:** about 8 seconds on each.
- **Say:** segment "The problem" from the script.
- **If it fails:** use a fast scroll of the dataset folder in File Explorer instead.

### Segment 2 · 0:20–0:40 · Introducing VAULT (Live)

- **Where:** http://localhost:3000, signed out (**Sign out** at the bottom of the side rail, or open a private window).
- **Do:** under **Try the demo** press **Admin**, then **Continue as Admin**. Land on **Overview**.
- **On screen:** the sign-in screen, then Overview with 150 documents and the red findings count.
- **Hold:** 5 seconds on Overview.
- **Say:** "Introducing VAULT".
- **If it fails:** if sign-in is refused, wait one minute (rate limit after the attack test) and try again.
- **Optional:** if your own account has the face check set up, sign in with it instead to show the outline, scan
  and vault door. Record it separately; do not risk a failed face check in a live take.

### Segment 3 · 0:40–1:02 · How it works (Separate)

- **Where:** switch to **Real** (side rail, bottom), make a new collection (for example *Quick demo*), then
  side rail > **Add files**.
- **Do:** drag the folder `C:\VAULT-demo\quick` onto the page. Each file gets its own line (stored, refused or
  held). Then press **Start the run** and go to **Progress**.
- **On screen:** the file lines, then Progress with the run working, then 3 seconds of **Brain**.
- **Hold:** 6 seconds on each screen. Cut while it is still working: you do not need to wait for it to finish.
- **Say:** "How it works".
- **If it fails:** record Progress on the demo collection's last finished run instead; never fake numbers.
- Switch back to **Demo** after this segment.

### Segment 4 · 1:02–1:45 · The main demonstration (Live)

- **Where:** **Demo** mode, collection **Halvern Engineering Archive**, side rail > **Ask Keeper**, empty chat.
- **Do:** press the prompt *Which parts have conflicting pressure ratings? Show the exact values and cite the
  original documents.* (or type it and press Enter).
- **On screen:** the question flies up; the 3D brain beside the chat lights up as Finder and Conflict checker work;
  the answer arrives naming BV-7891 at 600 and 1500 psi with numbered sources and green ticks.
- **Then:** click the source for **ALP-DWG-0005.pdf**, show 1,500 psi, close; click **ALP-INS-0001.pdf**, show 600
  psi.
- **Hold:** 4 seconds on the finished answer, 4 seconds on each document.
- **Say:** "The main demonstration". Llama takes about 16 seconds: talk over the wait, or cut it and put "sped up"
  on screen.
- **If it fails:** press the prompt again. If Llama is not answering, check `ollama ps` and restart `start.ps1`.

### Segment 5 · 1:45–2:08 · Human control (Separate)

- **Where:** side rail > **Approvals**.
- **Do:** show the **View only** tab and open a request; then **Review and decide**, pick a waiting request and
  press **Approve and export copies**. Each copy appears with a tick.
- **On screen:** the full-width list and details, then the approved copies.
- **Hold:** 5 seconds on the approved request.
- **Say:** "Human control".
- **If it fails:** if nothing is waiting, open the **Approved** filter and show an earlier approved request.

### Segment 6 · 2:08–2:31 · Engineering and security (Separate)

- **Where:** PowerShell in the VAULT folder; then https://github.com/F0rger123/vault-hackathon-2026/actions.
- **Do:** run `.venv\Scripts\python scripts\attack_demo.py`.
- **On screen:** each attack line marked REFUSED, ending "16 of 16 attacks refused". Then the Actions page with
  green checks.
- **Hold:** 4 seconds on the final line, 3 seconds on GitHub.
- **Say:** "Engineering and security", with the number your run printed.
- **If it fails:** if a line says GOT THROUGH, do not use the take; tell Claude.

### Segment 7 · 2:31–2:50 · Closing (Separate)

- **Where:** **Brain**, then Ask Keeper's finished answer.
- **Do:** slowly drag the brain; cut to a verified citation; end on the VAULT logo (sign-in screen).
- **Hold:** 6 seconds each.
- **Say:** "Closing".

---

## Part 4 · Before you submit

- [ ] Runtime is under 3:00 (the only length we have is the 3 minutes you confirmed; the public pages state no
      limit).
- [ ] Audio is clear, no clipping, no background noise.
- [ ] Citations and file names are readable at 1080p.
- [ ] Meta Llama is visible: "by llama3:latest" in the answer, or *Local AI* in `start.ps1`.
- [ ] The security number you say matches your run; no "unhackable" or "certified".
- [ ] No private information: no tokens, `.env`, email, notifications or real files.
- [ ] Watch the final MP4 once from start to finish; it plays with sound.
- [ ] Sign in to the Cerebral Valley portal and read the submission form and Official Rules: video length,
      hosting (YouTube or other), visibility, and anything else they ask. Those rules win over this guide.
- [ ] Submit before **November 4, 9:00 PM Eastern**.
