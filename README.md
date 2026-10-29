<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
    <img src="docs/assets/banner.svg" alt="VAULT: private document intelligence that runs on this machine. Two documents disagree about a valve's pressure rating and VAULT redlines the conflict." width="100%">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/F0rger123/vault-hackathon-2026/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/F0rger123/vault-hackathon-2026/ci.yml?branch=main&style=flat-square&label=CI&labelColor=0a0a0a&color=2f7d4f"></a>
  <img alt="Meta Llama on this machine" src="https://img.shields.io/badge/reads%20with-Meta%20Llama%203%20%C2%B7%20local-f5f5f5?style=flat-square&labelColor=0a0a0a">
  <img alt="Conflicts found" src="https://img.shields.io/badge/planted%20conflicts%20found-10%20of%2010-f0525f?style=flat-square&labelColor=0a0a0a">
  <img alt="Stack" src="https://img.shields.io/badge/stack-FastAPI%20%C2%B7%20SQLite%20FTS5%20%C2%B7%20Next.js-8c8c8c?style=flat-square&labelColor=0a0a0a">
  <img alt="Meta Global AI Developer Hackathon 2026" src="https://img.shields.io/badge/Meta%20Global%20AI%20Hackathon-2026%20%C2%B7%20Indie-f5f5f5?style=flat-square&labelColor=0a0a0a">
</p>

<h3 align="center">Point it at a drawer full of drawings, inspection reports and contracts.<br>It reads every page, proves every fact with a quote, and redlines the places where your documents disagree.<br>Nothing leaves the machine.</h3>

