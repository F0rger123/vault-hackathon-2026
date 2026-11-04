"""F10.23: Keeper stores each answer, learns from thumbs up and down, and recalls liked answers (re-checked)."""

from backend.agents import keeper
from backend.security import auth as auth_mod
from tests.conftest import auth
from tests.integration.test_ask_team import API, QUESTION, cid, stream  # noqa: F401 - cid is a fixture

AGAIN = "which parts have conflicting pressure ratings"


def answer_of(events):
    return next(e for e in events if e["type"] == "answer")


def test_words_ignore_order_case_and_plurals():
    assert keeper.words(QUESTION) == keeper.words("Conflicting pressure rating: which parts?")
    assert keeper.words("the of and") == []


def test_learns_from_votes_and_recalls(client, tokens, cid):  # noqa: F811
    v = tokens["viewer"]
    first = stream(client, v, cid, QUESTION)
    assert not [e for e in first if e["type"] == "memory"]
    run = answer_of(first)["run"]
    assert run == first[0]["run"]
    stats = client.get(f"{API}/collections/{cid}/memory", headers=auth(v)).json()
    assert stats["answers"] == 1 and stats["learned"] == 0 and stats["assistant"] == "Keeper"

    # Not liked yet: nothing is recalled.
    assert not [e for e in stream(client, v, cid, AGAIN) if e["type"] == "memory"]

    voted = client.post(f"{API}/collections/{cid}/answers/{run}/vote", json={"vote": 1}, headers=auth(v))
    assert voted.status_code == 200, voted.text
    assert voted.json()["learned"] == 1 and voted.json()["boosted_documents"] > 0

    again = stream(client, v, cid, AGAIN)
    kinds = [e["type"] for e in again]
    assert kinds[0] == "start" and kinds[1] == "plan" and kinds[-2:] == ["answer", "done"]
    recalled = next(e for e in again if e["type"] == "memory" and e["status"] == "recalled")
    assert recalled["run"] == run and recalled["text"] == answer_of(first)["text"]
    assert kinds.index("memory") < kinds.index("helper")  # shown before the helpers finish
    rechecked = next(e for e in again if e["type"] == "memory" and e["status"] == "rechecked")
    assert rechecked["still_cited"] == rechecked["total"] > 0  # the documents did not change
    finder = [e for e in again if e["type"] == "helper" and e["id"] == "finder" and e["status"] == "progress"]
    assert any("answers people liked" in e["text"] for e in finder)

    # A thumbs down takes the boost away again.
    client.post(f"{API}/collections/{cid}/answers/{run}/vote", json={"vote": -1}, headers=auth(v))
    assert not [e for e in stream(client, v, cid, AGAIN) if e["type"] == "memory"]
    stats = client.get(f"{API}/collections/{cid}/memory", headers=auth(v)).json()
    assert stats["disliked"] == 1 and stats["boosted_documents"] == 0


def test_vote_denied_and_missing(client, tokens, cid, monkeypatch):  # noqa: F811
    run = answer_of(stream(client, tokens["viewer"], cid, QUESTION))["run"]
    url = f"{API}/collections/{cid}/answers/{run}/vote"
    assert client.post(url, json={"vote": 1}).status_code == 401
    assert client.get(f"{API}/collections/{cid}/memory").status_code == 401
    # Only the person who asked may rate the answer.
    assert client.post(url, json={"vote": 1}, headers=auth(tokens["analyst"])).status_code == 404
    assert client.post(url, json={"vote": 5}, headers=auth(tokens["viewer"])).status_code == 422
    cleared = client.post(url, json={"vote": 0}, headers=auth(tokens["viewer"]))
    assert cleared.status_code == 200 and cleared.json()["vote"] == 0
    bad = f"{API}/collections/{cid}/answers/not-a-run/vote"
    assert client.post(bad, json={"vote": 1}, headers=auth(tokens["viewer"])).status_code == 404
    assert client.get(f"{API}/collections/999999/memory", headers=auth(tokens["viewer"])).status_code == 404

    monkeypatch.setitem(auth_mod.ROLE_PERMISSIONS, "viewer", auth_mod.ROLE_PERMISSIONS["viewer"] - {"search"})
    r = client.post(url, json={"vote": 1}, headers=auth(tokens["viewer"]))
    assert r.status_code == 403 and "search" in r.json()["detail"]
    assert client.get(f"{API}/collections/{cid}/memory", headers=auth(tokens["viewer"])).status_code == 403
