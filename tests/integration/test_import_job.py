"""F02.7: large path imports run as a background job with progress, cancellation and resume."""

from backend.storage.db import connect
from backend.workers.importer import create_import_job
from backend.workers.jobs import JobRunner
from tests.conftest import auth, wait_job

API = "/api/v1"


def _folder(settings, name: str, n: int, bad: int = 0):
    base = settings.import_root_paths[0] / name
    (base / "nested").mkdir(parents=True, exist_ok=True)
    for i in range(n):
        folder = base / "nested" if i % 2 else base
        (folder / f"memo-{i:05d}.txt").write_text(f"Project: Beta\nFL-{i} rated 600 psi\n", encoding="utf-8")
    for i in range(bad):
        (base / f"fake-{i}.pdf").write_bytes(b"not really a pdf")
    return base


def _collection(client, token):
    return client.post(f"{API}/collections", json={"name": "import"}, headers=auth(token)).json()["id"]


def test_background_import_reports_progress_and_rejections(client, tokens, settings):
    base = _folder(settings, "archive", 120, bad=3)
    cid = _collection(client, tokens["admin"])
    r = client.post(
        f"{API}/collections/{cid}/import-path",
        json={"path": str(base), "background": True},
        headers=auth(tokens["admin"]),
    )
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["kind"] == "import" and job["total"] == 123
    job = wait_job(client, tokens["admin"], job["id"])
    assert job["status"] == "completed_with_errors" and (job["done"], job["failed"]) == (120, 3)
    assert {x["filename"] for x in job["params"]["rejected"]} == {"fake-0.pdf", "fake-1.pdf", "fake-2.pdf"}
    assert job["id"] in [j["id"] for j in client.get(f"{API}/jobs", headers=auth(tokens["admin"])).json()]
    with connect(settings.db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM documents WHERE collection_id = ?", (cid,)).fetchone()[0] == 120


def test_cancel_stops_a_large_import(client, tokens, settings):
    base = _folder(settings, "big", 1500)
    cid = _collection(client, tokens["admin"])
    job = client.post(
        f"{API}/collections/{cid}/import-path",
        json={"path": str(base), "background": True},
        headers=auth(tokens["admin"]),
    ).json()
    client.post(f"{API}/jobs/{job['id']}/cancel", headers=auth(tokens["admin"]))
    job = wait_job(client, tokens["admin"], job["id"], timeout=120)
    assert job["status"] == "cancelled" and job["done"] < job["total"] == 1500


def test_import_job_resumes_after_restart_without_duplicates(client, tokens, settings):
    base = _folder(settings, "resume", 40)
    cid = _collection(client, tokens["admin"])
    with connect(settings.db_path) as conn:
        job_id = create_import_job(conn, cid, base, None)
        conn.execute("UPDATE jobs SET status = 'running' WHERE id = ?", (job_id,))
    for _ in range(2):  # a crash and a second restart: re-running never imports a file twice
        runner = JobRunner(settings)
        assert job_id in runner.resume_unfinished() or _ == 1
        runner.wait(job_id, timeout=60)
        with connect(settings.db_path) as conn:
            conn.execute("UPDATE jobs SET status = 'running' WHERE id = ?", (job_id,))
    with connect(settings.db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM documents WHERE collection_id = ?", (cid,)).fetchone()[0] == 40


def test_background_import_still_enforces_roots_and_admin(client, tokens, settings, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    cid = _collection(client, tokens["admin"])
    body = {"path": str(outside), "background": True}
    assert (
        client.post(f"{API}/collections/{cid}/import-path", json=body, headers=auth(tokens["admin"])).status_code == 403
    )
    inside = {"path": str(_folder(settings, "x", 1)), "background": True}
    r = client.post(f"{API}/collections/{cid}/import-path", json=inside, headers=auth(tokens["analyst"]))
    assert r.status_code == 403


def test_a_link_pointing_outside_the_root_is_never_read(settings, app, tmp_path):
    import pytest

    from backend.security.files import FileRejected
    from backend.workers.importer import import_one

    base = settings.import_root_paths[0] / "linky"
    base.mkdir(parents=True)
    secret = tmp_path / "outside-secret.txt"
    secret.write_text("not for VAULT", encoding="utf-8")
    link = base / "innocent.txt"
    try:
        link.symlink_to(secret)
    except OSError:
        pytest.skip("creating symlinks needs extra rights on this machine")
    with connect(settings.db_path) as conn, pytest.raises(FileRejected):
        import_one(conn, settings, 1, base.resolve(), link)
