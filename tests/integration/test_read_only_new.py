"""F05.10: "Read everything" skips documents the chosen model already read, unless something changed."""

from tests.conftest import auth, wait_job

API = "/api/v1"


def _job(client, tokens, cid, only_new):
    a = auth(tokens["analyst"])
    body = {"collection_id": cid, "provider": "heuristic", "workers": 4, "only_new": only_new}
    job = client.post(f"{API}/jobs", json=body, headers=a).json()
    return wait_job(client, tokens["analyst"], job["id"])


def test_only_new_documents_are_read_again(client, tokens, dataset):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "inc"}, headers=a).json()["id"]
    files = sorted((dataset / "files").iterdir())[:20]
    client.post(
        f"{API}/collections/{cid}/documents", headers=a, files=[("files", (p.name, p.read_bytes())) for p in files]
    )

    first = _job(client, tokens, cid, only_new=True)
    assert first["status"] == "completed" and first["total"] == 20 and first["params"]["skipped_already_read"] == 0

    again = _job(client, tokens, cid, only_new=True)
    assert again["status"] == "completed" and again["total"] == 0 and again["params"]["skipped_already_read"] == 20

    # One new file: only that one is read.
    extra = sorted((dataset / "files").iterdir())[20]
    client.post(f"{API}/collections/{cid}/documents", headers=a, files=[("files", (extra.name, extra.read_bytes()))])
    one = _job(client, tokens, cid, only_new=True)
    assert one["total"] == 1 and one["params"]["skipped_already_read"] == 20

    # Teaching the brain changes what a reading would say, so everything is read again.
    client.post(
        f"{API}/collections/{cid}/brain/knowledge",
        json={"kind": "instruction", "text": "Treat VOID as superseded"},
        headers=a,
    )
    all_again = _job(client, tokens, cid, only_new=True)
    assert all_again["total"] == 21 and all_again["params"]["skipped_already_read"] == 0

    # Without only_new, everything is read, as before.
    assert _job(client, tokens, cid, only_new=False)["total"] == 21
