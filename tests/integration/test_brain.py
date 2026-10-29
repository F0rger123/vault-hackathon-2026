"""F07.7 and F07.8: one brain per collection, questions it asks, answers it keeps, and its graph."""

import json

from backend.providers.prompting import build_user_prompt
from backend.storage.db import connect
from backend.workers.brain import prompt_guidance
from backend.workers.processing import current_policy
from tests.conftest import auth, wait_job

API = "/api/v1"


def _collection(client, tokens, dataset, name, files=None):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": name}, headers=a).json()["id"]
    paths = sorted((dataset / "files").iterdir())[: files or None]
    payload = [("files", (p.name, p.read_bytes())) for p in paths]
    assert client.post(f"{API}/collections/{cid}/documents", headers=a, files=payload).status_code == 200
    return cid


def _read(client, tokens, cid):
    a = auth(tokens["analyst"])
    job = client.post(f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic", "workers": 4}, headers=a)
    assert wait_job(client, tokens["analyst"], job.json()["id"])["status"] == "completed"


def test_each_collection_keeps_its_own_brain(client, tokens, dataset, settings):
    a = auth(tokens["analyst"])
    nuclear = _collection(client, tokens, dataset, "nuclear", 40)
    retail = _collection(client, tokens, dataset, "retail", 40)
    _read(client, tokens, nuclear)
    _read(client, tokens, retail)

    taught = client.post(
        f"{API}/collections/{nuclear}/brain/knowledge",
        json={"kind": "meaning", "term": "QA ACCEPTED", "text": "Checked by the reactor quality team"},
        headers=a,
    )
    assert taught.status_code == 201
    client.post(
        f"{API}/collections/{nuclear}/brain/knowledge",
        json={"kind": "instruction", "text": "Treat any drawing marked VOID as superseded"},
        headers=a,
    )
    with connect(settings.db_path) as conn:
        assert {"meaning": "QA ACCEPTED", "is": "Checked by the reactor quality team"} in prompt_guidance(conn, nuclear)
        assert prompt_guidance(conn, retail) == []

    # A rule taught in one collection must not change readings in the other.
    doc = client.get(f"{API}/documents", params={"collection_id": nuclear, "limit": 1}, headers=a).json()[0]
    text = client.get(f"{API}/documents/{doc['id']}/pages/1", headers=a).json()["text"]
    needle = text.split()[0]
    client.post(
        f"{API}/documents/{doc['id']}/corrections",
        json={"field": "project", "value": "Reactor", "when_contains": needle},
        headers=a,
    )
    with connect(settings.db_path) as conn:
        rule = current_policy(conn)[1][-1]
    assert rule["collection_id"] == nuclear
    _read(client, tokens, nuclear)
    _read(client, tokens, retail)
    nuclear_projects = {
        d["project"]
        for d in client.get(f"{API}/search", params={"q": needle, "collection_id": nuclear}, headers=a).json()[
            "results"
        ]
    }
    retail_projects = {
        d["project"]
        for d in client.get(f"{API}/search", params={"q": needle, "collection_id": retail}, headers=a).json()["results"]
    }
    assert "reactor" in {(p or "").casefold() for p in nuclear_projects}
    assert "reactor" not in {(p or "").casefold() for p in retail_projects}

    nuclear_brain = client.get(f"{API}/collections/{nuclear}/brain", headers=auth(tokens["viewer"])).json()
    retail_brain = client.get(f"{API}/collections/{retail}/brain", headers=auth(tokens["viewer"])).json()
    assert nuclear_brain["taught"]["meanings"] == 1 and nuclear_brain["taught"]["instructions"] == 1
    assert nuclear_brain["taught"]["rules"] == 1 and retail_brain["taught"]["rules"] == 0
    assert retail_brain["knowledge"] == []


def test_questions_are_answered_and_remembered(client, tokens, dataset):
    a = auth(tokens["analyst"])
    cid = _collection(client, tokens, dataset, "demo")
    _read(client, tokens, cid)
    body = client.get(f"{API}/collections/{cid}/brain", headers=a).json()
    assert body["read"] == body["documents"] > 0 and body["projects"] and body["parts"]
    questions = body["questions"]
    assert questions, "a freshly read archive should leave VAULT something to ask"
    meaning_q = next(q for q in questions if q["kind"] in ("marking", "term"))

    r = client.post(
        f"{API}/collections/{cid}/brain/answer",
        json={"gap_id": meaning_q["id"], "answer": "Signed off by site quality"},
        headers=a,
    )
    assert r.status_code == 200 and r.json()["saved_as"] == "meaning"
    after = client.get(f"{API}/collections/{cid}/brain", headers=a).json()
    assert meaning_q["id"] not in {q["id"] for q in after["questions"]}
    assert any(k["term"] == meaning_q["subject"] for k in after["knowledge"])

    # Answers are accepted only for open questions, and only from people allowed to teach.
    assert (
        client.post(
            f"{API}/collections/{cid}/brain/answer", json={"gap_id": meaning_q["id"], "answer": "x"}, headers=a
        ).status_code
        == 404
    )
    viewer = auth(tokens["viewer"])
    assert (
        client.post(
            f"{API}/collections/{cid}/brain/answer", json={"gap_id": "0" * 16, "answer": "x"}, headers=viewer
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"{API}/collections/{cid}/brain/knowledge", json={"kind": "instruction", "text": "x"}, headers=viewer
        ).status_code
        == 403
    )
    assert client.get(f"{API}/collections/{cid}/brain").status_code == 401
    assert client.get(f"{API}/collections/999/brain", headers=viewer).status_code == 404

    # Skipping a question hides it; retiring knowledge removes it from the next reading.
    if after["questions"]:
        q = after["questions"][0]
        client.post(f"{API}/collections/{cid}/brain/skip", json={"gap_id": q["id"]}, headers=a)
        assert q["id"] not in {
            x["id"] for x in client.get(f"{API}/collections/{cid}/brain", headers=a).json()["questions"]
        }
    kid = after["knowledge"][0]["id"]
    assert client.delete(f"{API}/collections/{cid}/brain/knowledge/{kid}", headers=a).status_code == 200
    assert client.get(f"{API}/collections/{cid}/brain", headers=a).json()["knowledge"] == []

    log = client.get(f"{API}/audit", headers=auth(tokens["admin"])).json()
    assert {"brain.answer", "brain.forget"} <= {e["action"] for e in log}


def test_document_type_answers_become_examples(client, tokens, dataset):
    a = auth(tokens["analyst"])
    cid = _collection(client, tokens, dataset, "types")
    _read(client, tokens, cid)
    questions = client.get(f"{API}/collections/{cid}/brain", headers=a).json()["questions"]
    q = next((q for q in questions if q["kind"] == "doc_type"), None)
    if q is None:
        return  # the rules baseline placed every document; nothing to ask about types
    bad = client.post(f"{API}/collections/{cid}/brain/answer", json={"gap_id": q["id"], "answer": "banana"}, headers=a)
    assert bad.status_code == 422
    ok = client.post(f"{API}/collections/{cid}/brain/answer", json={"gap_id": q["id"], "answer": "contract"}, headers=a)
    assert ok.json() == {**ok.json(), "saved_as": "example", "labels": {"doc_type": "contract"}}
    examples = client.get(f"{API}/examples", headers=a).json()
    assert any(e["document_id"] == q["document_id"] and e["labels"]["doc_type"] == "contract" for e in examples)


def test_brain_graph_links_documents_to_what_they_mention(client, tokens, dataset):
    cid = _collection(client, tokens, dataset, "graph")
    _read(client, tokens, cid)
    g = client.get(f"{API}/collections/{cid}/brain/graph", headers=auth(tokens["viewer"])).json()
    ids = {n["id"] for n in g["nodes"]}
    kinds = {n["kind"] for n in g["nodes"]}
    assert {"document", "project", "doc_type", "part"} <= kinds
    assert all(e["source"] in ids and e["target"] in ids for e in g["edges"])
    assert g["documents_shown"] == g["documents_total"] > 0
    # The planted rating conflicts are flagged on their part nodes.
    manifest = json.loads((dataset / "manifest.json").read_text())
    planted = {x["part_number"] for x in manifest["anomalies"] if x["kind"] == "rating_conflict"}
    flagged = {n["label"] for n in g["nodes"] if n["kind"] == "part" and n.get("conflict")}
    assert planted <= flagged


def test_prompt_keeps_taught_knowledge_apart_from_rules():
    rules = [
        {"when_contains": "Bravo", "field": "project", "value": "Bravo", "collection_id": 3},
        {"meaning": "QA-7", "is": "approved by quality"},
        {"instruction": "Revision stamps in red mean a revision request"},
    ]
    prompt = build_user_prompt(["page text"], "a.pdf", rules)
    head, doc = prompt.split("<document>")
    assert "collection_id" not in head
    assert "approved by quality" in head and "revision request" in head
    assert head.index("from approved corrections") < head.index("What this organization's terms")
