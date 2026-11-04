"""F12.17: deleting a collection, reading new uploads automatically, and removing or restoring the demo data."""

import pytest

from backend.api import routes_collections
from backend.storage.db import connect
from backend.workers import demo_dataset
from tests.conftest import auth, wait_job

API = "/api/v1"
SHARED = b"INSPECTION REPORT - Project: Alpha - 2026-01-10\nPV-1001 tested at 300 psi.\n"
ONLY_A = b"PROJECT MEMO - Project: Bravo - 2026-02-01\nSchedule for PV-2002.\n"


@pytest.fixture(autouse=True)
def _no_ollama(monkeypatch):
    """Deterministic: the host may run Ollama, but these tests read with the rules baseline."""
    monkeypatch.setattr(routes_collections, "local_models", lambda *_: {"reachable": False, "models": []})


def test_auto_lane_prefers_installed_llama_and_never_remote(monkeypatch, settings):
    from backend.storage.db import migrate

    migrate(settings.db_path)
    llama = {"reachable": True, "models": [{"name": "llama3", "used_by_vault": True, "copies_on_gpu": 3}]}
    with connect(settings.db_path) as conn:
        assert routes_collections._auto_lane(conn, settings) == ("heuristic", 4)
        monkeypatch.setattr(routes_collections, "local_models", lambda *_: llama)
        assert routes_collections._auto_lane(conn, settings) == ("ollama", 2)
        llama["models"][0]["used_by_vault"] = False  # Ollama runs, but VAULT's model is not installed
        assert routes_collections._auto_lane(conn, settings) == ("heuristic", 4)


def _collection(client, tokens, name: str, files: dict[str, bytes], is_demo: bool = False) -> int:
    a = auth(tokens["admin"])
    cid = client.post(f"{API}/collections", json={"name": name, "is_demo": is_demo}, headers=a).json()["id"]
    r = client.post(
        f"{API}/collections/{cid}/documents", headers=a, files=[("files", (n, b)) for n, b in files.items()]
    )
    assert r.status_code == 200, r.text
    return cid


def _copies(settings) -> int:
    return sum(1 for p in settings.originals_dir.rglob("*") if p.is_file())


def _audit(client, tokens, action: str) -> list[dict]:
    rows = client.get(f"{API}/audit?limit=500", headers=auth(tokens["admin"])).json()
    return [r for r in rows if r["action"] == action]


