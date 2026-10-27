"""Ask the five scripted demo questions (F06.4 acceptance) against a running VAULT API and save the answers.

    python scripts/demo_questions.py --data-dir data/runtime --collection 1 --provider ollama \
        --out evaluation/results/investigations-ollama.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import httpx

QUESTIONS = [
    "Which parts in Project Alpha have conflicting pressure ratings?",
    "What pressure ratings are recorded for BV-7891?",
    "Are any part numbers reused across different projects?",
    "Show inspection reports from Project Borealis",
    "Which documents mention gate valves?",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--collection", type=int, default=1)
    ap.add_argument("--provider", default="ollama")
    ap.add_argument("--out")
    args = ap.parse_args()

    token = json.loads((Path(args.data_dir) / "dev_tokens.json").read_text())["analyst"]
    client = httpx.Client(base_url=f"{args.base}/api/v1", headers={"Authorization": f"Bearer {token}"}, timeout=600)
    runs, ok = [], True
    for q in QUESTIONS:
        r = client.post(
            "/investigations", json={"collection_id": args.collection, "question": q, "provider": args.provider}
        )
        if r.status_code != 200:
            print(f"FAIL {r.status_code} {q}")
            ok = False
            continue
        b = r.json()
        cited = [s for s in b["answer"] if s["kind"] == "cited"]
        verified = sum(s["verified"] for s in cited)
        print(f"\nQ: {q}  ({b['duration_ms']} ms, {len(b['sources'])} sources, {verified}/{len(cited)} cited verified)")
        for s in b["answer"]:
            tag = "verified" if s["verified"] else ("interpretation" if s["kind"] == "interpretation" else "UNVERIFIED")
            print(f"  [{tag}] {s['text']}  {s['sources']}")
        ok = ok and bool(cited)
        runs.append(
            {
                "question": q,
                "duration_ms": b["duration_ms"],
                "answered_by": b["answered_by"],
                "plan": b["plan"],
                "answer": b["answer"],
                "source_count": len(b["sources"]),
            }
        )
    if args.out:
        Path(args.out).write_text(json.dumps(runs, indent=2) + "\n", encoding="utf-8", newline="\n")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
