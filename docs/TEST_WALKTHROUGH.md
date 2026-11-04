# Test everything in about 40 minutes

A checklist in the order to do it. Each step says what to press and what you should see. Tick it, or note what
went wrong (a screenshot helps). Fictional data only. [`TEST_GUIDE.md`](TEST_GUIDE.md) has the detail behind each
screen, and the in-app **Guide** (side rail, Help) has the same steps.

## 0. Get ready (3 min)

- [ ] Pull the latest code: `git checkout main`, then `git pull`.
- [ ] Ollama is running: `ollama ps` answers (start it with `ollama serve` if not).
- [ ] VAULT is running: `.\start.ps1`, then open http://localhost:3000 in **Chrome or Edge** (cameras and
      microphones work there; some built-in preview panes block them).
- [ ] The fictional test sets exist (make them again any time, they are the same every run):
  - Small, quick to show: `data\testset-demo` (about 130 files, 18 MB).
    `.venv\Scripts\python scripts\make_test_files.py --size demo --out data\testset-demo`
  - Huge, for the "thousands of files" moment: `data\testset-huge` (about 2,000 files).
    `.venv\Scripts\python scripts\make_test_files.py --size huge --out data\testset-huge`

## 1. Sign in (3 min)

- [ ] The sign-in screen shows the VAULT logo and "Your drawings, reports and contracts, read on this computer."
- [ ] Under Try the demo, press **Admin**: it is only selected. Nothing opens until you press **Continue as
      Admin**. Try Analyst and Viewer the same way later.
- [ ] Overview: 150 documents, findings in red. Switch Demo and Real at the top of the side rail: the numbers
      change. Switch back to Demo.

## 2. Ask Keeper (5 min)

- [ ] Side rail > **Ask Keeper**. Type *Which parts have conflicting pressure ratings?* and press Enter.
- [ ] The question flies up into the thread. On the right, the brain lights up: Finder and Conflict checker go out
      to real documents at the same time and bring results back.
- [ ] The answer types out (Llama, about 15 s). It names BV-7891: 1,500 psi on the drawing, 600 psi tested. Each
      cited sentence gets a green tick from the fact checker.
- [ ] A red conflict card shows both quotes side by side. Click a source: the document opens in the drawer.
- [ ] Try: *longest videos first*, *photos from 2024 sorted by date*, *are my models downloaded?*,
      *open approvals*. Use the Refine chips and the Export menu in the header.
- [ ] Thumbs up an answer. The header counts what Keeper has learned. Ask the same question again: it is
      recalled and checked again.
- [ ] Old link: open http://localhost:3000/investigate. It sends you to Ask Keeper.

## 3. Open files in the app (3 min)

- [ ] In any result, open a **photo**: it shows in the drawer, with zoom. Press **Full screen**.
- [ ] Open a **blueprint PDF**, a **stamped inspection report** (APPROVED / REJECTED stamp), a **newspaper**
      (*The Brackwater Ledger*), a **video** and a **sound** file. Each plays or shows inside VAULT.
- [ ] **Download** still saves a copy. A held file (for example the PDF with JavaScript) never previews.
- [ ] In the desktop window (not the browser), try one preview too. Claude could not test the desktop window.

## 4. The huge archive (5 min, start it early)

- [ ] Switch to **Real** mode and make a new collection called *Huge test*, so demo data stays clean.
- [ ] **Add files**: drop the whole `data\testset-huge` folder. Each file gets a line: stored, already in the
      vault, or refused with the reason (wrong type, empty, corrupt, too big). A few are held (hidden scripts).
- [ ] Press the read button. **Progress** shows the run live. Use the **heuristic** reader for speed; Llama on
      2,000 files takes a long time, so start it well before recording if you want Llama.
- [ ] **Brain**: thousands of nodes appear, then fill in as they are read. Drag to turn, scroll to zoom.
- [ ] Ask Keeper in this collection: *find the newspaper articles*, *inspection reports that were rejected*.

## 5. Classified and redacted (5 min) — only once the classify-and-redact PR is merged

- [ ] Open a contract with prices or a page with names and phone numbers. Press **Classify and redact**.
- [ ] Keeper suggests a label (Public, Internal, Confidential or Restricted), the reason, and the parts to black
      out. Nothing changes yet: it is a request in **Approvals**.
- [ ] Approve it as Admin. The badge appears on the document; redacted parts show as black bars.
- [ ] In Ask Keeper type *mark the pricing contracts as confidential*: Keeper makes the request for you.
- [ ] Sign in as **Viewer**: redacted parts read `[REDACTED ...]`, and Restricted documents do not appear in
      lists, search or answers at all.
- [ ] The original file is unchanged (its fingerprint is the same in the document details).

## 6. Approvals (3 min)

- [ ] **Approvals** fills the whole window: the list on the left, the details on the right.
- [ ] **View only** tab: open requests and their copies with no buttons. As Viewer, it is the only mode.
- [ ] As Admin, approve a request: each copy written is listed with a tick. Originals never change.
- [ ] Delete one copy, then delete a whole request with its copies. The dialog says exactly what goes and that
      originals are never deleted.

## 7. Invite someone (3 min)

- [ ] **Security > People > Invite someone**. Walk the steps: name, role, sign-in steps, how they get in, review.
- [ ] Copy the link (or scan the QR). Open it in a private window, choose a password: you are signed in as them.
- [ ] Open the link again: refused (single use).

## 8. Face check and your own sign-in steps (8 min)

Do this in **Real** mode with your own account, not the demo buttons.

- [ ] **Security > How you sign in > Face check > Set it up again.** Allow the camera. The camera appears within
      a second or two.
- [ ] It asks for two moves in a random order (turn left, turn right, look up, blink). The ring fills only on good
      readings. If the light or the angle is bad, it says why instead of finishing.
- [ ] Press **Test my face now**. Write down the numbers it shows (match score, liveness) and send them to Claude.
- [ ] Hold up a photo of your face on your phone to the camera: it should be refused.
- [ ] Tick Password + Face check, **Save sign-in steps**, sign out, sign in. The outline traces your face, the
      screen goes dark with scan lines, then the vault door opens.
- [ ] Key phrase and Passkey: as before. Untick extra steps afterwards if you do not want them every time.

## 9. Attack it (2 min)

- [ ] In a second terminal: `.venv\Scripts\python scripts\attack_demo.py`. Expect **16 of 16 attacks refused**.
      Sign-ins may be refused from this computer for about a minute afterwards: that is the rate limit.
- [ ] **Security > Audit log** lists the refusals.

## What Claude could not test (please report back)

- Your real webcam with the face check and the photo-of-a-face test; your real microphone with the key phrase.
- File previews inside the desktop window.
- A physical security key, and the phone QR flows on a real phone.
- Llama reading the whole huge folder (only the quick heuristic reader was timed).
