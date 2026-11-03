"""F06.8: the chat box turns typed messages into searches, sorts, questions, pages and the model list."""

import pytest

from tests.conftest import auth, wait_job

API = "/api/v1"


@pytest.fixture
def chat_collection(client, tokens, dataset):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "chat"}, headers=a).json()["id"]
    files = sorted((dataset / "files").iterdir())
    client.post(
        f"{API}/collections/{cid}/documents", headers=a, files=[("files", (p.name, p.read_bytes())) for p in files]
    )
    job = client.post(
        f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic", "workers": 4}, headers=a
    ).json()
    wait_job(client, tokens["analyst"], job["id"])
    return cid


def say(client, token, cid, message, previous=None):
    r = client.post(
        f"{API}/collections/{cid}/chat",
        json={"message": message, "previous": previous, "use_model": False},
        headers=auth(token),
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_chat_box(client, tokens, chat_collection):
    find_filters_and_sorts(client, tokens, chat_collection)
    refines_the_last_result(client, tokens, chat_collection)
    other_kinds(client, tokens, chat_collection)
    messages_are_only_data(client, tokens, chat_collection)
    needs_sign_in_and_a_real_collection(client, tokens, chat_collection)


def find_filters_and_sorts(client, tokens, chat_collection):
    out = say(client, tokens["viewer"], chat_collection, "find drawings for Alpha, newest first")
    cmd = out["command"]
    assert cmd["kind"] == "find" and cmd["doc_type"] == "engineering_drawing" and cmd["project"] == "Alpha"
    assert (cmd["sort"], cmd["order"]) == ("date", "desc")
    rows = out["results"]
    assert rows and all(r["doc_type"] == "engineering_drawing" and r["project"] == "Alpha" for r in rows)
    dates = [r["doc_date"] for r in rows if r["doc_date"]]
    assert dates == sorted(dates, reverse=True)
    assert len({r["document_id"] for r in rows}) == len(rows)  # one row per document
    assert "drawings in Alpha" in out["reply"] and "newest first" in out["reply"]


def refines_the_last_result(client, tokens, chat_collection):
    first = say(client, tokens["viewer"], chat_collection, "show me everything for Alpha")
    assert first["command"]["project"] == "Alpha" and first["count"] > 0
    sorted_ = say(client, tokens["viewer"], chat_collection, "sort them by name", first["command"])
    assert sorted_["command"]["project"] == "Alpha" and sorted_["command"]["sort"] == "name"
    names = [r["filename"].casefold() for r in sorted_["results"]]
    assert names == sorted(names)
    only = say(client, tokens["viewer"], chat_collection, "only inspection reports", sorted_["command"])
    assert only["command"]["doc_type"] == "inspection_report" and only["command"]["sort"] == "name"
    assert 0 < only["count"] < first["count"]
    # A new "find" starts again instead of piling onto the last one.
    fresh = say(client, tokens["viewer"], chat_collection, "find contracts", only["command"])
    assert fresh["command"]["project"] is None and fresh["command"]["doc_type"] == "contract"


def other_kinds(client, tokens, chat_collection):
    cid = chat_collection
    assert (
        say(client, tokens["viewer"], cid, "Which parts have conflicting pressure ratings?")["command"]["kind"] == "ask"
    )
    opened = say(client, tokens["viewer"], cid, "open approvals")["command"]
    assert opened["kind"] == "open" and opened["page"] == "/approvals"
    models = say(client, tokens["viewer"], cid, "are my models downloaded?")
    assert models["command"]["kind"] == "models" and "reply" in models
    assert say(client, tokens["viewer"], cid, "hey vault")["command"]["kind"] == "help"


def messages_are_only_data(client, tokens, chat_collection):
    # Search operators and SQL in a message are words, never syntax.
    out = say(client, tokens["viewer"], chat_collection, 'find NEAR( " OR * ; DROP TABLE documents; --')
    assert out["command"]["kind"] in ("find", "help")
    assert client.get(f"{API}/stats", headers=auth(tokens["viewer"])).status_code == 200


def needs_sign_in_and_a_real_collection(client, tokens, chat_collection):
    assert client.post(f"{API}/collections/{chat_collection}/chat", json={"message": "find valves"}).status_code == 401
    r = client.post(f"{API}/collections/999999/chat", json={"message": "find valves"}, headers=auth(tokens["viewer"]))
    assert r.status_code == 404
    long = client.post(
        f"{API}/collections/{chat_collection}/chat", json={"message": "x" * 301}, headers=auth(tokens["viewer"])
    )
    assert long.status_code == 422
