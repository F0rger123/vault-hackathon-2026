"""Multi-agent orchestration: lanes, security routing, review, escalation, events, examples, capacity."""

from backend.agents.review_agent import ACCEPT, ESCALATE, HUMAN, review
from backend.agents.security_agent import screen
from backend.core.capacity import calibrate, static_ceiling
from backend.core.hardware import GpuInfo, HardwareProfile
from backend.workers.processing import pick_examples
from tests.conftest import auth, wait_job

API = "/api/v1"


def _collection_with(client, token, files):
    cid = client.post(f"{API}/collections", json={"name": "agents"}, headers=auth(token)).json()["id"]
    r = client.post(f"{API}/collections/{cid}/documents", headers=auth(token), files=files).json()
    return cid, [a["document_id"] for a in r["accepted"]]


def test_security_agent_routes_marked_and_personal_documents_locally():
    assert screen(1, ["Routine memo"]).route == "any"
    s = screen(2, ["PROPRIETARY - EXPORT CONTROLLED (ITAR)\nPV-1000 rated 300 psi"])
    assert s.sensitivity == "restricted" and s.route == "local_only" and "ITAR" in s.markings
    assert screen(3, ["Contact: jane@example.com"]).route == "local_only"
    assert screen(4, ["CONFIDENTIAL quarterly note"]).sensitivity == "internal"
    assert screen(4, ["CONFIDENTIAL quarterly note"]).route == "any"


def test_review_agent_decisions():
    ok = {"verified_ratio": 1.0, "evidence_count": 2, "doc_type": "contract"}
    assert review(ok, 0, "application/pdf", False).decision == ACCEPT
    bad = {"verified_ratio": 0.5, "evidence_count": 2, "doc_type": "contract"}
    assert review(bad, 0, "application/pdf", False).decision == ESCALATE
    assert review(bad, 0, "application/pdf", True).decision == HUMAN
    assert review(ok, 1, "application/pdf", False).decision == HUMAN


def test_multi_lane_job_records_agent_events(client, tokens, dataset):
    a = auth(tokens["analyst"])
    files = [("files", (p.name, p.read_bytes())) for p in sorted((dataset / "files").iterdir())[:30]]
    files.append(("files", ("secret.txt", b"EXPORT CONTROLLED (ITAR)\nProject: Alpha\nPV-1000 rated 300 psi")))
    cid, _ = _collection_with(client, tokens["analyst"], files)
    job = client.post(
        f"{API}/jobs",
        headers=a,
        json={
            "collection_id": cid,
            "lanes": [{"provider": "heuristic", "concurrency": 3}, {"provider": "heuristic", "concurrency": 2}],
        },
    ).json()
    assert job["workers"] == 5
    job = wait_job(client, tokens["analyst"], job["id"])
    assert job["status"] == "completed" and job["done"] == 31
    events = client.get(f"{API}/jobs/{job['id']}/events", headers=a).json()
    actions = {(e["agent"].split(":")[0], e["action"]) for e in events}
    assert {
        ("coordinator", "plan"),
        ("security", "screening.summary"),
        ("extractor", "extract"),
        ("reviewer", "review"),
        ("coordinator", "finish"),
    } <= actions
    lanes_used = {e["agent"] for e in events if e["action"] == "extract"}
    assert lanes_used == {"extractor:heuristic#1", "extractor:heuristic#2"}
    assert any(e["action"] == "route.local_only" for e in events)
    agents = client.get(f"{API}/jobs/{job['id']}/agents", headers=a).json()
    assert sum(x["extracted"] or 0 for x in agents) == 31


