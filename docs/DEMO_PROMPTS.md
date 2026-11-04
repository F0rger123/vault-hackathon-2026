# Demo prompts for Ask Keeper

Every prompt here was sent to Keeper on the demo collection (*Halvern Engineering Archive*, 150 fictional
documents) and returned a sourced answer or a filled list (F10.25, 2026-11-04). The same prompts are the clickable
chips on the empty Ask Keeper screen, in the same four groups. Prompts marked * name demo parts or projects, so the
chips show them only in demo collections.

**Dataset:** the demo collection, or the **Quick Demo Dataset** (Overview > Download Demo Dataset), which is the
same 150 files.

**Time:** answers that Llama writes take about 16 to 20 seconds on Luke's laptop (RTX 5070, `llama3:latest`;
measured 16.5 s and 19.9 s for the first prompt). The first answer after a restart can take longer while the model
loads. Lists, sorts and the rules-only answers come back in under a second.

## The five for the recording

1. **Which parts have conflicting pressure ratings? Show the exact values and cite the original documents.**
   Names BV-7891 (600 vs 1500 psi), FL-5958, FL-8650 (150 vs 2500) and FL-9004, with numbered sources; the fact
   checker verifies each cited sentence. Llama writes it. *The main demo.*
2. **What pressure rating does BV-7891 have?** * Conflicting: 600 psi on inspection report `ALP-INS-0001.pdf`,
   1500 psi on the drawings; 6 sources.
3. **Which test reports disagree with the drawings? Cite the documents.** The same 4 conflicts with 12 sources.
4. **Which documents contain hidden instructions?** The 2 planted prompt-injection memos (`ALP-MEM-04.txt`,
   `COB-MEM-04.txt`), quoted, so you can say VAULT treats document text as data, not commands.
5. **Find drawings for Project Alpha, newest first** * 8 drawings sorted by date: shows search and sorting.

## All working prompts

| Group | Prompt | What comes back |
|---|---|---|
| Engineering and conflicts | Which parts have conflicting pressure ratings? Show the exact values and cite the original documents. | 4 conflicts incl. BV-7891 600 vs 1500 psi; 16 sources; sentences verified |
| Engineering and conflicts | Which test reports disagree with the drawings? Cite the documents. | The 4 conflicts; 12 sources |
| Engineering and conflicts | Which components need further review based on conflicting documentation? | The 4 conflicts; 16 sources |
| Engineering and conflicts | What pressure rating does BV-7891 have? * | 600 vs 1500 psi; 6 sources |
| Documents and research | Find BV-7891 * | 7 documents |
| Documents and research | Which documents mention FL-8650? * | The FL-8650 conflict; 3 sources |
| Documents and research | Find inspection reports for Project Borealis, newest first * | 6 reports, sorted |
| Documents and research | Find contracts, newest first | 15 contracts, sorted |
| File organization | Find drawings for Project Alpha, newest first * | 8 drawings, sorted |
| File organization | Show the photos, newest first | 15 photos |
| File organization | Sort the documents by name | 150 documents A to Z (first 50 shown) |
| File organization | Sort the drawings by date, oldest first | 40 drawings |
| Security and privacy | Which documents contain hidden instructions? | The 2 injection memos, quoted |
| Security and privacy | Which memos look like they try to instruct an AI? | The same 2 memos, quoted |

## Not shown as chips, and why

These were tested and did not give a correct, sourced answer on the demo data, so they are not offered:

- "Summarize the important findings in this collection", "Find duplicate files": returned the injection memos.
- "Which documents reference the same equipment?", "What information is missing from these reports?", "Which
  files might contain confidential information?": no evidence found.
- "Find contracts containing payment terms", "Find documents containing financial information", "Suggest a safer
  organization for sensitive documents": no matches in the demo data.
- "Show me the longest videos first", "Find photos taken in 2024": the demo collection has no videos and no 2024
  photos. They work on the Complete Demo Dataset or `data\testset-demo` after you add it in Real mode.
- "Group files by type and creation date": there is no grouping feature.
- Classification: after classify-and-redact (F09.23), "mark the pricing contracts as confidential" creates an
  approval request, but the demo contracts contain almost nothing to redact, so it is not a recording prompt.
