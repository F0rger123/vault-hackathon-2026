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

## Corrections experiment (F07.3, 2026-10-28)

Question: do corrections a reviewer makes on some documents improve accuracy on documents nobody corrected?
Run with `python -m evaluation.corrections_experiment --provider <p> --out evaluation/results`. A simulated
reviewer looks only at the 105 train documents, and for each one with a wrong `doc_type` or `project` picks a
line of that document's own text as a `when_contains` rule, through the real corrections API. A phrase is
accepted only if no train document containing it has a different true value. The collection is then
reprocessed and scored. Held-out ground truth is read only for the final scores. No model weights change.

| Provider | Train docs wrong before (type / project) | Rules created | Held-out doc_type before → after | Held-out project before → after |
|---|---|---|---|---|
| Heuristic (not AI) | 9 / 16 | 5 | 0.889 → **0.978** | 0.800 → 0.822 |
| Llama 3 8B, prompt v3 | 2 / 10 | 0 | 0.978 → 0.978 | 0.889 → 0.889 |

Files: `corrections-heuristic-20261028-011548.json`, `corrections-ollama-20261028-013024.json`.

What this shows, and what it does not:

- For the rule-based extractor, one rule ("Witness" means inspection report) fixed 6 train documents and
  lifted held-out document-type accuracy by 4 documents. That is real generalisation to unseen files.
- The other four heuristic rules tie an inspector's name to a project. They work here only because each
  fictional inspector belongs to one project; on real archives that would be a weak rule. The held-out project
  gain is one document.
- For Llama 3, no candidate phrase passed the safety test (every phrase in the wrong documents also appears in
  documents with a different true value, or contains digits), so no rule was created and nothing changed.
  The model's remaining errors are not the kind a single text rule can fix.
- Both Llama 3 passes completed 150/150 documents (443 s and 431 s, 2 workers).

## Quantity and material conflicts on dataset v2 (F06.5, 2026-10-28)

Files are in `evaluation/results/v2/`. Dataset v2 has 165 files: 10 rating, 5 quantity and 5 material conflicts planted.

| Run | Rating conflicts | Material conflicts | Quantity conflicts | Held-out rating accuracy |
|---|---|---|---|---|
| Rules baseline (not AI), `heuristic-20261028-163219.json` | 10 / 10, precision 1.0 | 5 / 5, precision 1.0 | 5 / 5, precision 1.0 | 0.855 |
| Llama 3 8B, prompt v3 (committed), `ollama-20261028-163636.json` | 10 / 10, precision 1.0 | 5 / 5, precision 1.0 | **0 / 5** | 0.823 |
| Llama 3 8B, prompt v3 plus one sentence asking for material and quantity, `ollama-20261028-164442.json` | **0 / 10** (1 false) | 5 / 5 | 5 / 5 | **0.097** |

- **Why Llama misses quantities:** with the committed prompt, Llama reads materials but leaves contract quantities empty. The prompt never asks for them.
- **Why the extra sentence was reverted:** asking for quantity fixed quantities but broke pressure ratings. The model began putting the wrong numbers in the psi field. Pressure conflicts are the core demo, so the extra sentence is not committed.
- **Next step:** the quantity fix for Llama needs its own prompt work and a full re-evaluation (F04.5 or F11.4), not a one-line change.
- **Part recall is 0.954 for every provider:** the 5 scanned pages have no text until OCR exists (F02.6).

## Fresh-seed practice run (F11.4 dry run, 2026-10-28)

Files are in `evaluation/results/fresh-seed-2027/`. The dataset was generated with `--seed 2027 --dataset-version 2`: 165 files that no prompt was ever tuned on. It is not committed, and the same command recreates it. Code was `main` plus F06.5. This is a rehearsal: the final F11.4 run happens on frozen code on Nov 1.

| Held-out | Doc type | Project | Date | Rating accuracy | Rating conflicts | Material | Quantity | Time |
|---|---|---|---|---|---|---|---|---|
| Llama 3 8B, local | **0.918** | **0.857** | 0.881 | 0.827 | **10/10**, precision 1.0 | 5/5 | 0/5 | 533 s |
| Rules baseline (not AI) | 0.898 | 0.816 | 0.952 | 0.836 | 10/10, precision 1.0 | 5/5 | 5/5 | 2 s |

- **On unseen data:** Llama 3 still beats the rules baseline on document type and project, and finds every planted pressure conflict with no false alarms.
- **Quantities:** Llama still misses quantity conflicts (see F06.5).

## Plain-language layout requests (F08.4, 2026-10-28)

`layout-requests-ollama-2026-10-28.json`, Llama 3 8B (`llama3:latest`) through Ollama, temperature 0.

| Split | Correct |
|---|---|
| Tuning requests (8) | 8 / 8 |
| Held-out requests (8), written after the prompt was final | 8 / 8 |

- **How the prompt got here:** the first prompt got only 2 of the first 5 requests right. The model added fields nobody asked for, and never answered "unsupported" (for example, "by department" became `{project}/{year}/{doc_type}`). The final prompt adds three rules and three short examples.
- **Safety held throughout:** the model only ever picked patterns from the allowed list. A request containing `../../Windows/System32` produced `unsupported`. Any answer outside the list is rejected in code anyway.
- **Scope of these numbers:** they come from 16 hand-written requests, not a benchmark.

