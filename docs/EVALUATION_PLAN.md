# Evaluation Plan

## What we measure

The harness is `evaluation/run_eval.py`. It reads the latest extraction for each document produced by one provider and scores it against `data/synthetic/v1/manifest.json`. Scores are reported separately for the train and held-out splits.

| Metric | Definition |
|---|---|
| `doc_type` | Exact match of the document type |
| `project` | Case-insensitive project match |
| `doc_date` | Exact ISO date match. Only documents whose ground truth has a date are scored. |
| `part_recall` | Share of ground-truth part numbers the extraction found |
| `rating_accuracy` | Of the parts found, the share whose psi value is exactly right |
| `evidence_verified_docs` | Share of documents where every evidence quote was verified, or where no quotes were given |
| Conflict recall / precision | Planted `rating_conflict` part numbers compared with findings for the collection |
| Timing | Median and p90 ms per document; job wall time |

Run it:

```bash
vault process --collection demo --provider <name>
python -m evaluation.run_eval --collection demo --provider <name> --out evaluation/results
```

## Results to date

All numbers below were measured on 2026-10-26 on the dev laptop.

### Heuristic baseline (not an AI model), 150 documents

| Split | doc_type | project | doc_date | part_recall | rating_accuracy | evidence_verified_docs |
|---|---|---|---|---|---|---|
| train | 0.914 | 0.848 | 1.000 | 1.000 | 0.849 | 1.000 |
| heldout | 0.889 | 0.800 | 1.000 | 1.000 | 0.847 | 1.000 |

- Conflicts: 10 planted, 10 found. Recall 1.0, precision 1.0.
- The baseline does well because the synthetic text is regular.
- It misses alternate layouts. "Field Verification Record" is classified as `other`, and the project after "Programme" is missed.
- It does not extract a project for stamp images.

### Meta models

| Model | Status | Notes |
|---|---|---|
| `llama3:latest` (Ollama, local), 3-document sample | Measured | Median 7,718 ms/doc; p90 37,992 ms/doc (includes model load). Quality on the sample was weak: one drawing misclassified, ratings and date missed. |
| `llama3:latest`, full 150 documents | **pending** | Run in progress |
| `muse-spark-1.3` (Meta Model API) | **pending** | Needs a key and Luke's approval to spend |
| `muse-glimmer:30b` (Ollama, local) | **pending** | Needs an 18 GB download and Luke's approval |

## Teach-by-example evaluation (F07)

1. Process the collection and score the held-out split.
2. Apply corrections drawn only from **train** documents. Example: on one train "Field Verification Record", set `doc_type = inspection_report` with `when_contains = "Field Verification Record"`.
3. Reprocess, then re-score the held-out split.
4. Report the before and after numbers. Improvement here comes from versioned rules, not from changing model weights.

The integration test `test_correction_creates_versioned_policy` already shows that one correction flips the alternate layout to `inspection_report` under policy version 2. The held-out metric comparison has not been run yet.

## Reporting rules

- Commit result JSON files to `evaluation/results/` together with the provider, model, date and commit hash.
- Never quote a number that is not in a committed result file or in this document.
- Report the heuristic baseline and model results side by side, each clearly labelled.
