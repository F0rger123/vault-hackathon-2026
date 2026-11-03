# Test everything in about 30 minutes

A checklist in the order to do it. Each step says what to press and what you should see. Tick it, or note what
went wrong (a screenshot helps). Fictional data only. [`TEST_GUIDE.md`](TEST_GUIDE.md) has the detail behind each
screen.

## 0. Get ready (3 min)

- [ ] Ollama is running: `ollama ps` answers (start it with `ollama serve` if not).
- [ ] VAULT is running: `.\start.ps1`, then open http://localhost:3000 in **Chrome or Edge** (cameras and
      microphones work there; some built-in preview panes block them).
- [ ] The fictional test set exists: `data\testset-demo` (126 files, 12 MB). To remake it:
      `.venv\Scripts\python scripts\make_test_files.py --size demo --out data\testset-demo`

## 1. Sign in and look around (3 min)

- [ ] The sign-in screen shows the new VAULT logo (a keyhole in four corner marks) and "Your drawings, reports and
      contracts, read on this computer."
- [ ] Press **Admin** under Try the demo. You land on **Overview**.
- [ ] The side rail says "Private. Runs on this machine." and "llama3 downloaded" (if Ollama is on).
- [ ] Overview numbers: 150 documents, findings in red. Switch the collection or Demo/Real: the numbers change.
- [ ] Shrink the window to phone width: nothing scrolls sideways; the menu still works.

## 2. Ask VAULT: the main agent and its helpers (4 min)

- [ ] Side rail > **Ask VAULT**. Press *Which parts have conflicting pressure ratings?*
- [ ] The **Coordinator** card shows its plan. **Finder** and **Conflict checker** light up "At the same time",
      each with a real duration.
- [ ] **Answer writer** says "uses the model" and writes with llama3 (about 15 s).
- [ ] **Fact checker** says how many cited sentences it verified.
- [ ] The answer names BV-7891 and others with numbered sources. Click a source: the document opens.
- [ ] Click a helper card: it shows what it did and what it found.
- [ ] Try: *find videos*, *longest audio first*, *photos from 2024 sorted by date*, *are my models downloaded?*,
      *open approvals*.
- [ ] Press **Watch in the brain** under a reply.

## 3. The brain, live (3 min)

- [ ] **Brain**: the 3D map of the collection. Drag to turn, scroll to zoom.
- [ ] The ticker "What VAULT is doing" says **Idle** when nothing happens. Old events are marked Earlier and do not
      replay.
- [ ] Keep Brain open in one tab and ask a question in Ask VAULT in another: helper craft labelled Finder, Conflict
      checker and so on fly to the real documents; the ticker lists each step.
- [ ] Answer one of VAULT's open questions on the Brain page; it is used on the next run.

## 4. Add files, including photos, video and sound (5 min)

- [ ] Switch to **Real** mode (top of the side rail) and make a new collection, so demo data stays clean.
- [ ] **Add files**: drop the whole `data\testset-demo` folder.
- [ ] Each file gets its own line: stored and checked, already in the vault, or refused with the reason. Expect
      about 18 refused (wrong extensions, empty, corrupt, too big) and 2 held (a PDF with JavaScript, for example).
- [ ] Press the read button. **Progress** shows the run live: the server check every 3 s, documents left, lanes
      working. The Brain (other tab) shows new files appearing, then being read.
- [ ] **Investigate**: Kind of file = Video. Each row shows details like "Video · 0:06 · 320×240". Sort by length.
- [ ] Kind of file = Photo, sort by date taken. Photos show the fake camera and date.
- [ ] Search a word that is only in a photo's name: it is found by name. VAULT says photos and videos are found by
      name, date and details, not by what is inside them.
- [ ] Open a stamped inspection PDF: the APPROVED / QC PASSED / REJECTED text is searchable.

## 5. Findings and approvals (3 min)

- [ ] Back in **Demo** mode: **Investigate** shows the BV-7891 conflict (600 psi tested, 1500 psi on drawings), both
      quotes verified.
- [ ] **Approvals**: approve the waiting request as admin. Each copy written is listed (source to new path) with a
      tick. Originals never change.
- [ ] Brain shows the copies as new green nodes next to their sources.

## 6. Invite someone (3 min)

- [ ] **Security > People > Invite someone**. Walk the steps: name, role (the screen lists what that role can and
      cannot do), sign-in steps, how they get in, review.
- [ ] Copy the link (or scan the QR with your phone). Open it in a private window: "admin invited you as ...".
      Choose a password: you land signed in as that person.
- [ ] Open the link again: it is refused (single use). The invite is gone from "Invites waiting".

## 7. Your own sign-in steps (6 min)

Do this in **Real** mode with your own account, not the demo buttons.

- [ ] **Security > How you sign in**. Four step cards: Password, Passkey, Face check, Key phrase.
- [ ] **Face check > Set up face check.** Allow the camera.
  - [ ] The camera check runs first (size, frame rate, light, sharpness). A bad camera or dark room is refused with
        the reason, and you are offered your phone instead.
  - [ ] A ring follows your face; one segment fills for each accepted reading, then a check mark when VAULT saved it.
- [ ] **Key phrase > Set up key phrase.** Allow the microphone. Press Speak, say a made-up phrase, pause. Three
      times. The bars are your real microphone. A noisy room or a too-quiet microphone is refused, with the reason.
- [ ] **Passkey**: pick This computer (Windows Hello PIN on this laptop), Security key (a YubiKey if you have one),
      or Phone (scan the QR code). Add it.
- [ ] Tick Password + Face check + Key phrase (or any mix), check the preview, **Save sign-in steps**.
- [ ] Sign out, sign in with your password: the trail asks for each step in turn. Try a wrong phrase and someone
      else's face: refused. Three wrong answers end the attempt.
- [ ] Untick the extra steps afterwards if you do not want them every time.

## 8. Security screen (1 min)

- [ ] **Security**: protection checklist, held files, the sign-in log (it shows chains like "Password, then face
      check, then key phrase"), the audit log.

## What is not tested yet by Claude (please report back)

- Your real webcam with the face check, your real microphone with the key phrase.
- A physical security key, and the phone QR flows on a real phone.
- Llama answering in the chat is tested; Llama reading a whole new folder is slower and best started before you
  record.
