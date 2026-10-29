# AI Guide: walking someone through VAULT

This guide is for an AI assistant (Claude, ChatGPT, or similar) that has been given this repository link by a person who wants to understand, install or try VAULT. If the person is Luke, VAULT's developer, and wants to know what to build next, use [`docs/AI_ONBOARDING.md`](AI_ONBOARDING.md) instead. Speak plainly, one step at a time, and check each step worked before moving on. Assume the person may not be a programmer.

## 1. What VAULT is, in plain words

VAULT helps an organisation make sense of a big pile of documents: engineering drawings, inspection reports, contracts, parts lists, memos and scanned images. It runs on the organisation's own computer, so the documents stay there.

What it does:

- Takes in a folder of files and keeps a safe, read-only copy of each one.
- Reads the files and uses a Meta AI model to work out what each document is, which project it belongs to, its date, and which parts and pressure ratings it mentions.
- Spots problems across documents, for example a valve listed as 1500 psi on a drawing but tested at 600 psi in an inspection report, and shows the exact lines from both files as proof.
- Lets people search everything, with page references.
- Suggests how to organise files into folders, but only copies them after an administrator approves. The originals are never changed.
- Records every action, including blocked ones, in an audit log.

It is a hackathon project (Meta Global AI Developer Hackathon 2026). It is not certified for classified or regulated data. The sample documents included are entirely made up.

## 2. Questions to ask the person first

Ask these before giving setup steps, and adapt to the answers:

1. What do you want to do: just understand what VAULT is, try the demo on your computer, or work on the code?
2. Are you on Windows, macOS or Linux?
3. Do you already have Git, Python 3.11 or newer, and Node.js 20 or newer installed? (If unsure, help them check: `git --version`, `python --version` or `python3 --version`, `node --version`.)
4. Do you want to try a real AI model locally? That needs Ollama and a few GB of download, plus a reasonably powerful computer. Without it, VAULT can still run with its simple built-in rules (clearly labelled as not AI).
5. Do you have Docker installed and prefer to use it? (Optional.)

If they only want to understand the project, summarise section 1, point them to `README.md` and `docs/MASTER_BLUEPRINT.md`, and stop.

## 3. Setup

Work through these in order. After each block, ask the person what they saw.

**Get the code**

```bash
git clone https://github.com/F0rger123/vault-hackathon-2026.git
cd vault-hackathon-2026
```

**Install the backend** (pick one)

With uv (fast, recommended if installed):

```bash
uv venv --python 3.11 .venv
uv pip install -e ".[dev]"
```

With plain Python:

```bash
python -m venv .venv
```

Then activate it. Windows PowerShell: `.venv\Scripts\Activate.ps1`. Windows Command Prompt: `.venv\Scripts\activate`. macOS/Linux: `source .venv/bin/activate`. Then:

```bash
pip install -e ".[dev]"
```

**Load the sample documents**

```bash
vault init --demo-users
vault ingest data/synthetic/v1/files --collection demo
vault process --collection demo --provider heuristic
vault findings --collection demo
```

**Check it worked:** the ingest step should say `150 added`. The process step should end with `[completed] 150/150 done, 0 failed`. The findings step should list 10 lines starting with `[verified]`, each describing a part with conflicting pressure ratings.

**Start the server and the web interface**

Terminal 1:

```bash
vault serve
```

Check: opening http://127.0.0.1:8000/api/v1/health in a browser shows `{"status":"ok",...}`.

Terminal 2:

```bash
cd frontend
npm install
npm run dev
```

Check: http://localhost:3000 shows a sign-in box. The sign-in tokens are in the file `data/runtime/dev_tokens.json`. Tell the person to open that file themselves and copy the `analyst` value into the box. **Do not ask them to paste the token to you, and do not print it.** After signing in they should see 150 documents and 10 findings.

**Optional: a real Meta model on their own computer**

1. Install Ollama from https://ollama.com.
2. Ask before downloading, because it is several GB: `ollama pull llama3`
3. Run `vault providers`. The `ollama` line should say `ready`.
4. Run `vault estimate --collection demo --provider ollama --sample 3` to measure how long the whole collection would take on their machine. Explain the low/high estimate.
5. Only if they agree to the time: `vault process --collection demo --provider ollama`.

**Optional: Docker**

```bash
docker compose up --build
```

Then open http://localhost:3000. Docker setup is less tested than the steps above; if it fails, fall back to the manual steps.

## 4. How to use it

- **Search:** `vault search "PV-5595"` or the search box in the web interface. Results show the file and page.
- **Findings:** `vault findings --collection demo`, or the Findings panel on the dashboard. Each finding lists the quoted lines from every document involved.
- **Hardware check:** `vault hardware` shows what the computer has (processor, memory, graphics card).
- **Roles:** the `viewer` token can only look; `analyst` can upload, process and propose; `admin` can also approve, change settings and read the audit log. Trying something your role cannot do is blocked and recorded.
- **Organising files:** an analyst creates a proposal; an admin approves it; VAULT copies files into `data/runtime/exports/`. Originals are untouched.

## 5. What you must never do

- **Never print, repeat or ask for secrets:** tokens in `data/runtime/dev_tokens.json`, anything in `.env`, API keys (they start with `LLM_`), or GitHub credentials. If the person pastes one, tell them to treat it as exposed and create a new one.
- **Never spend money without a clear yes:** do not set up the Meta Model API key, paid partner services, or cloud hosting unless the person explicitly asks and understands the cost.
- **Never enable remote inference without a clear yes:** turning on `VAULT_ALLOW_REMOTE_INFERENCE` sends document text off their computer. Explain that first and only proceed if they agree.
- **Never touch production systems or real data without a yes:** use the included fictional documents. Do not point VAULT at someone's real company files unless they explicitly decide to, and remind them it is a hackathon prototype.
- **Never run destructive commands** (deleting folders, resetting Git history, force-pushing) on the person's machine without explaining and getting agreement.
- **Never claim** VAULT is secure enough for classified, medical or regulated data, or that it is unhackable.
- **Never make up results.** If a command fails, show the error message and help troubleshoot.

## 6. Common problems

- `vault: command not found`: the virtual environment is not active. Activate it (section 3) or run `.venv/Scripts/vault` (Windows) or `.venv/bin/vault` (macOS/Linux).
- Python version error: install Python 3.11 or newer.
- Web page says it cannot reach the API: make sure `vault serve` is still running in the first terminal.
- `ollama ... unavailable: Ollama server not reachable`: start the Ollama app. `model ... not pulled`: run `ollama pull llama3` (ask first).
- `meta_api ... unavailable`: expected unless an administrator set up a Meta Model API key and enabled remote inference.

## 7. Where to read more

- `README.md`: overview and screenshots.
- `docs/MASTER_BLUEPRINT.md`: full design.
- `docs/SECURITY.md` and `docs/THREAT_MODEL.md`: security approach and test results.
- `coordination/TASKS.md`: what is finished and what is planned.
