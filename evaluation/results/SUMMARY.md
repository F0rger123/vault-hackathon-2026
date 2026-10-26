# Evaluation results

All runs: synthetic dataset v1 (seed 2026, 150 fictional files, 12 planted anomalies), scored with
`python -m evaluation.run_eval`. Machine: Windows 11 laptop, RTX 5070 Laptop GPU (8 GB), 31 GB RAM.
Local model: `llama3:latest` (Meta Llama 3 8B) served by Ollama 0.32.1, 2 workers. Raw JSON files are in this folder.

Held-out split (45 documents, never used to write prompts or rules):

| Run (2026-10-26) | doc_type | project | doc_date | part recall | rating accuracy | conflicts found (of 10) | false conflicts | wall time, 150 docs |
|---|---|---|---|---|---|---|---|---|
| Heuristic baseline (not an AI model) | 0.889 | 0.800 | 1.000 | 1.000 | 0.847 | 10 | 0 | ~2 s |
| Llama 3 8B, prompt v1 | 0.822 | 0.533 | 0.222 | 0.669 | 0.291 | 8 | 0 | 10.9 min |
| Llama 3 8B, prompt v2 (doc-type definitions) | 0.956 | 0.000 | 0.000 | 1.000 | 0.669 | 6 | 0 | 6.9 min |
| Llama 3 8B, prompt v3 (field-filling guidance) | **0.956** | **0.889** | 0.917 | **1.000** | 0.797 | **10** | **0** | 6.8 min |

Train split (105 documents), prompt v3: doc_type 0.981, project 0.905, doc_date 0.921, part recall 1.000,
rating accuracy 0.817.

Notes:

- Prompt changes are prompt engineering, not training. No model weights were changed.
- v2 improved classification but the model started leaving `project` and `doc_date` null; v3 fixed that with
  explicit field-order guidance. Both regressions and fixes are kept here on purpose.
- The heuristic's `doc_date` score only covers documents whose ground truth has a date; it cannot read the
  alternate inspection layout's written-out dates, which ground truth records as undated.
- The prompt was tuned while looking at aggregate train and held-out scores, so held-out numbers are slightly
  optimistic. A fresh dataset seed should be used for the final reported figures (task F11.4).
- Rating accuracy below 1.0 is mostly drawings where the model attaches one rating to several parts.
