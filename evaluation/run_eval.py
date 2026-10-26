"""Score stored extractions against the synthetic ground truth.

Reads the latest extraction per document for one provider from the VAULT database and compares
it with data/synthetic/<version>/manifest.json. Metrics are reported per split (train / heldout).

Usage: python -m evaluation.run_eval --collection demo --provider heuristic [--out evaluation/results]
"""

import argparse
import json
import time
from collections import defaultdict
from pathlib import Path

from backend.core.config import get_settings
from backend.storage.db import connect


def score(conn, collection: str, provider: str, manifest: dict) -> dict:
    truth = {d["filename"]: d for d in manifest["documents"]}
    rows = conn.execute(
        """SELECT d.filename, e.* FROM extractions e JOIN documents d ON d.id = e.document_id
           JOIN collections c ON c.id = d.collection_id
           WHERE c.name = ? AND e.provider = ? AND e.id IN
             (SELECT MAX(id) FROM extractions WHERE provider = ? GROUP BY document_id)""",
        (collection, provider, provider),
    ).fetchall()
    stats: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    model = None
    for r in rows:
        t = truth.get(r["filename"])
        if not t:
            continue
        model = r["model"]
        s = stats[t["split"]]
        data = json.loads(r["data"])

        def tally(metric: str, ok: bool, s=s) -> None:
            s[metric][0] += int(ok)
            s[metric][1] += 1

        tally("doc_type", r["doc_type"] == t["doc_type"])
        tally("project", (r["project"] or "").casefold() == t["project"].casefold())
        if t["doc_date"]:
            tally("doc_date", r["doc_date"] == t["doc_date"])
        got = {c["part_number"]: c.get("pressure_rating_psi") for c in data.get("components", [])}
        for c in t["components"]:
            tally("part_recall", c["part_number"] in got)
            if c["part_number"] in got:
                tally("rating_accuracy", got[c["part_number"]] == c["pressure_rating_psi"])
        tally("evidence_verified_docs", r["verified_ratio"] == 1.0 or not json.loads(r["evidence"]))

    planted = {a["part_number"] for a in manifest["anomalies"] if a["kind"] == "rating_conflict"}
    found = {
        f["key"]
        for f in conn.execute(
            """SELECT f.key FROM findings f JOIN collections c ON c.id = f.collection_id
               WHERE c.name = ? AND f.kind = 'rating_conflict'""",
            (collection,),
        )
    }
    tp = len(planted & found)
    return {
        "provider": provider,
        "model": model,
        "collection": collection,
        "documents_scored": len(rows),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "splits": {
            split: {m: {"correct": c, "total": n, "rate": round(c / n, 3) if n else None} for m, (c, n) in s.items()}
            for split, s in stats.items()
        },
        "conflicts": {
            "planted": len(planted),
            "found": len(found),
            "true_positive": tp,
            "recall": round(tp / len(planted), 3) if planted else None,
            "precision": round(tp / len(found), 3) if found else None,
            "note": "findings reflect the most recent processing run of the collection",
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--collection", default="demo")
    ap.add_argument("--provider", default="heuristic")
    ap.add_argument("--manifest", type=Path, default=Path("data/synthetic/v1/manifest.json"))
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()
    manifest = json.loads(args.manifest.read_text())
    with connect(get_settings().db_path) as conn:
        report = score(conn, args.collection, args.provider, manifest)
    text = json.dumps(report, indent=2)
    print(text)
    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / f"{args.provider}-{time.strftime('%Y%m%d-%H%M%S')}.json").write_text(text)


if __name__ == "__main__":
    main()