> [!TIP]
> **🤖 Pasted this link into Claude or ChatGPT?** To install or try VAULT, read [`docs/AI_GUIDE.md`](https://raw.githubusercontent.com/F0rger123/vault-hackathon-2026/main/docs/AI_GUIDE.md). To help the developer build it, read [`coordination/PROJECT_STATE.md`](https://raw.githubusercontent.com/F0rger123/vault-hackathon-2026/main/coordination/PROJECT_STATE.md) and [`docs/AI_ONBOARDING.md`](https://raw.githubusercontent.com/F0rger123/vault-hackathon-2026/main/docs/AI_ONBOARDING.md). Then read [`AGENTS.md`](https://raw.githubusercontent.com/F0rger123/vault-hackathon-2026/main/AGENTS.md) and [`llms.txt`](https://raw.githubusercontent.com/F0rger123/vault-hackathon-2026/main/llms.txt).

## The problem

A valve is drawn at **1500 psi** on six engineering drawings. Its inspection record says it was pressure-tested at **600 psi**. Both documents are "correct", both are filed, and nobody notices until something fails.

Engineering firms, manufacturers and public agencies sit on thousands of documents like these. The ones that matter most often can't be sent to a cloud AI at all, because they're export-controlled, confidential or simply not theirs to share. So people read them by hand, and it takes days.

## What VAULT does

| | | |
|---|---|---|
| **Reads everything** | PDFs, text, CSV spreadsheets and images. Each file is checked by what it really is, not its name, and the original is sealed read-only. Large folders import in the background. | 157 files, 0 failures |
| **Understands it with Meta Llama** | Llama 3 8B runs on the same computer through Ollama. It pulls out document type, project, dates, part numbers and pressure ratings. | 0.956 document-type accuracy on held-out files |
| **Proves every fact** | Each extracted value has to match a verbatim quote on a stored page. A quote that isn't really there is flagged, not trusted. | Every finding links to page and quote |
| **Catches disagreements** | Compares every document against every other and redlines conflicts: pressure ratings, quantities and materials that differ for the same part. | 10 of 10 planted rating conflicts, 0 false alarms, also on unseen data |
| **Knows its own speed** | Shows how many local models fit on your GPU, benchmarks real files before it promises a finish time, then compares each run with its estimate. | 157 documents in 12 min 55 s on a laptop GPU |
| **Answers questions** | Ask in plain English. Llama answers with numbered citations, and VAULT checks every number against the cited line. Ask for a folder layout the same way. | 8 of 8 layout requests right on held-out phrasing |
| **Learns from you** | The Training screen grades the reading against known answers, suggests rules from its mistakes, and re-tests on documents nobody corrected. Model weights never change. | Held-out document type 0.889 to 0.978 after one round (rules baseline) |
| **Never acts alone** | Reorganizing the archive is only ever a proposal. An administrator previews it as a folder tree, and approving it exports copies; originals never move. | Every action, allowed or refused, is in the audit log |

## See it

All data below is fictional, made by the project's own synthetic dataset generator. The interface follows your system's light or dark setting, and so do these images.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/run-dark.jpg">
    <img src="docs/screenshots/run-light.jpg" alt="Live run board: 150 documents read by Meta Llama 3 on this laptop in 8 minutes 56 seconds, through the coordinator, the security gate and the reviewer" width="100%">
  </picture>
  <br><sub><b>Live run board.</b> Every document moves from the coordinator through the security gate and a local Llama lane to the reviewer. The board only changes when an agent reports real work.</sub>
</p>

<table>
  <tr>
    <td width="50%" valign="top">
      <picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/investigate-dark.jpg"><img src="docs/screenshots/investigate-light.jpg" alt="Investigate: pressure-rating conflicts with verified quotes from drawings and inspection reports"></picture>
      <br><sub><b>Investigate.</b> Conflicts are drawn as redlines, and every quote is checked against the stored page text.</sub>
    </td>
    <td width="50%" valign="top">
      <picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/approvals-dark.jpg"><img src="docs/screenshots/approvals-light.jpg" alt="Approvals: a proposed folder layout previewed as a tree, waiting for an administrator"></picture>
      <br><sub><b>Approvals.</b> A new folder layout is previewed as a tree. Nothing is copied until an administrator says yes.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/security-dark.jpg"><img src="docs/screenshots/security-light.jpg" alt="Security: remote inference switched off, screening summary and audit log with denied requests"></picture>
      <br><sub><b>Security.</b> Remote models are off by default. Restricted files stay on local lanes, and denied requests are logged.</sub>
    </td>
    <td width="50%" valign="top">
      <picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/setup-dark.jpg"><img src="docs/screenshots/setup-light.jpg" alt="Set up a run: teach by example, check this machine, choose model lanes"></picture>
      <br><sub><b>Set up a run.</b> Teach it with a few labelled examples, measure the machine, pick the model lanes, start.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/training-dark.jpg"><img src="docs/screenshots/training-light.jpg" alt="Training: graded test against known answers, with held-out scores, suggested rules and a ready-for-real-documents check"></picture>
      <br><sub><b>Training.</b> Grade the reading, teach it with suggested rules, re-test on documents nobody corrected. Here Llama 3 scores 97.7% on held-out document types.</sub>
    </td>
    <td width="50%" valign="top">
      <picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/signin-dark.jpg"><img src="docs/screenshots/signin-light.jpg" alt="Sign in: one-click demo roles or a username and password; no API key needed"></picture>
      <br><sub><b>Sign in.</b> No API key or cloud account. Try the demo with one click, or sign in with your own account.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-dark.jpg"><img src="docs/screenshots/overview-light.jpg" alt="Overview: document counts, runs, privacy posture and latest findings"></picture>
      <br><sub><b>Overview.</b> What's in the vault, where its documents are allowed to go, and what the agents found.</sub>
    </td>
    <td width="50%" valign="top" align="center">
      <img src="docs/screenshots/phone-light.jpg" alt="The live run board on a phone" width="250">
      <br><sub><b>On a phone.</b> The same run board, stacked for a small screen.</sub>
    </td>
  </tr>
</table>

## How it works

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/how-it-works-dark.svg">
    <img src="docs/assets/how-it-works.svg" alt="Six stations: take in, measure, screen, read, verify, cross-check. Below them, the rules VAULT never breaks." width="100%">
  </picture>
</p>

Four agents share the work, and each one can be checked on the run board:

- **Coordinator** plans the run, sizes it to the machine and hands documents to model lanes from a shared queue, so faster lanes simply take more.
- **Security gate** reads every file before any model does. Export-controlled or personal files are pinned to local lanes, and text that tries to give an AI instructions is flagged for a person.
- **Model lanes** run Meta Llama 3 on this machine (or, only if an administrator allows it and the user confirms the job, the Meta Model API).
- **Reviewer** accepts each reading, escalates it, or sends it to a person, and records the findings.

## Results

Measured on 150 fictional files with 12 planted problems, scored against ground truth by `python -m evaluation.run_eval`. Held-out split of 45 files that were never used to write prompts:

| | Document type | Project | Part numbers | Pressure ratings | Conflicts found | False conflicts | Time for 150 files |
|---|---|---|---|---|---|---|---|
| **Meta Llama 3 8B, local** | **0.956** | **0.889** | **1.000** | 0.797 | **10 / 10** | **0** | 6.8 min |
| Rules baseline (not AI) | 0.889 | 0.800 | 1.000 | 0.847 | 10 / 10 | 0 | ~2 s |

The rules baseline is kept for comparison and offline tests and is labelled "not an AI model" wherever it appears. Every run, including the ones that got worse, is in [evaluation/results](evaluation/results/SUMMARY.md).

## Where it stands

| Working and tested | Written, not yet run | Next |
|---|---|---|
| One-command start · Demo and Real modes · Password and one-click demo sign-in · Local Meta Llama extraction · Parallel lanes with retries, cancel and resume · Rating, quantity and material conflicts with verified quotes · Plain-English questions with checked citations · Training: graded test, suggested rules, re-test · Approvals with copy-only export · Security tests, Semgrep, Trivy and ZAP in CI · 113 automated tests and 18 browser tests | Meta Model API (Muse Spark) lane, waiting for an API key · OCR for scanned pages | Final evaluation on frozen code (Nov 1) · Demo video (3 minutes) |

Plans in detail: [docs/MASTER_BLUEPRINT.md](docs/MASTER_BLUEPRINT.md) and [coordination/TASKS.md](coordination/TASKS.md).

## Run it

You need Python 3.11+ and Node 20+. For the real AI, also install [Ollama](https://ollama.com/download) and run `ollama pull llama3` once (about 4.7 GB). Without it, VAULT still runs, using the rules baseline, which is labelled "not AI".

**One command:**

```bash
.\start.ps1          # Windows
./start.sh           # macOS / Linux
```

It installs what is missing, checks for Ollama and Llama 3, builds the fictional demo archive, starts everything and opens http://localhost:3000. Click **Analyst** under "Try the demo". Use `--real` for your own documents, with password sign-in.

<details>
<summary><b>Step by step instead</b></summary>

```bash
python -m venv .venv && .venv/Scripts/pip install -e ".[dev]"   # macOS/Linux: .venv/bin/pip
.venv/Scripts/vault init --demo-users                           # demo sign-in tokens go to data/runtime/dev_tokens.json
.venv/Scripts/vault ingest data/synthetic/v1/files --collection demo
.venv/Scripts/vault process --collection demo --provider ollama # or --provider heuristic for the rules baseline
.venv/Scripts/vault findings --collection demo
.venv/Scripts/vault serve                                       # API on http://127.0.0.1:8000
```

```bash
cd frontend && npm install && npm run dev                       # interface on http://localhost:3000
.venv/Scripts/pytest                                            # run the checks
```

To rehearse the demo from a clean state, run `./scripts/demo_reset.sh` (or `.\scripts\demo_reset.ps1`). It rebuilds `data/demo/` in about 12 seconds; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#demo-environment-reset-and-rehearse).

</details>

Docker: `docker compose up --build` (binds to 127.0.0.1 only). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

<details>
<summary><b>Repository map</b></summary>

| Path | What is there |
|---|---|
| `backend/` | FastAPI service: ingestion, model providers, agents, workers, search, security, storage |
| `cli/` | The `vault` command-line tool |
| `frontend/` | Next.js interface (six sheets) |
| `generator/` | Deterministic fictional dataset generator |
| `data/synthetic/v1/` | 150 generated files and the ground-truth manifest |
| `evaluation/` | Scoring against ground truth, plus every result |
| `docs/` | Blueprint, architecture, security, threat model, model strategy, demo plan |
| `coordination/` | Task roadmap, ownership and API contract |

</details>

## Honest limits

VAULT checks permissions on the server, validates files by content, refuses path escapes, keeps originals read-only, treats document text as data rather than instructions, and logs every denial. It has **not** been independently audited and is not certified for regulated or classified use, so nobody should call it unhackable. Details: [docs/SECURITY.md](docs/SECURITY.md) and [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Built by

**Luke Knight**, for the Meta Global AI Developer Hackathon 2026 (Indie track).

## License

VAULT is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE). Meta Llama 3 is used under the Meta Llama 3 Community License; its weights are not included here. Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
