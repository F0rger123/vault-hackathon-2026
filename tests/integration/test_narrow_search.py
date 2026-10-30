"""F06.7: narrow search results step by step: year, pictures or documents, and words to leave out."""

from tests.conftest import auth, wait_job

API = "/api/v1"


def test_narrowing_steps(client, tokens, dataset):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "narrow"}, headers=a).json()["id"]
    files = sorted((dataset / "files").iterdir())
    client.post(
        f"{API}/collections/{cid}/documents", headers=a, files=[("files", (p.name, p.read_bytes())) for p in files]
    )
    job = client.post(
        f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic", "workers": 4}, headers=a
    ).json()
    wait_job(client, tokens["analyst"], job["id"])

    def hits(**params):
        r = client.get(f"{API}/search", params={"collection_id": cid, "limit": 200, **params}, headers=a)
        assert r.status_code == 200, r.text
        return r.json()["results"]

    reports = hits(q="test", doc_type="inspection_report")
    assert reports
    passed = hits(q="test", doc_type="inspection_report", exclude="FAIL")
    assert 0 < len(passed) < len(reports) or all("FAIL" not in (h["snippet"] or "") for h in passed)
    for h in passed:
        page = client.get(f"{API}/documents/{h['document_id']}/pages/{h['page']}", headers=a).json()["text"]
        assert "fail" not in page.casefold()

    year = reports[0]["doc_date"][:4]
    assert all(h["doc_date"].startswith(year) for h in hits(q="test", year=year))

    images = hits(media="image")
    assert images and all(h["media_type"].startswith("image/") for h in images)
    assert all(not h["media_type"].startswith("image/") for h in hits(q="valve", media="document"))

    assert client.get(f"{API}/search", params={"year": "20x4"}, headers=a).status_code == 422
    assert client.get(f"{API}/search", params={"media": "video"}, headers=a).status_code == 422
    # Operators typed into "leave out" are treated as words, never as FTS syntax.
    assert isinstance(hits(q="valve", exclude='NEAR( " OR *'), list)
