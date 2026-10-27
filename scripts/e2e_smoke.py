"""End-to-end smoke test against a running VAULT API.

Walks the whole workflow over HTTP: upload -> process -> search -> findings -> correction -> proposal ->
approve (export) -> audit, plus the denied cases a viewer must hit. Tokens are read from the data directory
and never printed.

    VAULT_DATA_DIR=/tmp/vault-e2e vault init --demo-users
    VAULT_DATA_DIR=/tmp/vault-e2e vault serve --port 8010
    python scripts/e2e_smoke.py --base http://127.0.0.1:8010 --data-dir /tmp/vault-e2e
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import httpx

FILES = Path("data/synthetic/v1/files")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8010")
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--provider", default="heuristic")
    ap.add_argument("--limit", type=int, default=0, help="upload only the first N files (0 = all)")
    args = ap.parse_args()

    tokens = json.loads((Path(args.data_dir) / "dev_tokens.json").read_text())
    api = f"{args.base}/api/v1"
    admin = httpx.Client(base_url=api, headers={"Authorization": f"Bearer {tokens['admin']}"}, timeout=120)
    viewer = httpx.Client(base_url=api, headers={"Authorization": f"Bearer {tokens['viewer']}"}, timeout=30)
    failures: list[str] = []
    timings: dict[str, float] = {}

    def check(name: str, ok: bool, detail: str = "") -> None:
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")
        if not ok:
            failures.append(name)

    check("health", admin.get("/health").status_code == 200)
    check("no token is 401", httpx.get(f"{api}/documents").status_code == 401)

    r = admin.post("/collections", json={"name": f"e2e-{int(time.time())}"})
    check("create collection", r.status_code in (200, 201), str(r.status_code))
    cid = r.json()["id"]
    check("viewer cannot create collection", viewer.post("/collections", json={"name": "x"}).status_code == 403)

    paths = sorted(p for p in FILES.iterdir() if p.is_file())
    if args.limit:
        paths = paths[: args.limit]
    t0 = time.perf_counter()
    accepted = 0
    for i in range(0, len(paths), 50):
        batch = [("files", (p.name, p.read_bytes())) for p in paths[i : i + 50]]
        r = admin.post(f"/collections/{cid}/documents", files=batch)
        if r.status_code != 200:
            check("upload batch", False, str(r.status_code))
            break
        accepted += len(r.json()["accepted"])
    timings["upload_s"] = time.perf_counter() - t0
    check("upload", accepted == len(paths), f"{accepted}/{len(paths)} accepted")
    bad = admin.post(f"/collections/{cid}/documents", files=[("files", ("evil.pdf", b"MZ\x90\x00binary"))])
    check("binary disguised as PDF rejected", bad.status_code == 200 and len(bad.json()["rejected"]) == 1)
    trav = admin.post(f"/collections/{cid}/documents", files=[("files", ("../../escape.txt", b"hello"))])
    names = [a["filename"] for a in trav.json().get("accepted", [])]
    check("traversal filename sanitised", names == ["escape.txt"], str(names))

    inv = admin.get(f"/collections/{cid}/inventory")
    check("inventory", inv.status_code == 200 and inv.json()["by_media_type"], "")

    t0 = time.perf_counter()
    r = admin.post("/jobs", json={"collection_id": cid, "provider": args.provider})
    check("start job", r.status_code == 202, str(r.status_code))
    job_id = r.json()["id"]
    job = r.json()
    while job["status"] in ("queued", "running"):
        time.sleep(1)
        job = admin.get(f"/jobs/{job_id}").json()
    timings["process_s"] = time.perf_counter() - t0
    check(
        "job completed",
        job["status"] == "completed",
        json.dumps({k: job.get(k) for k in ("status", "done", "failed", "total")}),
    )
    check("job agents", admin.get(f"/jobs/{job_id}/agents").status_code == 200)

    docs = admin.get("/documents", params={"collection_id": cid, "limit": 500}).json()
    processed = sum(d["status"] == "processed" for d in docs)
    check("documents processed", processed >= len(paths), f"{processed}/{len(docs)}")
    detail = admin.get(f"/documents/{docs[0]['id']}").json()
    ext = detail.get("extraction") or {}
    check(
        "extraction with evidence",
        bool(ext.get("data")) and "evidence" in ext,
        f"verified_ratio={ext.get('verified_ratio')}",
    )
    check("page text", admin.get(f"/documents/{docs[0]['id']}/pages/1").status_code == 200)
    check("original download", admin.get(f"/documents/{docs[0]['id']}/original").status_code == 200)

    t0 = time.perf_counter()
    s = admin.get("/search", params={"q": "pressure", "collection_id": cid})
    timings["search_ms"] = (time.perf_counter() - t0) * 1000
    check("search", s.status_code == 200 and s.json()["count"] > 0, f"{s.json().get('count')} hits")
    s2 = admin.get("/search", params={"q": 'NEAR("a" OR *) ^', "collection_id": cid})
    check("search operators neutralised", s2.status_code == 200)

    f = admin.get(f"/collections/{cid}/findings")
    nf = len(f.json()) if isinstance(f.json(), list) else len(f.json().get("findings", []))
    check("findings", f.status_code == 200 and nf > 0, f"{nf} findings")

    c = admin.post(f"/documents/{docs[0]['id']}/corrections", json={"field": "project", "value": "Alpha"})
    check("correction", c.status_code == 201, str(c.status_code))

    p = admin.post("/proposals", json={"collection_id": cid})
    check("create proposal", p.status_code == 201, str(p.status_code))
    pid = p.json()["id"]
    check("viewer cannot approve", viewer.post(f"/proposals/{pid}/approve", json={}).status_code == 403)
    a = admin.post(f"/proposals/{pid}/approve", json={"note": "e2e"})
    res = a.json().get("result") or {}
    check("approve executes export", a.status_code == 200 and a.json()["status"] == "executed", str(res))
    export_dir = Path(args.data_dir) / res.get("export_dir", "missing")
    copied = sum(1 for x in export_dir.rglob("*") if x.is_file()) if export_dir.exists() else 0
    check("export files on disk", copied == res.get("copied"), f"{copied} files")

    audit = admin.get("/audit")
    actions = {e.get("action") for e in audit.json()} if audit.status_code == 200 else set()
    check("audit log", {"proposal.approve"} & actions or len(actions) > 3, f"{len(actions)} action kinds")
    check("viewer cannot read audit", viewer.get("/audit").status_code == 403)

    print("TIMINGS", json.dumps({k: round(v, 2) for k, v in timings.items()}), f"docs={len(paths)}")
    print(f"{len(failures)} failure(s)" + (": " + ", ".join(failures) if failures else ""))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
