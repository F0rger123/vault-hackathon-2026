# Test VAULT yourself: what everything does and how to check it

A walk through every screen, what is real behind it, and what to try. Use the fictional test files described in
section 3; never real documents or real people's data.

## 1. Start

1. Start Ollama (Start menu, or `ollama serve`), then VAULT: `.\start.ps1` from the repository, or open the installed
   `VAULT.exe` from the [latest release](https://github.com/F0rger123/vault-hackathon-2026/releases/latest).
2. Sign in. Demo buttons work only in Demo mode with fictional data; Real mode uses your own account.

**Check:** the side rail shows "Private. Runs on this machine." (green), the reading model (for example
"llama3 downloaded"), and the version at the bottom. If Ollama is off, the rail and the Models page say so.

## 2. Every screen

| Screen | What it does (all real) | What to test |
|---|---|---|
| **Overview** | Counts for the collection you are in: documents, pages, findings, runs, approvals. | Switch collection or Demo/Real: the numbers change to that collection only. |
| **Add files** | Uploads files or a folder, checks each file (type, size, active content), then reads them with the model you pick. Each file gets its own line that changes when the server has stored and checked it. | Drop the test set (section 3). Files VAULT refuses are listed with the reason. Press the read button. |
| **Progress** | What VAULT is doing right now: whether the server answers (checked every 3 s), whether a run is reading, how many documents still wait, and whether the model is loaded. A running run shows each agent's real events. Finished runs are listed as finished; nothing replays by itself. | Start a run and watch counts rise. Stop Ollama mid-run: lanes report errors. Pick an older run: it shows as finished, with a Replay button. |
| **Investigate** | Search, filters, and questions answered with numbered sources quoted from the stored pages. | Ask "Which parts have conflicting pressure ratings?". Every number in the answer must appear in a cited line. |
| **Chat (Ask VAULT, or press `/`)** | Turns typing into a search, a sort, a filter, a question, a page to open, or the model list. | "find contracts newest first", then "only 2024", then "sort by name"; "are my models downloaded?"; "open approvals". |
| **Training** | Grades how well VAULT reads against known answers (demo) or your corrections, then re-tests. | Run a grade; correct one document; re-test. |
| **Brain** | What VAULT learned for this collection, its open questions, and the 3D map. The map is live (F10.22): "What VAULT is doing" beside it lists, with times, every file stored, read, looked at by an Ask VAULT helper, or copied by an approval, from the server's record. Craft labelled Finder, Conflict checker, Answer writer and Fact checker fly to the documents they really used; the Sorter's documents line up in its order and return; copies appear as green nodes beside their source, labelled with the new path; new files appear on a ring until they are read. With no new record it says "Idle: nothing is happening right now" and nothing moves. With reduced motion on, only the list changes. | Open Brain in one window and Ask VAULT in another; ask "Which parts have conflicting pressure ratings?" and watch the helpers. Ask "find drawings for Alpha, newest first" for the Sorter. Approve a reorganization for the copies. Or use "Watch in the brain" under a reply. Answer one question; it is used on the next run. |
| **Approvals** | Reorganizing or sharing files waits for an admin. Approving writes copies; originals never change. | Ask for a share pack; approve as admin; check the copies and that originals are untouched. |
| **Security** | Protection checklist, held files, sign-in security (section 4), people, the sign-in log and audit log. | Add a person, sign in as them, check the log. Try to delete a log row with a SQLite tool: it refuses. |
| **Models** | Which models are downloaded, which is in use, and downloads for more. | Download a small one (Llama 3.2 1B, 1.3 GB) and switch to it. |

**What VAULT does not do yet (so you are not surprised):**
- It does not look inside photos, video or sound. They are stored with the details in the file itself: size in pixels, length, sample rate, and for photos the date taken and camera. They are marked "not read: photo", "not read: video" or "not read: audio" and never go to a model. Find and sort them by name, date and those details: "find videos", "photos from 2024 sorted by date", "longest audio first", "show me pictures". A word search finds them by name and details, not by what is in them.
- Video accepted: MP4, MOV, WebM, AVI. Sound accepted: WAV, MP3, M4A, OGG. The file's first bytes must match its extension, so text named `.mp4` or a program named `.mov` is refused.
- It reads only when you start a run. It does not watch folders.

## 3. The fictional test file set

For a demo, make the small set: 126 files (about 12 MB) that is quick to read. It has stamped inspection
reports (APPROVED, QC PASSED and REJECTED seals), drawings with revision clouds and numbered callouts, site photos
dated 2023 to 2025 with markers, arrows, tape measures and stickers, short gauge videos and voice-memo stand-ins.

```powershell
.venv\Scripts\python scripts\make_test_files.py --size demo --out data\testset-demo
```

The full set is 482 files (139 MB): PDFs, Word, Excel, PowerPoint, CSV, text, Markdown, JSON, photos, videos, sound
files and edge cases, including files at and over the 50 MB limit.

```powershell
.venv\Scripts\python scripts\make_test_files.py --out data\testset --count 400 --seed 7
```

Videos are hand-made Photo-JPEG MOV and Motion-JPEG AVI. When `ffmpeg` is installed the set also gets H.264 MP4 and
WebM clips (`--no-ffmpeg` keeps every byte the same on every computer). Sound is synthesized tones (WAV) and silent
MP3 frames, with no speech.

- `data\testset\README.txt` explains the folders, and `manifest.json` lists every file with the result VAULT should give
  (`outcome` is one of `read`, `stored-with-metadata`, `refused`, `held`):
  - read;
  - stored with details: photos, video and sound, with `media` giving the length, size in pixels and date taken VAULT
    should show;
  - refused, with the reason;
  - held for review.
- 26 conflicts are planted on purpose, for example the same part with different pressure ratings in two documents. After a run, Overview's findings should include them, except the ones that exist only inside a photo.
- Edge cases:
  - an empty file;
  - wrong extensions;
  - a 199-character name;
  - unicode names;
  - duplicates;
  - an encrypted PDF;
  - a corrupt PDF;
  - a PDF with JavaScript (held for review);
  - a memo containing a prompt-injection line (flagged, never obeyed);
  - a 49 MB picture near the 50 MB limit.

## 4. Sign-in security, step by step

Each person picks their own sign-in steps on **Security > How you sign in**: any mix of the four below, so two,
three or all four. An admin can set them for anyone under **Security > People**. VAULT asks for every ticked step,
in this order, and gives no session until the last one is right.

| Step | What it proves | Checked by |
|---|---|---|
| Password | Something you know | The server |
| Passkey (this computer, a security key, or a phone) | Something you have | Your device; the server checks its signature |
| Face check | Something you are | The webcam on this computer; the server compares the numbers |
| Key phrase | A phrase you know, in your voice | The microphone on this computer; the server compares the numbers |

Rules:
- Nothing ticked: a password or a passkey is enough.
- Passkey ticked without Password: a password alone no longer gets in.
- Password and Passkey both ticked: either one first, then the other.
- Face check and key phrase always come after, and can never be the only step.

The preview under the step cards shows exactly what the next sign-in will ask for, and how strong that mix is.
Press **Save sign-in steps**. A step that is not set up yet opens its setup instead.

**Test the chain:** tick Password, Face check and Key phrase, save, sign out, sign in with your password. The trail
shows three steps; each lights up only after the server accepted the one before. A wrong face or phrase three times
ends the attempt.

### Add a passkey
1. Security > How you sign in > **Set up each step > Passkey**. Pick where it lives:
   - **This computer:** Windows Hello. On a laptop without a face or fingerprint sensor, Windows Hello asks for its PIN. This laptop has only a normal webcam, so Windows Hello shows a PIN here.
   - **Security key:** a FIDO2 USB or NFC key such as a YubiKey. VAULT lists the steps: plug it in, press **Add a passkey**, choose Security key if the browser asks, set or type the key's PIN, touch it when it blinks. Old U2F-only keys cannot check a PIN and are refused.
   - **Phone:** scan the QR code with your phone and confirm there.
2. Name it and press **Add a passkey**, then follow the device's own prompt. Choosing the kind stops Chrome from
   offering to save the passkey to Google Password Manager instead.
3. If you signed in more than 15 minutes ago, VAULT asks you to confirm it is you first (password, passkey, or the
   demo button in Demo mode). This stops someone at an unlocked computer from adding their own passkey.
4. Add a second passkey (for example a spare key) before you tick **Passkey** as a step, so you cannot be locked out.
5. Test: sign out, type your username, press **Sign in with a passkey**.

### Set up the face check
1. Security > How you sign in > **Set up each step > Face check > Set up face check**. Allow the camera when the browser or app asks.
2. VAULT first checks the camera itself: at least 640×360, 12 frames a second, enough light, in focus, and your
   face big enough. A camera below that is refused with the reason (for example "The camera sends 320×240").
   Then look at the camera. Each box goes green only when its condition is met:
   - **Face found:** a face is close enough to the camera.
   - **Live person:** the liveness model sees a live person.
   - **Real, not a photo:** the anti-spoof model sees a real face rather than a photo or screen.

   The dots on your face are the points the model actually found. VAULT takes five readings, then saves them.
3. Tick **Face check** in the step cards and save.
4. Test, all three must work:
   - **Correct:** sign out, sign in with your password; VAULT shows the face check; look at the camera: you are in.
   - **Wrong person:** someone else's face is refused.
   - **Photo:** hold a photo of yourself up to the camera. It should be refused as "a photo or a screen". Anti-spoofing by webcam is not perfect, so report anything that gets through.
5. **How it works:** the open-source Human library (MIT) runs on this computer. It turns your face into 1,024
   numbers, and only those numbers are stored. No picture is sent or kept. **Delete my face data** removes them. The camera
   works in Chrome and Edge and in the VAULT app (allow it when asked). Some built-in preview panes block cameras.
6. **Honest limit:** the face check runs in the browser, so someone in control of that computer could feed it a
   recording. That is why it is a second step, never a way in on its own. For hardware-grade face unlock, use Windows
   Hello with an infrared camera, registered as a passkey.

### Set up the key phrase
1. Security > How you sign in > **Set up each step > Key phrase > Set up key phrase**. Allow the microphone.
2. Think of a phrase only you know, three to six words, not your password (for example a made-up line). Do not
   type it anywhere.
3. Press **Speak**, say the phrase, then pause: recording stops by itself. Do it three times the same way. The
   bars are the real microphone level.
4. Each take is checked: VAULT refuses a muted microphone, a distorted (too loud) one, under a second of speech,
   and a noisy room (under 12 dB above the noise), and says which.
5. Tick **Key phrase** in the step cards and save.
6. Test: sign in; at the key phrase step say the phrase (in). Say a different phrase (refused). Have someone else
   say your phrase (should be refused; report it if it passes).
7. **How it works:** the browser turns each take into speech features (13 numbers every 20 ms); the server lines
   them up with your saved takes by dynamic time warping. No recording is sent or kept. **Delete my key phrase**
   removes it. **Honest limit:** a recording of you saying the phrase would pass, so it is always an extra step.

### Hardware you could buy (optional)
These links are Amazon searches, not endorsements; check the seller is the maker.

| Device | Why | Search |
|---|---|---|
| YubiKey 5 NFC (USB-A) | The common FIDO2 security key, as the Passkey step. | [amazon.com/s?k=YubiKey+5+NFC](https://www.amazon.com/s?k=YubiKey+5+NFC) |
| YubiKey 5C NFC (USB-C) | Same, for USB-C laptops. | [amazon.com/s?k=YubiKey+5C+NFC](https://www.amazon.com/s?k=YubiKey+5C+NFC) |
| Any FIDO2 security key | Cheaper alternatives (Yubico Security Key, Google Titan, Feitian). | [amazon.com/s?k=FIDO2+security+key](https://www.amazon.com/s?k=FIDO2+security+key) |
| Windows Hello IR webcam | Adds real Windows Hello face unlock to a laptop without it (this one lacks it). | [amazon.com/s?k=Windows+Hello+IR+webcam](https://www.amazon.com/s?k=Windows+Hello+IR+webcam) |
| USB fingerprint reader for Windows Hello | Fingerprint passkeys on any PC. | [amazon.com/s?k=Windows+Hello+fingerprint+reader+USB](https://www.amazon.com/s?k=Windows+Hello+fingerprint+reader+USB) |

Buy two security keys if you will require one, so a lost key does not lock you out. You do not need any of this:
a password, the webcam face check and a phone passkey all work without new hardware.

## 5. Updates

The side rail shows the version. When GitHub has a newer release, a **Download** box appears; your documents and
settings stay when you install over the old version. Turn the check off with `VAULT_UPDATE_CHECK=false`.
