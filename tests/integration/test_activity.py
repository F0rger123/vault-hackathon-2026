"""F10.22: one activity feed per collection records what VAULT actually did to which file."""

import json

from backend.storage.db import connect
from tests.conftest import auth, wait_job

API = "/api/v1"
QUESTION = "Which parts have conflicting pressure ratings?"


def _setup(client, tokens, dataset, files=30):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "live"}, headers=a).json()["id"]
    paths = sorted((dataset / "files").iterdir())[:files]
    up = client.post(
        f"{API}/collections/{cid}/documents", headers=a, files=[("files", (p.name, p.read_bytes())) for p in paths]
    ).json()
    job = client.post(f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic", "workers": 2}, headers=a)
    assert wait_job(client, tokens["analyst"], job.json()["id"])["status"] == "completed"
    return cid, up["accepted"], job.json()["id"]


def _feed(client, token, cid, **params):
    r = client.get(f"{API}/collections/{cid}/activity", params=params, headers=auth(token))
    assert r.status_code == 200, r.text
    return r.json()


def _all(client, token, cid, **params):
    events, after = [], 0
    while True:
        page = _feed(client, token, cid, after_id=after, limit=500, **params)
        if not page["events"]:
            return events
        events += page["events"]
        after = page["last_id"]


def _stream(client, token, cid, message):
    body = {"message": message, "use_model": False}
    with client.stream("POST", f"{API}/collections/{cid}/agent", json=body, headers=auth(token)) as r:
        assert r.status_code == 200
        return [json.loads(line) for line in r.iter_lines() if line]


def test_imports_and_reads_are_recorded(client, tokens, dataset, settings):
    cid, accepted, job_id = _setup(client, tokens, dataset)
    events = _all(client, tokens["viewer"], cid)
    stored = [e for e in events if e["action"] in ("stored", "media_stored")]
    assert sorted(e["document_id"] for e in stored) == sorted(d["document_id"] for d in accepted)
    assert all(e["actor"] == "Importer" and e["detail"]["filename"] for e in stored)
    read = [e for e in events if e["action"] == "read"]
    assert {e["document_id"] for e in read} == {d["document_id"] for d in accepted}
    assert all(e["run"] == f"job-{job_id}" and e["detail"]["job_id"] == job_id for e in read)
    # Every stored row comes before the same document's read row.
    first = {e["document_id"]: e["id"] for e in reversed(events)}
    assert all(first[e["document_id"]] < e["id"] for e in read)
    # A re-upload of the same files stores nothing new, so nothing new appears.
    before = _feed(client, tokens["viewer"], cid)["latest_id"]
    a = auth(tokens["analyst"])
    path = sorted((dataset / "files").iterdir())[0]
    client.post(f"{API}/collections/{cid}/documents", headers=a, files=[("files", (path.name, path.read_bytes()))])
    assert _feed(client, tokens["viewer"], cid)["latest_id"] == before


def test_chat_helpers_record_the_documents_they_looked_at(client, tokens, dataset):
    cid, _, _ = _setup(client, tokens, dataset, files=60)
    before = _feed(client, tokens["viewer"], cid)["latest_id"]
    events = _stream(client, tokens["viewer"], cid, QUESTION)
    run = events[0]["run"]
    assert run.startswith("ask-")
    answer = events[-2]
    rows = _all(client, tokens["viewer"], cid, run=run)
    assert rows and all(r["id"] > before and r["run"] == run for r in rows)
    by = {r["actor"]: r for r in rows}
    assert {"Finder", "Conflict checker", "Answer writer", "Fact checker"} <= set(by)
    finder = by["Finder"]
    assert finder["action"] == "looked_at" and finder["detail"]["document_ids"]
    assert finder["detail"]["count"] == len(finder["detail"]["document_ids"]) or finder["detail"]["count"] > 60
    cited = by["Answer writer"]["detail"]["document_ids"]
    assert cited == list(dict.fromkeys(s["document_id"] for s in answer["sources"]))
    checked = set(by["Fact checker"]["detail"]["document_ids"])
    source_doc = {s["id"]: s["document_id"] for s in answer["sources"]}
    assert checked == {source_doc[n] for s in answer["sentences"] for n in s["sources"]}
    assert by["Conflict checker"]["action"] == "checked_conflicts" and by["Conflict checker"]["detail"]["keys"]
    # Ids, counts and search words only: no quoted lines from the documents.
    quotes = {s["quote"] for s in answer["sources"] if s.get("quote")}
    blob = json.dumps(rows)
    assert not any(q in blob for q in quotes if len(q) > 20)

    # A sorted list records the Sorter's order, exactly as the reply shows it.
    events = _stream(client, tokens["viewer"], cid, "find drawings for Alpha, newest first")
    rows = _all(client, tokens["viewer"], cid, run=events[0]["run"])
    sorter = next(r for r in rows if r["actor"] == "Sorter")
    assert sorter["action"] == "sorted" and sorter["detail"]["sort"] == "date"
    shown = [r["document_id"] for r in events[-2]["rows"]]
    assert sorter["detail"]["document_ids"][: len(shown)] == shown
    assert next(r for r in rows if r["actor"] == "Finder")["action"] == "looked_at"


def test_approved_copies_are_listed_and_recorded(client, tokens, dataset, settings):
    cid, accepted, _ = _setup(client, tokens, dataset, files=12)
    a, admin = auth(tokens["analyst"]), auth(tokens["admin"])
    prop = client.post(f"{API}/proposals", json={"collection_id": cid}, headers=a).json()
    done = client.post(f"{API}/proposals/{prop['id']}/approve", json={"note": "ok"}, headers=admin).json()
    items = done["result"]["items"]
    assert len(items) == len(accepted) and all(i["copied"] for i in items)
    export = settings.data_dir / done["result"]["export_dir"]
    for i in items:
        assert (export / i["target"]).is_file() and not i["target"].startswith("/")
    rows = _all(client, tokens["viewer"], cid, run=f"proposal-{prop['id']}")
    assert [(r["document_id"], r["detail"]["target"]) for r in rows] == [(i["document_id"], i["target"]) for i in items]
    assert all(r["action"] == "copied" and r["actor"] == "Organizer" for r in rows)
    blob = json.dumps(rows)
    assert str(settings.data_dir) not in blob and str(settings.data_dir).replace("\\", "/") not in blob


def test_feed_paging_and_access(client, tokens, dataset, settings):
    cid, accepted, _ = _setup(client, tokens, dataset, files=8)
    full = _all(client, tokens["viewer"], cid)
    ids = [e["id"] for e in full]
    assert ids == sorted(ids) and len(ids) == len(set(ids))
    page = _feed(client, tokens["viewer"], cid, after_id=ids[2], limit=3)
    assert [e["id"] for e in page["events"]] == ids[3:6] and page["last_id"] == ids[5]
    assert page["latest_id"] == ids[-1]
    newest = _feed(client, tokens["viewer"], cid, limit=2)
    assert [e["id"] for e in newest["events"]] == ids[-2:]
    idle = _feed(client, tokens["viewer"], cid, after_id=ids[-1])
    assert idle["events"] == [] and idle["last_id"] == ids[-1]

    # Collections keep their own feeds.
    other = client.post(f"{API}/collections", json={"name": "other"}, headers=auth(tokens["analyst"])).json()["id"]
    assert _feed(client, tokens["viewer"], other)["events"] == []
    with connect(settings.db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM activity WHERE collection_id = ?", (other,)).fetchone()[0] == 0

    # Denied and invalid.
    url = f"{API}/collections/{cid}/activity"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=auth("vlt_not-a-real-token")).status_code == 401
    assert client.get(f"{API}/collections/99999/activity", headers=auth(tokens["viewer"])).status_code == 404
    assert client.get(url, params={"after_id": -1}, headers=auth(tokens["viewer"])).status_code == 422
    assert client.get(url, params={"run": "x' OR 1=1"}, headers=auth(tokens["viewer"])).status_code == 422
