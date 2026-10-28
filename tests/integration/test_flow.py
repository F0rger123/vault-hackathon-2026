"""End-to-end API flow on the synthetic dataset using the heuristic baseline provider."""

import hashlib
import json

from tests.conftest import auth, wait_job

API = "/api/v1"


def _upload(client, token, cid, files):
    payload = [("files", (p.name, p.read_bytes())) for p in files]
    return client.post(f"{API}/collections/{cid}/documents", headers=auth(token), files=payload)


def test_full_vertical_slice(client, tokens, dataset, settings):
    a, admin = auth(tokens["analyst"]), auth(tokens["admin"])
    assert client.get(f"{API}/health").json()["status"] == "ok"

    cid = client.post(f"{API}/collections", json={"name": "demo"}, headers=a).json()["id"]
    files = sorted((dataset / "files").iterdir())
    r = _upload(client, tokens["analyst"], cid, files)
    assert r.status_code == 200, r.text
    assert len(r.json()["accepted"]) == len(files) and not r.json()["rejected"]

    # Re-upload is de-duplicated by SHA-256.
    again = _upload(client, tokens["analyst"], cid, files[:3]).json()["accepted"]
    assert all(x["duplicate"] for x in again)

    inv = client.get(f"{API}/collections/{cid}/inventory", headers=a).json()
    assert sum(t["documents"] for t in inv["by_media_type"]) == len(files)
    assert inv["recommended_workers"] >= 1

    est = client.post(
        f"{API}/collections/{cid}/estimate", json={"provider": "heuristic", "sample_size": 3}, headers=a
    ).json()
    assert est["estimate"]["sample_size"] == 3 and est["estimate"]["documents"] == len(files)

    job = client.post(
        f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic", "workers": 4}, headers=a
    ).json()
    job = wait_job(client, tokens["analyst"], job["id"])
    assert job["status"] == "completed" and job["done"] == len(files)
    # F03.5: the finished job is compared with the estimate made just before it.
    check = job["estimate_check"]
    assert check["provider"] == "heuristic" and check["sample_size"] == 3
    assert check["actual_s"] >= 0 and check["estimated_low_s"] <= check["estimated_high_s"]
    assert isinstance(check["within_range"], bool)

    # Every planted rating conflict is found, with verified evidence from at least two documents.
    manifest = json.loads((dataset / "manifest.json").read_text())
    planted = {x["part_number"] for x in manifest["anomalies"] if x["kind"] == "rating_conflict"}
    found = client.get(f"{API}/collections/{cid}/findings", headers=a).json()
    assert {f["key"] for f in found} == planted
    for f in found:
        assert f["status"] == "verified"
        assert len({e["document_id"] for e in f["evidence"]}) >= 2

    part = sorted(planted)[0]
    hits = client.get(f"{API}/search", params={"q": part}, headers=a).json()
    assert hits["count"] >= 2 and all(h["page"] for h in hits["results"])
    filtered = client.get(
        f"{API}/search", params={"part_number": part, "doc_type": "engineering_drawing"}, headers=a
    ).json()
    assert all(h["doc_type"] == "engineering_drawing" for h in filtered["results"])

    doc = client.get(f"{API}/documents/{hits['results'][0]['document_id']}", headers=a).json()
    assert doc["extraction"]["provider"] == "heuristic"

    # Proposal -> approval -> export copies; originals untouched.
    before = {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in settings.originals_dir.rglob("*") if p.is_file()
    }
    prop = client.post(f"{API}/proposals", json={"collection_id": cid}, headers=a).json()
    assert prop["status"] == "pending" and len(prop["plan"]["items"]) == len(files)
    done = client.post(f"{API}/proposals/{prop['id']}/approve", json={"note": "ok"}, headers=admin).json()
    assert done["status"] == "executed" and done["result"]["copied"] == len(files)
    export = settings.data_dir / done["result"]["export_dir"]
    assert len([p for p in export.rglob("*") if p.is_file()]) == len(files)
    after = {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in settings.originals_dir.rglob("*") if p.is_file()
    }
    assert before == after
    assert client.post(f"{API}/proposals/{prop['id']}/approve", json={}, headers=admin).status_code == 409

    actions = {e["action"] for e in client.get(f"{API}/audit", headers=admin).json()}
    assert {"document.upload", "job.create", "proposal.create", "proposal.approve"} <= actions


def test_correction_creates_versioned_policy(client, tokens, dataset):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "teach"}, headers=a).json()["id"]
    fvr = [p for p in sorted((dataset / "files").iterdir()) if "-INS-0004" in p.name][:1]
    did = _upload(client, tokens["analyst"], cid, fvr).json()["accepted"][0]["document_id"]
    job = client.post(f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic"}, headers=a).json()
    wait_job(client, tokens["analyst"], job["id"])
    assert client.get(f"{API}/documents/{did}", headers=a).json()["extraction"]["data"]["doc_type"] == "other"

    r = client.post(
        f"{API}/documents/{did}/corrections",
        headers=a,
        json={"field": "doc_type", "value": "inspection_report", "when_contains": "Field Verification Record"},
    )
    assert r.status_code == 201 and r.json()["policy_version"] == 2

    job = client.post(f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic"}, headers=a).json()
    wait_job(client, tokens["analyst"], job["id"])
    ex = client.get(f"{API}/documents/{did}", headers=a).json()["extraction"]
    assert ex["data"]["doc_type"] == "inspection_report" and ex["policy_version"] == 2


def test_cancel_job(client, tokens, dataset):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "cancel"}, headers=a).json()["id"]
    _upload(client, tokens["analyst"], cid, sorted((dataset / "files").iterdir())[:40])
    job = client.post(
        f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic", "workers": 1}, headers=a
    ).json()
    client.post(f"{API}/jobs/{job['id']}/cancel", headers=a)
    job = wait_job(client, tokens["analyst"], job["id"])
    assert job["status"] in ("cancelled", "completed")
    assert job["cancel_requested"] == 1