def test_remote_lane_never_receives_restricted_documents(client, tokens, settings, monkeypatch):
    """With only a (fake) remote lane, a restricted document is blocked instead of sent."""
    from backend.providers import heuristic

    class FakeRemote(heuristic.HeuristicProvider):
        name, locality = "meta_api", "remote"

        def info(self):
            i = super().info()
            return type(i)(**{**i.__dict__, "name": "meta_api", "locality": "remote", "model": "fake-remote"})

    sent = []
    orig = FakeRemote.extract

    def spy(self, pages, *a, **k):
        sent.append("\n".join(pages))
        return orig(self, pages, *a, **k)

    FakeRemote.extract = spy
    monkeypatch.setattr("backend.workers.processing.get_provider", lambda name, s: FakeRemote())
    client.put(f"{API}/settings/remote-inference", json={"enabled": True}, headers=auth(tokens["admin"]))
    files = [
        ("files", ("ok.txt", b"Project: Beta\nFL-2000 rated 600 psi")),
        ("files", ("itar.txt", b"ITAR controlled drawing\nPV-1000 rated 300 psi")),
    ]
    cid, _ = _collection_with(client, tokens["analyst"], files)
    from backend.storage.db import connect
    from backend.workers.jobs import create_process_job

    with connect(settings.db_path) as conn:
        job_id = create_process_job(conn, cid, "meta_api", 2, None)
    client.app.state.runner.start(job_id)
    job = wait_job(client, tokens["analyst"], job_id)
    assert job["done"] == 1 and job["failed"] == 1
    assert all("ITAR" not in text for text in sent)
    assert "blocked" in job["errors"][0]["error"]


def test_examples_are_stored_and_selected_by_similarity(client, tokens):
    a = auth(tokens["analyst"])
    cid, ids = _collection_with(
        client,
        tokens["analyst"],
        [
            ("files", ("a.txt", b"Field Verification Record Programme Alpha witnessed hydrostatic")),
            ("files", ("b.txt", b"Supply agreement between buyer and supplier warranty")),
        ],
    )
    r = client.post(
        f"{API}/examples", headers=a, json={"document_id": ids[0], "labels": {"doc_type": "inspection_report"}}
    )
    assert r.status_code == 201
    assert (
        client.post(f"{API}/examples", headers=a, json={"document_id": ids[1], "labels": {"evil": "x"}}).status_code
        == 422
    )
    assert (
        client.post(
            f"{API}/examples",
            headers=auth(tokens["viewer"]),
            json={"document_id": ids[1], "labels": {"doc_type": "contract"}},
        ).status_code
        == 403
    )
    assert len(client.get(f"{API}/examples", headers=a).json()) == 1
    ex = [
        {
            "excerpt": "verification hydrostatic",
            "labels": {"doc_type": "inspection_report"},
            "words": {"verification", "hydrostatic", "witnessed"},
        },
        {"excerpt": "agreement", "labels": {"doc_type": "contract"}, "words": {"agreement", "supplier"}},
    ]
    assert (
        pick_examples(ex, ["witnessed hydrostatic verification"], k=1)[0]["labels"]["doc_type"] == "inspection_report"
    )


def test_capacity_planning():
    hw = HardwareProfile("x", "cpu", 8, 16, 32000, 20000, 100000, gpus=[GpuInfo("gpu", 81920)])
    ceiling, reason = static_ceiling(hw, "muse-glimmer:30b", "local")
    assert ceiling == 4 * 8 and "4 instance" in reason
    no_gpu = HardwareProfile("x", "cpu", 8, 16, 32000, 20000, 100000, gpus=[])
    assert static_ceiling(no_gpu, "llama3:latest", "local")[0] >= 1
    assert static_ceiling(no_gpu, "x", "remote")[0] > 1

    import time

    def fake(i):  # a server that serves 2 requests in parallel
        time.sleep(0.02)

    levels, best = calibrate(fake, 8, ceiling=8, levels=(1, 2, 4, 8))
    assert best >= 2 and levels[0].concurrency == 1


def test_capacity_endpoint(client, tokens):
    r = client.get(f"{API}/system/capacity", params={"provider": "heuristic"}, headers=auth(tokens["viewer"]))
    assert r.status_code == 200 and r.json()["static_ceiling"] >= 1
    assert (
        client.post(
            f"{API}/system/capacity/calibrate", json={"provider": "heuristic"}, headers=auth(tokens["analyst"])
        ).status_code
        == 403
    )
