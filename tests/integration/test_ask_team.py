"""F10.20: Ask VAULT streams a coordinator's plan and each helper's real work, then the answer."""

import json

import pytest

from backend.security import auth as auth_mod
from tests.conftest import auth, wait_job

API = "/api/v1"
QUESTION = "Which parts have conflicting pressure ratings?"


@pytest.fixture
def cid(client, tokens, dataset):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "ask"}, headers=a).json()["id"]
    files = sorted((dataset / "files").iterdir())
    client.post(
        f"{API}/collections/{cid}/documents", headers=a, files=[("files", (p.name, p.read_bytes())) for p in files]
    )
    job = client.post(f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic", "workers": 4}, headers=a)
    wait_job(client, tokens["analyst"], job.json()["id"])
    return cid


def stream(client, token, cid, message, **extra):
    body = {"message": message, "use_model": False, **extra}
    with client.stream("POST", f"{API}/collections/{cid}/agent", json=body, headers=auth(token)) as r:
        assert r.status_code == 200, r.read()
        assert r.headers["content-type"].startswith("application/x-ndjson")
        return [json.loads(line) for line in r.iter_lines() if line]


def helper_events(events, helper):
    return [e for e in events if e["type"] == "helper" and e["id"] == helper]


def test_ask_team(client, tokens, cid):
    question_runs_helpers_in_order(client, tokens, cid)
    lists_are_found_then_sorted(client, tokens, cid)
    pages_and_models(client, tokens, cid)
    remote_is_never_called_without_permission(client, tokens, cid)
    denied_and_missing(client, tokens, cid)


def question_runs_helpers_in_order(client, tokens, cid):
    events = stream(client, tokens["viewer"], cid, QUESTION)
    kinds = [e["type"] for e in events]
    assert kinds[0] == "start" and kinds[1] == "plan" and kinds[-2:] == ["answer", "done"]
    plan = events[1]
    assert plan["source"] == "rules" and plan["command"]["kind"] == "ask"
    assert plan["steps"] == [["finder", "conflicts"], ["answer"], ["facts"]]
    assert plan["parallel_note"] and "same time" in plan["parallel_note"]
    assert not next(h for h in plan["helpers"] if h["id"] == "answer")["uses_model"]  # heuristic provider

    for helper in ("finder", "conflicts", "answer", "facts"):
        evs = helper_events(events, helper)
        assert evs[0]["status"] == "started" and evs[-1]["status"] == "finished", evs
        assert isinstance(evs[-1]["duration_ms"], int) and evs[-1]["duration_ms"] >= 0
        assert evs[-1]["t_ms"] >= evs[0]["t_ms"]
    # Finder and Conflict checker run on their own threads; the answer only starts after both finish.
    finder, conflicts = helper_events(events, "finder"), helper_events(events, "conflicts")
    assert finder[0]["thread"] != conflicts[0]["thread"]
    answer_start = events.index(helper_events(events, "answer")[0])
    assert answer_start > events.index(finder[-1]) and answer_start > events.index(conflicts[-1])
    merged = next(e for e in events if e["type"] == "coordinator" and e["status"] == "merged")
    assert events.index(merged) < answer_start
    assert conflicts[-1]["result"]["count"] > 0

    # The answer is the same one the investigation path gives for this question: the helpers are that code.
    answer = events[-2]
    same = client.post(
        f"{API}/investigations",
        json={"collection_id": cid, "question": QUESTION, "provider": "heuristic"},
        headers=auth(tokens["viewer"]),
    ).json()
    assert answer["sentences"] == same["answer"] and answer["sources"] == same["sources"]
    assert answer["sources"] and all(s["document_id"] for s in answer["sources"])
    facts = helper_events(events, "facts")[-1]["result"]
    assert facts["verified"] == sum(1 for s in same["answer"] if s["verified"])
    assert len(facts["sentences"]) == len(same["answer"])


def lists_are_found_then_sorted(client, tokens, cid):
    events = stream(client, tokens["viewer"], cid, "find drawings for Alpha, newest first")
    plan = events[1]
    assert plan["steps"] == [["finder"], ["sorter"]] and plan["parallel_note"] is None
    answer = events[-2]
    chat = client.post(
        f"{API}/collections/{cid}/chat",
        json={"message": "find drawings for Alpha, newest first", "use_model": False},
        headers=auth(tokens["viewer"]),
    ).json()
    assert [r["document_id"] for r in answer["rows"]] == [r["document_id"] for r in chat["results"]]
    assert answer["count"] == chat["count"] and answer["text"] == chat["reply"]
    assert helper_events(events, "sorter")[-1]["status"] == "finished"


def pages_and_models(client, tokens, cid):
    events = stream(client, tokens["viewer"], cid, "open approvals")
    assert events[1]["steps"] == [["navigator"]] and events[-2]["route"] == "/approvals"
    events = stream(client, tokens["viewer"], cid, "are my models downloaded?")
    assert events[1]["steps"] == [["models"]]
    # Ollama may or may not run where the tests do; either way the helper reports what really happened.
    assert helper_events(events, "models")[-1]["status"] in ("finished", "failed")
    assert events[-2]["kind"] == "models" and events[-2]["text"]
    events = stream(client, tokens["viewer"], cid, "hey vault")
    assert events[1]["steps"] == [] and events[-2]["kind"] == "help"


def remote_is_never_called_without_permission(client, tokens, cid):
    events = stream(client, tokens["analyst"], cid, QUESTION, provider="meta_api")
    error = next(e for e in events if e["type"] == "error")
    assert error["status"] in (400, 403, 409, 503)
    assert not helper_events(events, "answer") and not any(e["type"] == "answer" for e in events)


def denied_and_missing(client, tokens, cid):
    url = f"{API}/collections/{cid}/agent"
    assert client.post(url, json={"message": "find valves"}).status_code == 401
    missing = client.post(f"{API}/collections/999999/agent", json={"message": "x"}, headers=auth(tokens["viewer"]))
    assert missing.status_code == 404
    assert client.post(url, json={"message": "x" * 301}, headers=auth(tokens["viewer"])).status_code == 422


def test_needs_search_permission(client, tokens, monkeypatch):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "ask-denied"}, headers=a).json()["id"]
    monkeypatch.setitem(auth_mod.ROLE_PERMISSIONS, "viewer", auth_mod.ROLE_PERMISSIONS["viewer"] - {"search"})
    r = client.post(f"{API}/collections/{cid}/agent", json={"message": QUESTION}, headers=auth(tokens["viewer"]))
    assert r.status_code == 403 and "search" in r.json()["detail"]
    log = client.get(f"{API}/audit?outcome=denied", headers=auth(tokens["admin"])).json()
    assert any(e["action"].endswith("/agent") for e in log)


def test_falls_back_to_rules_when_the_local_model_is_off(client, tokens, settings, monkeypatch):
    # The default provider is the local model, and nothing listens where it should be.
    monkeypatch.setattr(settings, "provider", "ollama")
    monkeypatch.setattr(settings, "ollama_url", "http://127.0.0.1:9")
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "ask-fallback"}, headers=a).json()["id"]
    events = stream(client, tokens["viewer"], cid, QUESTION)
    note = next(e for e in events if e["type"] == "coordinator" and e["status"] == "fallback")
    assert "rules" in note["text"]
    answer = events[-2]
    assert answer["type"] == "answer" and answer["answered_by"]["provider"] == "heuristic"
