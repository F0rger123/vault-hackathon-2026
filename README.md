<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
    <img src="docs/assets/banner.svg" alt="VAULT: private document intelligence that runs on this machine. Two documents disagree about a valve's pressure rating and VAULT redlines the conflict." width="100%">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/F0rger123/vault-hackathon-2026/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/F0rger123/vault-hackathon-2026/ci.yml?branch=main&style=flat-square&label=CI&labelColor=121921&color=2f7d4f"></a>
  <img alt="Meta Llama on this machine" src="https://img.shields.io/badge/reads%20with-Meta%20Llama%203%20%C2%B7%20local-d9a54a?style=flat-square&labelColor=121921">
  <img alt="Conflicts found" src="https://img.shields.io/badge/planted%20conflicts%20found-10%20of%2010-ff5a6a?style=flat-square&labelColor=121921">
  <img alt="Stack" src="https://img.shields.io/badge/stack-FastAPI%20%C2%B7%20SQLite%20FTS5%20%C2%B7%20Next.js-8e9bab?style=flat-square&labelColor=121921">
  <img alt="Meta Global AI Developer Hackathon 2026" src="https://img.shields.io/badge/Meta%20Global%20AI%20Hackathon-2026%20%C2%B7%20Indie-d9a54a?style=flat-square&labelColor=121921">
</p>

<h3 align="center">Point it at a drawer full of drawings, inspection reports and contracts.<br>It reads every page, proves every fact with a quote, and redlines the places where your documents disagree.<br>Nothing leaves the machine.</h3>

> [!TIP]
> **🤖 Pasted this link into Claude or ChatGPT?** Read [`AGENTS.md`](https://raw.githubusercontent.com/F0rger123/vault-hackathon-2026/main/AGENTS.md) and [`docs/AI_GUIDE.md`](https://raw.githubusercontent.com/F0rger123/vault-hackathon-2026/main/docs/AI_GUIDE.md) first, then [`llms.txt`](https://raw.githubusercontent.com/F0rger123/vault-hackathon-2026/main/llms.txt). They explain the project in plain words and walk a person through setting it up.

## The problem

A valve is drawn at **1500 psi** on six engineering drawings. Its inspection record says it was pressure-tested at **600 psi**. Both documents are "correct", both are filed, and nobody notices until something fails.

Engineering firms, manufacturers and public agencies sit on thousands of documents like these. The ones that matter most often can't be sent to a cloud AI at all, because they're export-controlled, confidential or simply not theirs to share. So people read them by hand, and it takes days.

## What VAULT does

| | | |
|---|---|---|
| **Reads everything** | PDFs, text, CSV spreadsheets and images. Each file is checked by what it really is, not its name, and the original is sealed read-only. | 157 files, 0 failures |
| **Understands it with Meta Llama** | Llama 3 8B runs on the same computer through Ollama. It pulls out document type, project, dates, part numbers and pressure ratings. | 0.956 document-type accuracy on held-out files |
| **Proves every fact** | Each extracted value has to match a verbatim quote on a stored page. A quote that isn't really there is flagged, not trusted. | Every finding links to page and quote |
| **Catches disagreements** | Compares every document against every other and redlines conflicts, like a drawing and an inspection report that rate the same part differently. | 10 of 10 planted conflicts, 0 false alarms |
| **Knows its own speed** | Benchmarks real files on your hardware before it promises a finish time, then runs parallel model lanes that retry and resume. | 157 documents in 12 min 55 s on a laptop GPU |
| **Never acts alone** | Reorganizing the archive is only ever a proposal. An administrator previews it as a folder tree, and approving it exports copies; originals never move. | Every action, allowed or refused, is in the audit log |

## See it

All data below is fictional, made by the project's own synthetic dataset generator. The interface follows your system's light or dark setting, and so do these images.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/run-dark.jpg">
    <img src="docs/screenshots/run-light.jpg" alt="Live run board: 157 documents flowed through the coordinator, the security gate, a local Meta Llama lane and the reviewer" width="100%">
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
| Ingestion, sealed originals, page text · Local Meta Llama extraction · Parallel lanes with retries, cancel and resume · Verified cross-document conflicts · Search with filters and page references · Corrections and versioned rules · Approvals with copy-only export · Security cases S1–S10 · Six-screen web interface · Coordinator, security and review agents (3,700-file run) | Meta Model API (Muse Spark) lane, waiting for an API key | Fresh dataset seed for the final figures · First Meta Model API run · Demo video (about 3 minutes) · Licence choice |

Plans in detail: [docs/MASTER_BLUEPRINT.md](docs/MASTER_BLUEPRINT.md) and [coordination/TASKS.md](coordination/TASKS.md).

## Run it

You need Python 3.11+ and Node 20+. For the real model, install [Ollama](https://ollama.com) and run `ollama pull llama3`.

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

No license has been chosen yet, so the code is public to read but all rights are reserved. Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
