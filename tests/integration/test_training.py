"""F07.6: grade a collection, apply suggested rules, re-read, and see the held-out score move."""

from tests.conftest import auth, wait_job

API = "/api/v1"


def _demo_collection(client, tokens, dataset):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "training-demo", "is_demo": True}, headers=a).json()["id"]
    files = [("files", (p.name, p.read_bytes())) for p in sorted((dataset / "files").iterdir())]
    assert client.post(f"{API}/collections/{cid}/documents", files=files, headers=a).status_code == 200
    return cid


def _read(client, tokens, cid):
    job = client.post(
        f"{API}/jobs",
        json={"collection_id": cid, "provider": "heuristic", "workers": 4},
        headers=auth(tokens["analyst"]),
    ).json()
    assert wait_job(client, tokens["analyst"], job["id"], timeout=120)["status"] == "completed"


def test_grade_teach_and_retest_on_demo_data(client, tokens, dataset):
    a = auth(tokens["analyst"])
    cid = _demo_collection(client, tokens, dataset)
    _read(client, tokens, cid)

    first = client.post(f"{API}/training/{cid}/grade", headers=a).json()
    report = first["report"]
    assert report["source"] == "demo ground truth" and report["graded_documents"] == 150
    assert report["read_by"] == ["heuristic:regex-rules-v1"]
    assert report["conflicts"] == {"planted": 10, "found": 10, "false_alarms": 0}
    assert report["mistakes"] and all(m["document_id"] for m in report["mistakes"])
    before = report["fields"]["heldout"]["doc_type"]["rate"]

    suggestions = client.get(f"{API}/training/{cid}/suggestions", headers=a).json()
    assert suggestions and all(s["when_contains"] for s in suggestions)
    applied = client.post(f"{API}/training/{cid}/apply-suggestions", headers=a).json()["applied"]
    assert len(applied) == len(suggestions) and applied[-1]["policy_version"] > 1
    assert client.get(f"{API}/training/{cid}/suggestions", headers=a).json() == []  # nothing applied twice

    _read(client, tokens, cid)
    second = client.post(f"{API}/training/{cid}/grade", headers=a).json()
    after = second["report"]["fields"]["heldout"]["doc_type"]["rate"]
    assert after > before  # measured on held-out documents nobody corrected
    assert [h["rules"] for h in second["history"]] == [0, len(applied)]


def test_real_collections_are_graded_against_labelled_examples(client, tokens):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "ours"}, headers=a).json()["id"]
    files = [
        ("files", (f"memo-{i}.txt", f"MEMORANDUM {i}\nProject: Beta\nDate: 2024-0{1 + i % 9}-01".encode()))
        for i in range(12)
    ]
    docs = client.post(f"{API}/collections/{cid}/documents", files=files, headers=a).json()["accepted"]
    _read(client, tokens, cid)
    empty = client.get(f"{API}/training/{cid}", headers=a).json()["report"]
    assert empty["source"] == "your labelled examples" and empty["graded_documents"] == 0
    assert empty["readiness"]["ready"] is False
    for d in docs:
        labels = {"doc_type": "project_memo", "project": "Beta"}
        assert (
            client.post(
                f"{API}/examples", json={"document_id": d["document_id"], "labels": labels}, headers=a
            ).status_code
            == 201
        )
    graded = client.get(f"{API}/training/{cid}", headers=a).json()["report"]
    assert graded["graded_documents"] == 12
    assert graded["fields"]["train"]["doc_type"]["total"] + graded["fields"]["heldout"]["doc_type"]["total"] == 12


def test_viewers_can_look_but_not_teach(client, tokens, dataset):
    v = auth(tokens["viewer"])
    cid = client.post(f"{API}/collections", json={"name": "t"}, headers=auth(tokens["analyst"])).json()["id"]
    assert client.get(f"{API}/training/{cid}", headers=v).status_code == 200
    assert client.post(f"{API}/training/{cid}/grade", headers=v).status_code == 403
    assert client.post(f"{API}/training/{cid}/apply-suggestions", headers=v).status_code == 403
    assert client.get(f"{API}/training/{cid}").status_code == 401