def test_admin_deletes_collection_keeps_shared_copy_and_other_collection(client, tokens, settings):
    a = _collection(client, tokens, "alpha", {"report.txt": SHARED, "memo.txt": ONLY_A})
    b = _collection(client, tokens, "bravo", {"report-copy.txt": SHARED})
    job = client.post(f"{API}/collections/{a}/autoprocess", headers=auth(tokens["admin"])).json()["job"]
    wait_job(client, tokens["admin"], job["id"])
    assert _copies(settings) == 2

    r = client.delete(f"{API}/collections/{a}", headers=auth(tokens["admin"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["documents"] == 2 and body["copies_removed"] == 1 and body["copies_kept"] == 1
    # The copy bravo still uses is kept; the one only alpha had is gone.
    assert _copies(settings) == 1
    ids = [c["id"] for c in client.get(f"{API}/collections", headers=auth(tokens["admin"])).json()]
    assert a not in ids and b in ids
    with connect(settings.db_path) as conn:
        for table in ("documents", "jobs", "findings", "activity", "knowledge"):
            assert conn.execute(f"SELECT COUNT(*) FROM {table} WHERE collection_id = ?", (a,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM documents WHERE collection_id = ?", (b,)).fetchone()[0] == 1
        # The search index lost alpha's pages and kept bravo's.
        assert conn.execute("SELECT COUNT(*) FROM pages_fts WHERE pages_fts MATCH 'Bravo'").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM pages_fts WHERE pages_fts MATCH 'Alpha'").fetchone()[0] == 1
    rows = _audit(client, tokens, "collection.delete")
    assert rows and rows[0]["outcome"] == "allowed" and rows[0]["target"] == f"collection:{a}"
    assert client.delete(f"{API}/collections/{a}", headers=auth(tokens["admin"])).status_code == 404


def test_viewer_and_analyst_cannot_delete(client, tokens):
    cid = _collection(client, tokens, "alpha", {"memo.txt": ONLY_A})
    for who in ("viewer", "analyst"):
        assert client.delete(f"{API}/collections/{cid}", headers=auth(tokens[who])).status_code == 403
        assert client.post(f"{API}/demo/restore", headers=auth(tokens[who])).status_code == 403
    assert client.get(f"{API}/collections", headers=auth(tokens["viewer"])).json()[0]["id"] == cid


def test_delete_refused_while_a_run_is_going(client, tokens, settings):
    cid = _collection(client, tokens, "alpha", {"memo.txt": ONLY_A})
    with connect(settings.db_path) as conn:
        conn.execute(
            "INSERT INTO jobs (kind, status, collection_id, params, total, workers, created_at) "
            "VALUES ('process', 'running', ?, '{}', 1, 1, 0)",
            (cid,),
        )
    r = client.delete(f"{API}/collections/{cid}", headers=auth(tokens["admin"]))
    assert r.status_code == 409
    assert _audit(client, tokens, "collection.delete")[0]["outcome"] == "denied"
    assert _copies(settings) == 1


def test_upload_then_autoprocess_starts_exactly_one_run(client, tokens, settings):
    cid = _collection(client, tokens, "alpha", {"memo.txt": ONLY_A, "report.txt": SHARED})
    a = auth(tokens["analyst"])
    first = client.post(f"{API}/collections/{cid}/autoprocess", headers=a)
    assert first.status_code == 202, first.text
    started = first.json()
    assert started["started"] is True and started["provider"] == "heuristic"
    assert started["job"]["total"] == 2
    # A second upload batch while the first run is going does not start another run.
    with connect(settings.db_path) as conn:
        conn.execute("UPDATE jobs SET status = 'running' WHERE id = ?", (started["job"]["id"],))
    again = client.post(f"{API}/collections/{cid}/autoprocess", headers=a).json()
    assert again["started"] is False and again["reason"] == "already_running"
    assert again["job"]["id"] == started["job"]["id"]
    with connect(settings.db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM jobs WHERE collection_id = ?", (cid,)).fetchone()[0] == 1
        conn.execute("UPDATE jobs SET status = 'queued' WHERE id = ?", (started["job"]["id"],))
    wait_job(client, tokens["admin"], started["job"]["id"])
    # Everything is read now, so a further call has nothing to do.
    done = client.post(f"{API}/collections/{cid}/autoprocess", headers=a).json()
    assert done["started"] is False and done["reason"] == "nothing_new"
    assert client.post(f"{API}/collections/{cid}/autoprocess", headers=auth(tokens["viewer"])).status_code == 403


def test_demo_removed_is_remembered_and_restore_brings_it_back(client, tokens, settings):
    cid = _collection(client, tokens, "Demo collection", {"memo.txt": ONLY_A}, is_demo=True)
    a = auth(tokens["admin"])
    assert client.get(f"{API}/demo/status", headers=a).json()["demo_removed"] is False
    assert client.delete(f"{API}/collections/{cid}", headers=a).status_code == 200
    status = client.get(f"{API}/demo/status", headers=a).json()
    assert status["demo_removed"] is True and status["demo_collections"] == 0
    # The choice is stored in the database, so a restart (or start.ps1) does not bring the demo back.
    with connect(settings.db_path) as conn:
        assert conn.execute("SELECT value FROM settings_kv WHERE key = 'demo_removed'").fetchone()[0] == "true"
    if not (demo_dataset.SYNTHETIC / "files").is_dir():
        return
    r = client.post(f"{API}/demo/restore", headers=a)
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["imported"] > 0 and body["job"] is not None
    wait_job(client, tokens["admin"], body["job"]["id"], timeout=120)
    status = client.get(f"{API}/demo/status", headers=a).json()
    assert status["demo_removed"] is False and status["demo_collections"] == 1
    assert _audit(client, tokens, "demo.restore")[0]["outcome"] == "allowed"
