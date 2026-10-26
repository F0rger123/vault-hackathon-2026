# Model Strategy

## Principle

A Meta model performs VAULT's core intelligence step. It turns each document into a validated structured record (type, project, date, parts, pressure ratings, stamps), with quotes copied from the document as evidence. Deterministic code then checks those quotes and compares facts across documents.

## Meta landscape (researched 2026-10-26)

| Offering | Facts | Verification |
|---|---|---|
| **Meta Model API** | Base URL `https://api.meta.ai/v1`. Header `Authorization: Bearer $MODEL_API_KEY` (keys start `LLM_`). OpenAI-compatible Chat Completions, Responses and Messages. Structured output via `response_format: {type: "json_schema", json_schema: {name, schema, strict}}`. Limits: 10 nesting levels, 5,000 properties, no recursive schemas. | **Verified** at https://dev.meta.ai/docs/structured-output |
| Models | `muse-spark-1.3/1.2/1.1`, `muse-wonder-1.0` (preview), `*-contributor` variants, `muse-image-1.0`, `muse-voice-transcribe-1.0`, `sam-3.1` | `muse-spark-1.3` verified in the docs; the rest from the research report (dev.meta.ai/docs/models) |
| Inputs and context | Spark and Wonder accept text, image, video, audio and PDF, with a 1,048,576-token context | Research report; re-check before relying on PDF input |
| Pricing (per 1M tokens) | Spark $1.25 in / $4.25 out. Contributor $0.10 / $0.20. Wonder $4 / $20. | Research report (dev.meta.ai/docs/pricing-rate-limits) |
| Rate limits | Spark/Wonder 3,000 RPM / 4M TPM per team | Research report |
| **Contributor models** | Cheap, but Meta may use their inputs for training | **We do not use them**; this conflicts with VAULT's privacy promise |
| **Muse Glimmer 30B** | Open weights, Apache-2.0, text and image input, ~128K context. Ollama tag `muse-glimmer:30b` (~18 GB). Also on Fireworks and others. | Research report (dev.meta.ai/docs/muse-glimmer, HF, ollama.com). **Not tested by us.** |
| Muse Spark Open (816B MoE) | Muse Model License; needs hundreds of GB of VRAM | Not local-friendly |
| Llama 3 8B (`llama3:latest`) | Older Meta open-weight model, installed on the dev laptop | **Tested locally** |
| Hosted Llama API | Reportedly shut down on July 6, 2026 | News sources only; unverified |

## Providers in VAULT

| Name | Execution | Model (default) | Status |
|---|---|---|---|
| `ollama` | Local, localhost only (a non-local URL is refused) | `llama3:latest`; configurable to `muse-glimmer:30b` | **Working.** JSON-schema-constrained `format` |
| `meta_api` | Remote (Meta-hosted) | `muse-spark-1.3` | **Implemented, not yet called with a real key** |
| `heuristic` | In-process | `regex-rules-v1` | Working. Labelled `is_ai_model=false`. Baseline and test fixture only. |

Each provider reports its name, model, locality, `is_ai_model`, supported tasks, a privacy statement, and whether it is available. The API exposes this at `GET /system/providers`, and the UI shows it.

## Hardware fit (dev laptop: RTX 5070 Laptop 8 GB VRAM, 31 GB RAM, 32 logical cores)

- `llama3:latest` (4.7 GB) fits entirely in GPU memory.
- `muse-glimmer:30b` (~18 GB) does not fit in 8 GB of VRAM. Ollama would split it across the GPU and CPU/RAM. Expect it to be much slower. **Untested.** Downloading 18 GB needs Luke's approval.
- Without a GPU, Ollama falls back to the CPU, and the heuristic provider runs anywhere.

## Measured so far

| Model | Sample | Median ms/doc | p90 ms/doc | Quality notes |
|---|---|---|---|---|
| `llama3:latest` via Ollama | 3 docs | 7,718 | 37,992 (includes first-call model load) | Weak: classified a drawing as `parts_list` and missed its pressure ratings and date. Memo and revision history were classified correctly. |
| `llama3:latest`, full 150-doc collection | — | pending | pending | pending |
| `muse-spark-1.3` | — | pending | pending | pending (needs API key) |
| `muse-glimmer:30b` | — | pending | pending | pending (needs download approval) |

## Plan to improve quality (F04)

1. Add a compact per-field description and one short example to the system prompt.
2. Increase `num_ctx` only where documents need it. Most synthetic documents are a single page.
3. Run the 150-document evaluation for each model and compare it with the heuristic baseline on the held-out split.
4. For the demo, use the best Meta model we can get access to. If an API key is available, use `muse-spark-1.3` with remote inference explicitly enabled and disclosed. If not, use local Llama 3 or Glimmer.
5. Never present heuristic output as model output.

## Cost control

- Synthetic set: 150 documents, roughly 1–2K tokens each. One full Spark run is about 0.3M input tokens, roughly $0.40–$1.00 including output. This is an estimate, not a measurement.
- Cache by not reprocessing unchanged documents. Run the estimate on 3 documents before a full run.
- Paid usage needs Luke's approval. No Anthropic API is used inside VAULT.

## Privacy rules

- Remote inference is off by default. Turning it on needs both an admin toggle and `confirm_remote` on each job, and every remote call is audited.
- Error messages from providers never include document text.
- Models receive only text. They have no tools, no filesystem and no network access.
