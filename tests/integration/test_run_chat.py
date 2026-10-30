"""F10.13: a run summary from what the agents recorded, and questions answered only from those facts."""

from tests.conftest import auth, wait_job

API = "/api/v1"


def test_summary_and_questions_about_a_run(client, tokens, dataset, settings, monkeypatch):
    # Nothing listens here, so the rule-based answers are used and labelled, on any machine.
    monkeypatch.setattr(settings, "ollama_url", "http://127.0.0.1:9")
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "chat"}, headers=a).json()["id"]
    files = sorted((dataset / "files").iterdir())[:30]
    client.post(
        f"{API}/collections/{cid}/documents", headers=a, files=[("files", (p.name, p.read_bytes())) for p in files]
    )
    job = client.post(
        f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic", "workers": 4}, headers=a
    ).json()
    wait_job(client, tokens["analyst"], job["id"])

    s = client.get(f"{API}/jobs/{job['id']}/summary", headers=auth(tokens["viewer"])).json()
    assert s["status"] == "completed" and s["done"] == 30 and s["failed"] == 0
    assert sum(ln["documents"] for ln in s["lanes"]) == 30 and s["parallel_slots"] == 4
    assert sum(s["doc_types"].values()) == 30
    assert s["security"]["screened"] == 30

    r = client.post(f"{API}/jobs/{job['id']}/ask", json={"question": "Did anything fail?"}, headers=a).json()
    assert r["by"] == "rules" and r["answer"] == "Nothing failed in this run."
    r = client.post(f"{API}/jobs/{job['id']}/ask", json={"question": "How fast was it?"}, headers=a).json()
    assert "parallel slots" in r["answer"] or "not enough timing" in r["answer"]
    r = client.post(
        f"{API}/jobs/{job['id']}/ask", json={"question": "What did the security gate do?"}, headers=a
    ).json()
    assert "screened 30 documents" in r["answer"]

    assert client.get(f"{API}/jobs/999/summary", headers=a).status_code == 404
    assert client.post(f"{API}/jobs/999/ask", json={"question": "hi there"}, headers=a).status_code == 404
    assert client.post(f"{API}/jobs/{job['id']}/ask", json={"question": "hi there"}).status_code == 401
