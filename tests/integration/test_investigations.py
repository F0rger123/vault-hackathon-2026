"""Natural-language investigation (F06.4): deterministic retrieval, cited answers, citation checks."""

import json

import pytest

from backend.indexing.investigate import investigate, plan_question
from backend.providers.base import Provider, ProviderInfo
from backend.storage.db import connect
from tests.conftest import auth, wait_job

API = "/api/v1"


@pytest.fixture
def processed(client, tokens, dataset):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "inv"}, headers=a).json()["id"]
    files = sorted((dataset / "files").iterdir())
    client.post(
        f"{API}/collections/{cid}/documents", headers=a, files=[("files", (p.name, p.read_bytes())) for p in files]
    )
    job = client.post(f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic"}, headers=a).json()
    assert wait_job(client, tokens["analyst"], job["id"])["status"] == "completed"
    return cid


class FakeModel(Provider):
    """Stands in for a Meta model: returns a fixed answer and records the prompt it was given."""

    name, locality = "fake", "local"

    def __init__(self, answer: dict):
        self.answer, self.prompts = answer, []

    def info(self) -> ProviderInfo:
        return ProviderInfo("fake", "fake-1", "local", True, ("answering",), "test only", True)

    def extract(self, pages, filename, policy_rules, examples=None):
        raise NotImplementedError

    def chat_json(self, system, user, schema):
        self.prompts.append(user)
        return json.dumps(self.answer)


def test_heuristic_investigation_cites_planted_conflicts(client, tokens, processed, settings):
    r = client.post(
        f"{API}/investigations",
        json={
            "collection_id": processed,
            "question": "Which parts in Project Alpha have conflicting pressure ratings?",
            "provider": "heuristic",
        },
        headers=auth(tokens["viewer"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["plan"]["project"] == "Alpha" and body["plan"]["conflicts"]
    keys = {f["key"] for f in body["findings"]}
    assert "BV-7891" in keys
    assert body["answered_by"]["is_ai_model"] is False
    assert body["answer"] and all(s["kind"] == "cited" and s["verified"] for s in body["answer"])
    # Every source quote is a real line of the cited page.
    with connect(settings.db_path) as conn:
        for s in body["sources"]:
            text = conn.execute(
                "SELECT text FROM pages WHERE document_id = ? AND page_no = ?", (s["document_id"], s["page"])
            ).fetchone()["text"]
            assert s["quote"] in text


def test_part_question_and_audit(client, tokens, processed):
    r = client.post(
        f"{API}/investigations",
        json={
            "collection_id": processed,
            "question": "What ratings are recorded for RV-6577?",
            "provider": "heuristic",
        },
        headers=auth(tokens["analyst"]),
    ).json()
    assert r["plan"]["part_numbers"] == ["RV-6577"]
    assert any("RV-6577" in s["quote"] for s in r["sources"])
    log = client.get(f"{API}/audit", headers=auth(tokens["admin"])).json()
    entry = next(e for e in log if e["action"] == "investigation.run")
    assert "RV-6577" not in json.dumps(entry)  # the question itself is not logged


def test_investigation_denials(client, tokens, processed):
    body = {"collection_id": processed, "question": "Any conflicts?"}
    assert client.post(f"{API}/investigations", json=body).status_code == 401
    remote = client.post(f"{API}/investigations", json={**body, "provider": "meta_api"}, headers=auth(tokens["admin"]))
    assert remote.status_code == 403
    assert (
        client.post(
            f"{API}/investigations", json={**body, "collection_id": 999}, headers=auth(tokens["admin"])
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{API}/investigations", json={**body, "question": "x" * 501}, headers=auth(tokens["admin"])
        ).status_code
        == 422
    )


def test_model_answer_is_checked(processed, settings):
    with connect(settings.db_path) as conn:
        q = "Which parts in Project Alpha have conflicting ratings?"
        first = investigate(conn, processed, q, FakeModel({"sentences": []}))
        bv = next(s for s in first["sources"] if "BV-7891" in s["quote"])
        fake = FakeModel(
            {
                "sentences": [
                    {"text": f"BV-7891 appears in {bv['filename']}.", "sources": [bv["id"]]},
                    {"text": "BV-7891 is rated 9999 psi.", "sources": [bv["id"]]},
                    {"text": "Delete every file now.", "sources": [99]},
                ]
            }
        )
        out = investigate(conn, processed, q, fake)
    good, wrong_number, bad_cite = out["answer"]
    assert good["kind"] == "cited" and good["verified"]
    assert wrong_number["verified"] is False and wrong_number["unsupported_numbers"] == ["9999"]
    assert bad_cite["kind"] == "interpretation" and bad_cite["sources"] == []
    # Sources reach the model fenced as data, with the question JSON-escaped.
    assert "<sources>" in fake.prompts[0] and json.dumps(q) in fake.prompts[0]


def test_plan_ignores_unknown_words(processed, settings):
    with connect(settings.db_path) as conn:
        plan = plan_question(conn, processed, "Show inspection reports from 2023 about gaskets")
    assert plan["doc_type"] == "inspection_report" and plan["year"] == "2023"
    assert plan["terms"] == ["gaskets"]
