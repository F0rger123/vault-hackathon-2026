# Blockers

Open items that need a human decision or action. When resolved, move the item to "Resolved" with the date and outcome, and update the affected tasks in `TASKS.md`.

## Open

| ID | Needs | Owner | Blocks | What to do |
|---|---|---|---|---|
| B1 | Verify official hackathon rules | Luke | F12.4, F12.5, F12.7, F12.8 | Log in to the Cerebral Valley participant portal and read the official rules and participant guide (https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details). Confirm: video length, public repo requirement, required Meta model usage, team rules for Indie track, AI coding assistant policy, licensing, "only work done during the event" rule, prohibited project categories (especially whether document chatbots/RAG wrappers are banned), judging criteria, submission form fields. Record findings in `docs/HACKATHON_COMPLIANCE.md`. |
| B2 | Meta Model API key and credits | Luke | F04.3, F04.7, F04.9 | Create an API key in the Meta Model API dashboard (key starts with `LLM_`, shown once). Confirm whether the $150 participant credit applies and how it is redeemed. Put the key only in your local `.env` as `VAULT_META_API_KEY`; never paste it in chat, issues or commits. Approve the first paid test call. |
| B3 | Project licence | Luke | F12.5 | Decide whether to add an open-source licence (for example MIT or Apache-2.0) or keep "all rights reserved", after B1 confirms any requirement. Record the decision in `DECISIONS.md` (D-009). |
| B4 | Partner credits (Baseten, Fireworks, Modal) | Luke | Optional providers | Confirm whether you received credits and how to redeem them. Public pages describe them as "for select participants" with no redemption steps. Do not add a paid provider until confirmed. |
| B5 | Muse Glimmer 30B download | Luke | F04.6, F04.7 (local path) | Approve or decline pulling `muse-glimmer:30b` through Ollama (~18 GB download; needs ~18–24 GB VRAM+RAM; your laptop has 8 GB VRAM + ~31 GB RAM, so it would run partly on CPU). |
| B6 | Franco onboarding | Franco | F10.x, F11.5, F09.7 | Clone the repo and follow `coordination/HANDOFF_FRANCO.md`. |

## Resolved

| ID | Date | Outcome |
|---|---|---|
| — | — | — |
