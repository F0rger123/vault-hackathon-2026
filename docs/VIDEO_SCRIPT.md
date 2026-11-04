# VAULT: the 3-minute video, word for word

What to say and what to show, in order. About 400 words of narration, which runs about 2:50 at a calm pace. The
click-by-click setup and the older version are in [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md).

**Before you record:** check the length limit and where to upload in the official rules (Cerebral Valley portal).
Use **Demo mode** only, never show a token or `.env`, and record each section as its own take. If Llama is slow,
trim the wait and put "sped up" on screen. Never fake a result. If a feature isn't merged when you record, cut
its lines (marked **[if merged]**).

The Indie track is judged on "creativity, technical ambition, and whether it works". Each section below hits at
least one of these.

---

### 0:00–0:18 · The hook

**Show:** black screen, then a fast scroll through a folder of drawings, inspection reports, contracts, site
photos and newspaper clippings (`data\testset-demo`).

> "Somewhere in this pile, a valve is rated for 1,500 psi on the drawing, and it was tested at 600. One of
> these is wrong. Finding it means reading thousands of pages by hand. And these files are confidential, so you
> can't just upload them to a chatbot."

### 0:18–0:40 · Opening the vault

**Show:** the sign-in screen. Type the password. The face check: the outline traces your face, the screen goes
dark, scan lines sweep, it asks you to turn your head. The vault door spins open into the app. **[if merged]**

> "This is VAULT. It runs entirely on this laptop. Every person picks their own locks: a password, a passkey or a
> hardware security key, a spoken phrase, and a face check that asks you to move, so a photo of my face won't
> open it. Nothing leaves the machine."

### 0:40–1:05 · Reading with Llama

**Show:** Add files: drop the folder; each file gets its own line (stored, refused, held). Then Progress: the
coordinator, the security gate, the Llama lanes filling in. Cut to the Brain for two seconds as files appear.

> "I drop in the archive. A security gate checks every file first; anything that could run code is held. Then
> Meta's Llama 3 reads the documents in parallel lanes, on this graphics card, and every fact it pulls out has
> to quote the exact line it came from."

### 1:05–1:50 · Ask Keeper (the main moment)

**Show:** Ask Keeper. Type *"Which parts have conflicting pressure ratings?"* and press Enter. The question
settles into the thread; on the right, the brain lights up as Finder and Conflict checker fly out to the real
documents at the same time and pull results back; the answer streams in; each citation gets a green tick.
Click a source: the blueprint opens on screen.

> "Now I just ask. Keeper is the main agent. It splits the job: one helper searches, another checks for
> conflicts, at the same time, and you can watch them move through the brain to the actual documents. Llama
> writes the answer, and a fact checker confirms every number really appears in a cited line. Here it is:
> BV-7891, 1,500 psi on the drawing, tested at 600. Both quotes, side by side, verified."

**Then (5 s):** type *"longest videos first"* or *"photos from 2024"*: sorted media cards appear.

> "Photos, videos and audio are sorted by date, length and camera too."

### 1:50–2:15 · It learns

**Show:** thumbs-up on the answer, the header "Keeper has learned from N answers". **[if merged]** Then the
Brain: answer one of its questions, *"What does PV stand for?"*, *"Pressure valve."* Then Training: the
held-out score.

> "The more you use it, the more it learns your organization. It asks when it doesn't know something, like what
> PV means, and remembers the answer for this project only. And we measure that on documents nobody corrected,
> so it's real improvement, not memorization."

### 2:15–2:35 · Nothing changes without a human

**Show:** Approvals, full screen. Switch to View only and open a file. Then approve one request: the copies
appear with ticks, and as new green nodes in the brain.

> "VAULT never edits your originals. It proposes copies, and a person approves them. Anyone can browse the
> proposals in view-only mode. Inviting a colleague is a five-step wizard with exactly the permissions you pick."

### 2:35–2:50 · We tried to break it

**Show:** the terminal running `python scripts/attack_demo.py`: each attack refused, all green. Then 2 seconds on
the GitHub Actions page with the scanners green.

> "We attack it ourselves: stolen tokens, path tricks, zip bombs, hidden instructions inside documents. Every one
> is refused, and scanners run on every change. We don't claim it's unhackable. We test it."

### 2:50–3:00 · Close

**Show:** the results slide: held-out, Llama 3 8B found 10 of 10 planted conflicts, 0 false alarms, on one
laptop. Then the logo.

> "Ten out of ten conflicts found, zero false alarms, on one laptop. VAULT: your documents, your hardware,
> answers you can check."

---

## Words to avoid

- "Unhackable", "military grade", "certified", "ready for classified data".
- "The AI understands the photos": it sorts photos and videos by name, date and details, not by what is in them.
- "Facial recognition that can't be fooled": say "it asks you to move, so a photo won't open it".
