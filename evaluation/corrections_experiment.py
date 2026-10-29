"""Measure whether human corrections improve accuracy on documents nobody corrected (F07.3).

1. Import the synthetic dataset into a fresh, temporary VAULT and process it with one provider.
2. Score every document against ground truth ("before").
3. Play the reviewer, using the TRAIN split only: for each train document whose `doc_type` or `project` is
   wrong, choose a phrase from that document's own text that identifies similar documents, and submit it as a
   correction with `when_contains` through the real API. This publishes a new policy version.
4. Reprocess the collection with the same provider and score again ("after").

Held-out ground truth is never read before the final scoring, so the held-out change shows whether the rules
generalise. The rule-picking step is automatic so the experiment can be repeated, but it is restricted to
what a reviewer could do in the UI: pick a line of text they can see in a document they corrected.

    python -m evaluation.corrections_experiment --provider heuristic --out evaluation/results
"""

from __future__ import annotations

import argparse
import json
import tempfile
import time
from pathlib import Path

from fastapi.testclient import TestClient

from backend.core.config import Settings
from backend.main import create_app
from backend.security.auth import create_user, issue_token
from backend.storage.db import connect
from backend.workers.rule_suggestions import FIELDS, _candidates, pick_rules  # noqa: F401 - re-exported for tests
from evaluation.run_eval import score

API = "/api/v1"
COLLECTION = "corrections-experiment"


def _wait(client: TestClient, headers: dict, job_id: int, timeout: float) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"{API}/jobs/{job_id}", headers=headers).json()
        if job["status"] not in ("queued", "running"):
            return job
        time.sleep(0.5)
    raise SystemExit(f"job {job_id} did not finish in {timeout:.0f}s")


def _process(client: TestClient, headers: dict, cid: int, provider: str, workers: int | None, timeout: float) -> dict:
    r = client.post(
        f"{API}/jobs", json={"collection_id": cid, "provider": provider, "workers": workers}, headers=headers
    )
    if r.status_code != 202:
        raise SystemExit(f"could not start job: HTTP {r.status_code} {r.text[:200]}")
    return _wait(client, headers, r.json()["id"], timeout)


def _split_rates(report: dict) -> dict:
    return {
        split: {m: v["rate"] for m, v in metrics.items() if m in ("doc_type", "project")}
        for split, metrics in report["splits"].items()
    }


def run(provider: str, workers: int | None, timeout: float, manifest_path: Path) -> dict:
    manifest = json.loads(manifest_path.read_text())
    truth = {d["filename"]: d for d in manifest["documents"]}
    files = sorted((manifest_path.parent / "files").iterdir())
    with tempfile.TemporaryDirectory(prefix="vault-f073-") as tmp:
        settings = Settings(
            data_dir=Path(tmp),
            provider=provider,
            allow_remote_inference=False,
            allowed_hosts="testserver",
            _env_file=None,
        )
        app = create_app(settings, resume_jobs=False)
        with connect(settings.db_path) as conn:
            token = issue_token(conn, create_user(conn, "reviewer", "admin"))
        h = {"Authorization": f"Bearer {token}"}
        with TestClient(app) as client:
            cid = client.post(f"{API}/collections", json={"name": COLLECTION}, headers=h).json()["id"]
            for i in range(0, len(files), 50):
                batch = [("files", (p.name, p.read_bytes())) for p in files[i : i + 50]]
                client.post(f"{API}/collections/{cid}/documents", files=batch, headers=h).raise_for_status()

            t0 = time.perf_counter()
            job_before = _process(client, h, cid, provider, workers, timeout)
            before_s = time.perf_counter() - t0
            with connect(settings.db_path) as conn:
                before = score(conn, COLLECTION, provider, manifest)
                train = []
                for d in conn.execute("SELECT id, filename FROM documents WHERE collection_id = ?", (cid,)).fetchall():
                    t = truth.get(d["filename"])
                    if not t or t["split"] != "train":  # held-out ground truth is not looked at here
                        continue
                    x = conn.execute(
                        "SELECT doc_type, project FROM extractions WHERE document_id = ? ORDER BY id DESC LIMIT 1",
                        (d["id"],),
                    ).fetchone()
                    text = "\n".join(
                        r["text"]
                        for r in conn.execute(
                            "SELECT text FROM pages WHERE document_id = ? ORDER BY page_no", (d["id"],)
                        )
                    )
                    train.append(
                        {
                            "document_id": d["id"],
                            "filename": d["filename"],
                            "text": text,
                            "truth": {f: t[f] for f in FIELDS},
                            "got": dict(x) if x else {},
                        }
                    )

            rules = pick_rules(train)
            names = {d["document_id"]: d["filename"] for d in train}
            for rule in rules:
                r = client.post(
                    f"{API}/documents/{rule['document_id']}/corrections",
                    json={
                        "field": rule["field"],
                        "value": rule["value"],
                        "when_contains": rule["when_contains"],
                        "note": "F07.3 experiment: rule chosen from train split",
                    },
                    headers=h,
                )
                r.raise_for_status()
                rule["policy_version"] = r.json()["policy_version"]
                rule["corrected_document"] = names[rule.pop("document_id")]

            t0 = time.perf_counter()
            job_after = _process(client, h, cid, provider, workers, timeout)
            after_s = time.perf_counter() - t0
            with connect(settings.db_path) as conn:
                after = score(conn, COLLECTION, provider, manifest)

    b, a = _split_rates(before), _split_rates(after)
    return {
        "experiment": "F07.3 corrections from train split, measured on held-out split",
        "provider": provider,
        "model": after["model"],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "dataset": str(manifest_path.parent),
        "train_documents_wrong_before": {
            f: sum((d["got"].get(f) or "").casefold() != d["truth"][f].casefold() for d in train) for f in FIELDS
        },
        "rules": rules,
        "before": b,
        "after": a,
        "change": {split: {m: round((a[split][m] or 0) - (b[split][m] or 0), 3) for m in b[split]} for split in b},
        "jobs": {
            "before": {"status": job_before["status"], "seconds": round(before_s, 1)},
            "after": {"status": job_after["status"], "seconds": round(after_s, 1)},
        },
        "full_reports": {"before": before, "after": after},
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="F07.3: do corrections on train documents improve held-out accuracy?")
    ap.add_argument("--provider", default="heuristic", choices=["heuristic", "ollama"])
    ap.add_argument("--workers", type=int, default=None)
    ap.add_argument("--timeout", type=float, default=3600)
    ap.add_argument("--manifest", type=Path, default=Path("data/synthetic/v1/manifest.json"))
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()
    report = run(args.provider, args.workers, args.timeout, args.manifest)
    summary = {k: report[k] for k in ("provider", "model", "train_documents_wrong_before", "before", "after", "change")}
    print(json.dumps(summary, indent=2))
    print("rules:")
    for r in report["rules"]:
        print(
            f"  {r['field']} = {r['value']!r} when text contains {r['when_contains']!r} (fixes {r['fixes_train_docs']})"
        )
    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        path = args.out / f"corrections-{args.provider}-{time.strftime('%Y%m%d-%H%M%S')}.json"
        path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(f"saved {path}")


if __name__ == "__main__":
    main()
