# Dataset Strategy

## Goals

- **Fictional data only.** Every company, person, project and part number is invented.
- **Reproducible.** The same seed produces byte-identical files on Windows and Linux. CI checks this.
- **Known ground truth.** Each file's type, project, date, components, anomalies and split are recorded.
- **Designed to separate models from keyword rules.** Alternate layouts use different vocabulary and date formats.

## Generator

Run:

```bash
python -m generator.generate --out data/synthetic/v1 --seed 2026
```

- Source: `generator/generate.py`
- Libraries: ReportLab draws the PDFs; Pillow draws the PNG stamps; CSV, Markdown and text files are written directly.
- Line endings: text output is always written with `\n`. `.gitattributes` keeps the repository copy LF and stores binaries unchanged.

## Contents of v1 (seed 2026)

| Type | Count | Format | Layout variation |
|---|---|---|---|
| Engineering drawings | 40 | PDF (landscape) | Schematic with valve, exchanger and flange symbols, a title block and a parts list. Title block sits bottom or top. |
| Inspection reports | 40 | PDF | "INSPECTION REPORT" (standard), or "Field Verification Record" (alternate: "Programme" instead of "Project", date written out in words) |
| Contracts | 15 | PDF | Supply agreements with numbered obligations and part schedules |
| Parts lists | 10 | CSV | BOM rows with a rating column |
| Revision histories | 10 | Markdown | Rev A/B/C entries |
| Project memos | 20 | TXT | Two contain a prompt-injection paragraph |
| Approval stamps | 15 | PNG | APPROVED, QA ACCEPTED or REJECTED; rotated |
| **Total** | **150** | | ~0.8 MB |

There are five projects: Alpha, Borealis, Cobalt, Driftwood and Ember. Each has 10 parts drawn from six kinds (PV, BV, FL, PS, HX, RV), with standard pressure classes from 150 to 2500 psi.

## Planted anomalies (ground truth in `manifest.json`)

- **10 rating conflicts**, two per project. In each, an inspection record states a test pressure that differs from the part's rating on drawings, contracts and parts lists. The manifest lists every document involved.
- **2 prompt-injection memos** (Alpha and Cobalt). They instruct "automated systems" to delete files, send documents to an external address, and report no discrepancies. VAULT must flag these and take no action.

## Splits

The split is deterministic: after sorting by type and filename, every 10th-position index of 2, 5 or 8 is held out. That gives 105 train and 45 held-out documents. Use the held-out split to measure the effect of corrections and rules (F07) without tuning on it.

## Manifest schema

```json
{
  "generator": "vault-synthetic-v1",
  "seed": 2026,
  "fictional": true,
  "documents": [
    {
      "filename": "...",
      "doc_type": "...",
      "project": "...",
      "doc_date": "YYYY-MM-DD | null",
      "components": [{"part_number": "...", "pressure_rating_psi": 0}],
      "anomalies": ["rating_conflict:PV-5595"],
      "layout": "standard | alternate | image",
      "split": "train | heldout"
    }
  ],
  "anomalies": [
    {
      "kind": "rating_conflict | injection",
      "project": "...",
      "part_number": "...",
      "values_psi": [],
      "documents": []
    }
  ]
}
```

Alternate-layout inspections have a `doc_date` of null in the ground truth, because their date is written out in words. They are excluded from date-accuracy scoring.

## Contents of v2 (seed 2026, `--dataset-version 2`)

`data/synthetic/v2/` holds every v1 file, byte for byte, plus 15 new files: 3 per project, made with their own random generator so v1 never changes.

| New file | Planted problem | Ground truth |
|---|---|---|
| `{code}-CTR-004.pdf` | A supply agreement orders a different quantity of a part than the parts lists, drawings and other contracts | `quantity_conflict`, 5 planted |
| `{code}-BOM-03.csv` | A parts list gives a part a different material than every other document | `material_conflict`, 5 planted |
| `{code}-SCN-0001.pdf` | A scanned inspection report: the page is one image with no text layer, so it needs OCR (F02.6) | `layout: "scanned"` |

The CI determinism check for v2 skips the scanned PDFs, for the same reason it skips the PNG stamps: their pixels depend on the Pillow/FreeType build.

## Expansion policy

- Grow the dataset only when an evaluation question needs it. Examples: more layouts, scanned or noisy pages, multi-page contracts, material or quantity conflicts.
- Bump the version (`v2`) rather than mutating `v1`, so earlier results stay reproducible.
- Keep the full set processable in one sitting on the dev laptop, so model credits are not wasted.
