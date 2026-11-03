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
| **Add files** | Uploads files or a folder, checks each file (type, size, active content), then reads them with the model you pick. | Drop the test set (section 3). Files VAULT refuses are listed with the reason. Press the read button. |
| **Progress** | What VAULT is doing right now: whether the server answers (checked every 3 s), whether a run is reading, how many documents still wait, and whether the model is loaded. A running run shows each agent's real events. Finished runs are listed as finished; nothing replays by itself. | Start a run and watch counts rise. Stop Ollama mid-run: lanes report errors. Pick an older run: it shows as finished, with a Replay button. |
| **Investigate** | Search, filters, and questions answered with numbered sources quoted from the stored pages. | Ask "Which parts have conflicting pressure ratings?". Every number in the answer must appear in a cited line. |
| **Chat (Ask VAULT, or press `/`)** | Turns typing into a search, a sort, a filter, a question, a page to open, or the model list. | "find contracts newest first", then "only 2024", then "sort by name"; "are my models downloaded?"; "open approvals". |
| **Training** | Grades how well VAULT reads against known answers (demo) or your corrections, then re-tests. | Run a grade; correct one document; re-test. |
| **Brain** | What VAULT learned for this collection, its open questions, and the 3D map. | Answer one question; it is used on the next run. |
| **Approvals** | Reorganizing or sharing files waits for an admin. Approving writes copies; originals never change. | Ask for a share pack; approve as admin; check the copies and that originals are untouched. |
| **Security** | Protection checklist, held files, sign-in security (section 4), people, the sign-in log and audit log. | Add a person, sign in as them, check the log. Try to delete a log row with a SQLite tool: it refuses. |
| **Models** | Which models are downloaded, which is in use, and downloads for more. | Download a small one (Llama 3.2 1B, 1.3 GB) and switch to it. |

**What VAULT does not do yet (so you are not surprised):**
- It does not read text inside pictures, or video or sound files. Pictures are stored and listed by name, marked "not read: picture". Video and audio files are refused.
- It reads only when you start a run. It does not watch folders.

## 3. The fictional test file set

Make 427 files (136 MB): PDFs, Word, Excel, PowerPoint, CSV, text, Markdown, JSON, photos, videos, sound files and
edge cases.

```powershell
.venv\Scripts\python scripts\make_test_files.py --out data\testset --count 400 --seed 7
```

- `data\testset\README.txt` explains the folders, and `manifest.json` lists every file with the result VAULT should give:
  - read;
  - stored but not read;
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

There are four levels. Each person picks theirs on **Security > How you sign in**, and an admin can require one for
anyone under **Security > People**.

| Level | Signing in needs | Strength |
|---|---|---|
| 1 | Password or passkey | Basic |
| 2 | Password or passkey, then a face check by webcam | Adds something you are |
| 3 | Passkey only | Phishing-proof |
| 4 | Passkey, then a face check | Strongest VAULT offers |

### Add a passkey (levels 3 and 4)
1. Security > How you sign in > **1. Passkeys**. Pick where it lives:
   - **This computer:** Windows Hello. On a laptop without a face or fingerprint sensor, Windows Hello asks for its PIN. This laptop has only a normal webcam, so Windows Hello shows a PIN here.
   - **Security key:** a USB or NFC key such as a YubiKey. Plug it in, touch it when it blinks.
   - **Phone:** scan the QR code with your phone and confirm there.
2. Name it and press **Add a passkey**, then follow the device's own prompt. Choosing the kind stops Chrome from
   offering to save the passkey to Google Password Manager instead.
3. If you signed in more than 15 minutes ago, VAULT asks you to confirm it is you first (password, passkey, or the
   demo button in Demo mode). This stops someone at an unlocked computer from adding their own passkey.
4. Add a second passkey (for example a spare key) before you tick **Require a passkey to sign in**, so you cannot be
   locked out.
5. Test: sign out, type your username, press **Sign in with a passkey**.

### Set up the face check (levels 2 and 4)
1. Security > **2. Face check by webcam > Set up face check**. Allow the camera when the browser or app asks.
2. Look at the camera. Each box goes green only when its condition is met:
   - **Face found:** a face is close enough to the camera.
   - **Live person:** the liveness model sees a live person.
   - **Real, not a photo:** the anti-spoof model sees a real face rather than a photo or screen.

   The dots on your face are the points the model actually found. VAULT takes five readings, then saves them.
3. Tick **Require the face check at every sign-in**.
4. Test, all three must work:
   - **Correct:** sign out, sign in with your password; VAULT shows the face check; look at the camera: you are in.
   - **Wrong person:** someone else's face is refused.
   - **Photo:** hold a photo of yourself up to the camera. It should be refused as "a photo or a screen". Anti-spoofing by webcam is not perfect, so report anything that gets through.
5. **How it works:** the open-source Human library (MIT) runs on this computer. It turns your face into 1,024
   numbers, and only those numbers are stored. No picture is sent or kept. **Delete my face data** removes them. The camera
   works in Chrome and Edge and in the VAULT app (allow it when asked). Some built-in preview panes block cameras.
6. **Honest limit:** the face check runs in the browser, so someone in control of that computer could feed it a
   recording. That is why it is a second step, never a way in on its own. For hardware-grade face unlock, use Windows
   Hello with an infrared camera, registered as a passkey (level 3 or 4).

### Hardware you could buy (optional)
These links are Amazon searches, not endorsements; check the seller is the maker.

| Device | Why | Search |
|---|---|---|
| YubiKey 5 NFC (USB-A) | The common security key. Works with level 3 or 4. | [amazon.com/s?k=YubiKey+5+NFC](https://www.amazon.com/s?k=YubiKey+5+NFC) |
| YubiKey 5C NFC (USB-C) | Same, for USB-C laptops. | [amazon.com/s?k=YubiKey+5C+NFC](https://www.amazon.com/s?k=YubiKey+5C+NFC) |
| Any FIDO2 security key | Cheaper alternatives (Yubico Security Key, Google Titan, Feitian). | [amazon.com/s?k=FIDO2+security+key](https://www.amazon.com/s?k=FIDO2+security+key) |
| Windows Hello IR webcam | Adds real Windows Hello face unlock to a laptop without it (this one lacks it). | [amazon.com/s?k=Windows+Hello+IR+webcam](https://www.amazon.com/s?k=Windows+Hello+IR+webcam) |
| USB fingerprint reader for Windows Hello | Fingerprint passkeys on any PC. | [amazon.com/s?k=Windows+Hello+fingerprint+reader+USB](https://www.amazon.com/s?k=Windows+Hello+fingerprint+reader+USB) |

Buy two security keys if you will require one, so a lost key does not lock you out. You do not need any of this:
a password, the webcam face check and a phone passkey all work without new hardware.

## 5. Updates

The side rail shows the version. When GitHub has a newer release, a **Download** box appears; your documents and
settings stay when you install over the old version. Turn the check off with `VAULT_UPDATE_CHECK=false`.
